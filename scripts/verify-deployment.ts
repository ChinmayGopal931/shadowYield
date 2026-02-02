import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import {
  getMXEAccAddress,
  getCompDefAccAddress,
} from '@arcium-hq/client';
import { PublicKey, Connection } from '@solana/web3.js';

const RPC_URL = process.env.ANCHOR_PROVIDER_URL ||
  'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GhostPool as Program<GhostPool>;
  const authority = provider.wallet.publicKey;

  console.log('\n========================================');
  console.log('Ghost Pool Deployment Verification');
  console.log('========================================\n');

  // Get PDAs
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), authority.toBuffer()],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    program.programId
  );
  const mxeAccount = getMXEAccAddress(program.programId);

  console.log('📍 Addresses:');
  console.log('  Program ID:', program.programId.toBase58());
  console.log('  Authority:', authority.toBase58());
  console.log('  Ghost Pool:', ghostPool.toBase58());
  console.log('  Vault:', vault.toBase58());
  console.log('  MXE Account:', mxeAccount.toBase58());

  // Check program exists
  console.log('\n🔍 Verifying deployments...\n');

  const programInfo = await connection.getAccountInfo(program.programId);
  console.log(`  Program: ${programInfo ? '✅ Deployed' : '❌ Not found'}`);
  if (programInfo) {
    console.log(`    - Executable: ${programInfo.executable}`);
    console.log(`    - Size: ${programInfo.data.length} bytes`);
  }

  // Check MXE account
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  console.log(`  MXE Account: ${mxeInfo ? '✅ Initialized' : '❌ Not found'}`);

  // Check comp defs
  const compDefNames = [
    'init_pool_state',
    'process_deposit',
    'check_investment_needed',
    'record_investment',
    'record_yield',
    'authorize_withdrawal',
    'process_withdrawal'
  ];

  console.log('\n📋 Computation Definitions:');
  for (const name of compDefNames) {
    const hash = require('crypto').createHash('sha256').update(name).digest();
    const offset = hash.readUInt32LE(0);
    const compDef = getCompDefAccAddress(program.programId, offset);
    const info = await connection.getAccountInfo(compDef);
    console.log(`  ${name}: ${info ? '✅' : '❌'} ${compDef.toBase58().slice(0, 12)}...`);
  }

  // Check pool account
  console.log('\n🏊 Pool State:');
  const poolInfo = await connection.getAccountInfo(ghostPool);
  if (poolInfo) {
    console.log('  Account exists: ✅');
    console.log(`  Size: ${poolInfo.data.length} bytes`);
    console.log(`  Owner: ${poolInfo.owner.toBase58()}`);

    // Try to fetch via Anchor
    try {
      const poolAccount = await program.account.ghostPool.fetch(ghostPool);
      console.log('\n  Pool Data:');
      console.log(`    Authority: ${poolAccount.authority.toBase58()}`);
      console.log(`    USDC Mint: ${poolAccount.usdcMint.toBase58()}`);
      console.log(`    Vault Bump: ${poolAccount.vaultBump}`);
      console.log(`    Investment Threshold: ${poolAccount.investmentThreshold.toString()}`);
      console.log(`    Total Deposits: ${poolAccount.totalDeposits.toString()}`);
      console.log(`    Total Invested: ${poolAccount.totalInvested.toString()}`);
      console.log(`    State Nonce: ${poolAccount.stateNonce.toString()}`);

      // Check encrypted state
      const encryptedState = poolAccount.encryptedState as number[][];
      const nonZeroElements = encryptedState.filter(arr =>
        arr.some(byte => byte !== 0)
      ).length;
      console.log(`\n  Encrypted State (37 elements):`);
      console.log(`    Non-zero elements: ${nonZeroElements}`);
      console.log(`    MPC Callback: ${nonZeroElements > 0 ? '✅ Received' : '⏳ Pending'}`);

      if (nonZeroElements > 0) {
        console.log('\n  🎉 Pool is fully initialized!');
      } else {
        console.log('\n  ⏳ Waiting for Arcium MPC callback...');
        console.log('     MPC computations can take 30+ minutes on devnet.');
      }
    } catch (e) {
      console.log('  Could not parse pool data:', e.message);
    }
  } else {
    console.log('  Account exists: ❌ Not found');
  }

  // Check vault account
  const vaultInfo = await connection.getAccountInfo(vault);
  console.log(`\n💰 Vault: ${vaultInfo ? '✅ Exists' : '❌ Not found'}`);
  if (vaultInfo) {
    console.log(`  Balance: ${vaultInfo.lamports / 1e9} SOL`);
  }

  // Transaction history
  console.log('\n📜 Recent Transactions on Pool:');
  try {
    const sigs = await connection.getSignaturesForAddress(ghostPool, { limit: 5 });
    if (sigs.length === 0) {
      console.log('  No transactions found');
    } else {
      for (const sig of sigs) {
        const date = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'unknown';
        console.log(`  ${sig.signature.slice(0, 20)}... @ ${date}`);
      }
    }
  } catch (e) {
    console.log('  Error fetching transactions:', e.message);
  }

  console.log('\n========================================');
  console.log('Verification Complete');
  console.log('========================================\n');
}

main().catch(console.error);
