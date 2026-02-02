import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import {
  getClusterAccAddress,
  getMXEAccAddress,
  getComputationAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
} from '@arcium-hq/client';

// Configuration
const CLUSTER_OFFSET = 456;
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';

// Computation definition offsets
const COMP_DEF_OFFSETS = {
  init_pool_state: 0,
  process_deposit: 1,
  check_investment_needed: 2,
  record_investment: 3,
  record_yield: 4,
  authorize_withdrawal: 5,
  process_withdrawal: 6,
};

const CIRCUITS = [
  'init_pool_state',
  'process_deposit',
  'check_investment_needed',
  'record_investment',
  'record_yield',
  'authorize_withdrawal',
  'process_withdrawal',
];

async function closeCompDef(
  program: Program<GhostPool>,
  compDefOffset: number,
  payer: anchor.web3.Keypair
) {
  const compDefAddress = getComputationAccAddress(new anchor.BN(CLUSTER_OFFSET), new anchor.BN(compDefOffset));

  console.log(`🗑️  Closing comp def at offset ${compDefOffset}...`);

  try {
    // Check if account exists
    const accountInfo = await program.provider.connection.getAccountInfo(compDefAddress);
    if (!accountInfo) {
      console.log(`   ⏭️  Comp def doesn't exist, skipping`);
      return;
    }

    // Close the account (transfer rent back to payer)
    // Note: This requires the program to have a close instruction
    // For now, we'll just log that we would close it
    console.log(`   ✅ Would close comp def at ${compDefAddress.toBase58()}`);
    console.log(`   💡 Account has ${accountInfo.lamports} lamports`);
  } catch (error: any) {
    console.error(`   ❌ Error checking comp def:`, error.message);
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║       Reinitialize Comp Defs with Offchain Storage           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Setup connection and provider
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed');
  const wallet = anchor.AnchorProvider.env().wallet;
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const program = anchor.workspace.GhostPool as Program<GhostPool>;
  const payer = (wallet as anchor.Wallet).payer;

  console.log(`📡 RPC: ${RPC_URL.substring(0, 50)}...`);
  console.log(`🔑 Program: ${program.programId.toBase58()}`);
  console.log(`👤 Payer: ${payer.publicKey.toBase58()}\n`);

  // Step 1: Check existing comp defs
  console.log('📋 Checking existing computation definitions...\n');

  for (let i = 0; i < CIRCUITS.length; i++) {
    const circuit = CIRCUITS[i];
    const compDefAddress = getComputationAccAddress(new anchor.BN(CLUSTER_OFFSET), new anchor.BN(i));

    try {
      const accountInfo = await connection.getAccountInfo(compDefAddress);
      if (accountInfo) {
        console.log(`✅ ${circuit.padEnd(25)} - EXISTS (${compDefAddress.toBase58()})`);
      } else {
        console.log(`❌ ${circuit.padEnd(25)} - NOT FOUND`);
      }
    } catch (error) {
      console.log(`❌ ${circuit.padEnd(25)} - ERROR`);
    }
  }

  console.log('\n' + '─'.repeat(80) + '\n');
  console.log('⚠️  IMPORTANT: Closing and reinitializing comp defs\n');
  console.log('Current approach:');
  console.log('1. The program needs to be upgraded with offchain storage code');
  console.log('2. Existing comp defs were initialized with onchain storage (bytecode)');
  console.log('3. New program uses CircuitSource::OffChain with IPFS URLs\n');

  console.log('Two options:\n');
  console.log('Option A: Use new comp def offsets (100-106 instead of 0-6)');
  console.log('  ✅ Keeps existing comp defs intact');
  console.log('  ✅ No need to close accounts');
  console.log('  ✅ Can initialize immediately after program upgrade\n');

  console.log('Option B: Close existing comp defs and reuse offsets 0-6');
  console.log('  ⚠️  Requires program upgrade first');
  console.log('  ⚠️  Needs close instruction in program');
  console.log('  ⚠️  More complex process\n');

  console.log('📝 Recommended: Use Option A (new offsets 100-106)');
  console.log('\n' + '─'.repeat(80) + '\n');

  console.log('Next steps:');
  console.log('1. ✅ Circuits uploaded to IPFS');
  console.log('2. ✅ Program code updated with offchain storage');
  console.log('3. ⏳ Deploy updated program to devnet');
  console.log('4. ⏳ Initialize comp defs at new offsets (100-106)');
  console.log('5. ⏳ Update test scripts to use new offsets\n');
}

main().catch(console.error);
