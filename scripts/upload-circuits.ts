import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import axios from 'axios';

// Pinata API credentials (you can get these free from https://pinata.cloud)
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
  console.error('❌ Missing Pinata credentials!');
  console.error('Set PINATA_API_KEY and PINATA_SECRET_KEY environment variables');
  console.error('Get free API keys at: https://pinata.cloud');
  process.exit(1);
}

const CIRCUITS = [
  'init_pool_state',
  'process_deposit',
  'check_investment_needed',
  'record_investment',
  'record_yield',
  'authorize_withdrawal',
  'process_withdrawal',
];

interface CircuitUpload {
  name: string;
  ipfsHash: string;
  url: string;
  size: number;
}

async function uploadToPinata(filePath: string, circuitName: string): Promise<CircuitUpload> {
  const formData = new FormData();
  const fileStream = fs.createReadStream(filePath);
  const stats = fs.statSync(filePath);

  formData.append('file', fileStream);
  formData.append('pinataMetadata', JSON.stringify({
    name: `ghost-pool-${circuitName}.arcis`,
    keyvalues: {
      project: 'ghost-pool',
      circuit: circuitName,
    }
  }));

  console.log(`📤 Uploading ${circuitName} (${(stats.size / 1024 / 1024).toFixed(2)}MB)...`);

  try {
    const response = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
      maxBodyLength: Infinity,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${(formData as any)._boundary}`,
        'pinata_api_key': PINATA_API_KEY!,
        'pinata_secret_api_key': PINATA_SECRET_KEY!,
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const url = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

    console.log(`✅ Uploaded: ${url}`);

    return {
      name: circuitName,
      ipfsHash,
      url,
      size: stats.size,
    };
  } catch (error: any) {
    console.error(`❌ Failed to upload ${circuitName}:`, error.response?.data || error.message);
    throw error;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Ghost Pool Circuit Upload to IPFS (Pinata)           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const buildDir = path.join(__dirname, '../build');
  const uploads: CircuitUpload[] = [];

  for (const circuit of CIRCUITS) {
    const filePath = path.join(buildDir, `${circuit}.arcis`);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ Circuit file not found: ${filePath}`);
      console.error('Run "arcium build" first!');
      process.exit(1);
    }

    const upload = await uploadToPinata(filePath, circuit);
    uploads.push(upload);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n✅ All circuits uploaded successfully!\n');
  console.log('📋 Circuit URLs:\n');

  for (const upload of uploads) {
    console.log(`${upload.name}:`);
    console.log(`  IPFS: ${upload.ipfsHash}`);
    console.log(`  URL:  ${upload.url}`);
    console.log(`  Size: ${(upload.size / 1024 / 1024).toFixed(2)}MB\n`);
  }

  // Generate Rust code for program
  console.log('─'.repeat(80));
  console.log('\n📝 Add these URLs to your program:\n');
  console.log('// In programs/ghost_pool/src/lib.rs\n');

  const rustCode = uploads.map(u => `const ${u.name.toUpperCase()}_URL: &str = "${u.url}";`).join('\n');
  console.log(rustCode);

  // Save URLs to JSON
  const urlsFile = path.join(__dirname, '../circuit-urls.json');
  fs.writeFileSync(urlsFile, JSON.stringify(uploads, null, 2));
  console.log(`\n💾 URLs saved to: ${urlsFile}`);

  console.log('\n🎉 Done! Next steps:');
  console.log('   1. Update program init functions to use CircuitSource::OffChain');
  console.log('   2. Redeploy the program with "anchor deploy"');
  console.log('   3. Reinitialize comp defs with the new offchain storage\n');
}

main().catch(console.error);
