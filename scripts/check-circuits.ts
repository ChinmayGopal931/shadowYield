import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { getCompDefAccAddress } from '@arcium-hq/client';

// Circuit computation definition offsets
function computeCompDefOffset(name: string): number {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

const circuits = [
  { name: 'init_pool_state', size: '473KB', acus: '314M' },
  { name: 'process_deposit', size: '4.8MB', acus: '1.1B' },
  { name: 'check_investment_needed', size: '163KB', acus: '186M' },
  { name: 'record_investment', size: '4.0MB', acus: '785M' },
  { name: 'record_yield', size: '80MB', acus: '12B' },
  { name: 'authorize_withdrawal', size: '3.8MB', acus: '1B' },
  { name: 'process_withdrawal', size: '4.2MB', acus: '825M' },
];

const PROGRAM_ID = new PublicKey('2nd7JPPtQJY69iBKn8Mfef4BMCPrya2bNsyW3kkjVcxT');
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';

async function checkCircuitStatus() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Ghost Pool Circuit Deployment Status                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const connection = new Connection(RPC_URL, 'confirmed');

  console.log(`📡 RPC: ${RPC_URL.substring(0, 50)}...`);
  console.log(`🔑 Program: ${PROGRAM_ID.toBase58()}\n`);
  console.log('─'.repeat(80));

  let readyCount = 0;
  let totalCount = circuits.length;

  for (const circuit of circuits) {
    const offset = computeCompDefOffset(circuit.name);
    const compDefAddress = getCompDefAccAddress(PROGRAM_ID, offset);

    process.stdout.write(`\n${circuit.name.padEnd(30)}`);

    try {
      const accountInfo = await connection.getAccountInfo(compDefAddress);

      if (!accountInfo) {
        console.log('❌ NOT INITIALIZED');
        continue;
      }

      // Check if account has data
      const dataSize = accountInfo.data.length;

      if (dataSize === 0) {
        console.log('⚠️  INITIALIZING (no data yet)');
        continue;
      }

      // Try to parse the account to check if it's completed
      // Arcium comp def accounts have a status field indicating completion
      try {
        // Read first 8 bytes as discriminator
        const discriminator = accountInfo.data.slice(0, 8);

        // Simple heuristic: if account is > 1KB and has data, likely initialized
        if (dataSize > 1000) {
          console.log(`✅ READY (${(dataSize / 1024).toFixed(1)}KB on-chain)`);
          readyCount++;
        } else if (dataSize > 100) {
          console.log(`⏳ UPLOADING (${dataSize} bytes so far...)`);
        } else {
          console.log(`🔄 INITIALIZING (${dataSize} bytes)`);
        }
      } catch (e) {
        console.log(`⚠️  UNKNOWN STATUS (${dataSize} bytes)`);
      }

      // Show circuit details
      console.log(`   └─ Size: ${circuit.size} | ACUs: ${circuit.acus} | Address: ${compDefAddress.toBase58().substring(0, 20)}...`);

    } catch (error: any) {
      if (error.message?.includes('429') || error.message?.includes('rate')) {
        console.log('⚠️  RATE LIMITED (wait and retry)');
      } else {
        console.log(`❌ ERROR: ${error.message?.substring(0, 40) || 'Unknown error'}`);
      }
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n' + '─'.repeat(80));
  console.log(`\n📊 Summary: ${readyCount}/${totalCount} circuits ready\n`);

  if (readyCount === totalCount) {
    console.log('✅ All circuits are ready! You can now run the full test suite.\n');
  } else {
    console.log(`⏳ ${totalCount - readyCount} circuit(s) still initializing...\n`);
    console.log('💡 Tips:');
    console.log('   • Large circuits can take 5-10 minutes to finalize');
    console.log('   • Wait a few minutes and run this script again');
    console.log('   • Check https://explorer.solana.com/?cluster=devnet for tx status\n');
  }

  // Special note about record_yield
  const recordYieldOffset = computeCompDefOffset('record_yield');
  const recordYieldAddress = getCompDefAccAddress(PROGRAM_ID, recordYieldOffset);
  const recordYieldInfo = await connection.getAccountInfo(recordYieldAddress);

  if (!recordYieldInfo || recordYieldInfo.data.length < 1000) {
    console.log('⚠️  IMPORTANT: record_yield circuit (80MB) exceeded CU limits');
    console.log('   Consider using offchain storage (see PROJECT_STATUS.md line 232)\n');
  }

  console.log('Run this command to check again:');
  console.log('  yarn check-circuits\n');
}

checkCircuitStatus().catch((error) => {
  console.error('\n❌ Error checking circuit status:', error.message);
  process.exit(1);
});
