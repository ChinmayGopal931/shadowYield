import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const PINATA_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJlYjE2Yzg0OS03YTAxLTQ2ZjUtOWZiMi1jYjdhMzY5MjE1NmMiLCJlbWFpbCI6ImNoaW5tYXlnMDE1QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiI2MDlmMDdhYzk3OWUyOGFhODA2OSIsInNjb3BlZEtleVNlY3JldCI6ImVjMWEzODY5OTVjMTQwMmUzZWFiZjJlM2UyZmRiZmEyNzYyOTEzYjZlZThkYmVlYTVlYTUwNzE2YTY0ZjcxNTAiLCJleHAiOjE4MDA5ODc1MDl9.6t0EXY9ZGmrvL_h1jGaScalQsrDu17EHhmZXX00yLSA';

const CIRCUITS = [
  'init_pool_state',
  'process_deposit',
  'check_investment_needed',
  'record_investment',
  'record_yield',
  'authorize_withdrawal',
  'process_withdrawal',
];

interface UploadResult {
  name: string;
  ipfsHash: string;
  url: string;
  size: number;
}

async function uploadToPinata(filePath: string, name: string): Promise<UploadResult> {
  const fileBuffer = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);

  // Build multipart form data
  const parts: Buffer[] = [];

  // File part
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}.arcis"\r\n`));
  parts.push(Buffer.from('Content-Type: application/octet-stream\r\n\r\n'));
  parts.push(fileBuffer);
  parts.push(Buffer.from('\r\n'));

  // Metadata part
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from('Content-Disposition: form-data; name="pinataMetadata"\r\n\r\n'));
  parts.push(Buffer.from(JSON.stringify({ name: `ghost-pool-${name}` })));
  parts.push(Buffer.from('\r\n'));

  // Options part
  parts.push(Buffer.from(`--${boundary}\r\n`));
  parts.push(Buffer.from('Content-Disposition: form-data; name="pinataOptions"\r\n\r\n'));
  parts.push(Buffer.from(JSON.stringify({ cidVersion: 1 })));
  parts.push(Buffer.from('\r\n'));

  // End boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.pinata.cloud',
      path: '/pinning/pinFileToIPFS',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PINATA_JWT}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Pinata upload failed: ${data}`));
          return;
        }
        const result = JSON.parse(data);
        resolve({
          name,
          ipfsHash: result.IpfsHash,
          url: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
          size: stats.size,
        });
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Upload Circuits to Pinata IPFS                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const buildDir = path.join(__dirname, '..', 'build');
  const results: UploadResult[] = [];

  for (const circuit of CIRCUITS) {
    const filePath = path.join(buildDir, `${circuit}.arcis`);

    if (!fs.existsSync(filePath)) {
      console.log(`❌ Circuit file not found: ${filePath}`);
      continue;
    }

    const stats = fs.statSync(filePath);
    console.log(`📤 Uploading ${circuit}.arcis (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);

    try {
      const result = await uploadToPinata(filePath, circuit);
      results.push(result);
      console.log(`   ✅ ${circuit}: ${result.ipfsHash}`);
      console.log(`   🔗 ${result.url}\n`);
    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}\n`);
    }

    // Small delay between uploads
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n' + '─'.repeat(70));
  console.log('\n📊 Upload Summary:\n');

  for (const result of results) {
    console.log(`${result.name.padEnd(30)} ${result.ipfsHash}`);
  }

  // Save results to JSON
  const outputPath = path.join(__dirname, '..', 'circuit-urls.json');
  const outputData = {
    uploadedAt: new Date().toISOString(),
    version: 'v5',
    gateway: 'https://gateway.pinata.cloud/ipfs/',
    description: 'v5 circuits - separated encrypted password from plaintext amount',
    circuits: results.reduce((acc, r) => {
      acc[r.name] = {
        ipfsHash: r.ipfsHash,
        url: r.url,
        size: `${(r.size / 1024).toFixed(0)}KB`,
      };
      return acc;
    }, {} as Record<string, any>),
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n💾 Saved to: circuit-urls.json`);

  console.log('\n📝 Next steps:');
  console.log('   1. Generate new program keypair');
  console.log('   2. Update declare_id!() in lib.rs');
  console.log('   3. Deploy with arcium');
  console.log('   4. Initialize comp defs\n');
}

main().catch(console.error);
