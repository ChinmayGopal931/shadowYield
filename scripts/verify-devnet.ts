/**
 * Quick devnet verification script
 * Checks if the existing Ghost Pool deployment is working
 */

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import { PublicKey } from '@solana/web3.js';
import { getMXEAccAddress, getMXEPublicKey } from '@arcium-hq/client';

// Existing pool from PROJECT_STATUS.md
const POOL_AUTHORITY = new PublicKey('8YGx7Q2kP1F8Bt5qeaMEX3k6ZdiVu82zHHctoDZo6QGu');
const GHOST_POOL_PDA = new PublicKey('5jmBRB2QSCkDWxUwGeeYSKM64t79FJcNawHKv2ACWR7m');
const VAULT_PDA = new PublicKey('AHKERJBbWGg64ZappKcmUcTzRjuP6k8NKTwS6wezVTAw');
const USDC_MINT = new PublicKey('6Rne9h8p8maqR1Ts5SaCcRE9eaxyVXBfRs8zH62goDSo');

async function main() {
  console.log('=== Ghost Pool Devnet Verification ===\n');

  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GhostPool as Program<GhostPool>;

  console.log('RPC:', provider.connection.rpcEndpoint);
  console.log('Program ID:', program.programId.toBase58());
  console.log('');

  // Check 1: Program exists
  console.log('1. Checking program deployment...');
  const programInfo = await provider.connection.getAccountInfo(program.programId);
  if (programInfo) {
    console.log('   ✅ Program deployed, size:', programInfo.data.length, 'bytes');
  } else {
    console.log('   ❌ Program NOT found');
    return;
  }

  // Check 2: MXE Account
  console.log('\n2. Checking MXE account...');
  const mxeAccount = getMXEAccAddress(program.programId);
  console.log('   MXE Account:', mxeAccount.toBase58());
  const mxeInfo = await provider.connection.getAccountInfo(mxeAccount);
  if (mxeInfo) {
    console.log('   ✅ MXE account exists, size:', mxeInfo.data.length, 'bytes');
  } else {
    console.log('   ❌ MXE account NOT found');
    return;
  }

  // Check 3: MXE Public Key (for encryption)
  console.log('\n3. Checking MXE public key...');
  try {
    const mxePubkey = await getMXEPublicKey(provider, program.programId);
    if (mxePubkey) {
      console.log('   ✅ MXE public key available:', Buffer.from(mxePubkey).toString('hex').slice(0, 32) + '...');
    } else {
      console.log('   ❌ MXE public key NOT available');
    }
  } catch (e: any) {
    console.log('   ❌ Error getting MXE pubkey:', e.message);
  }

  // Check 4: Ghost Pool PDA
  console.log('\n4. Checking Ghost Pool PDA...');
  console.log('   Expected PDA:', GHOST_POOL_PDA.toBase58());
  try {
    const poolAccount = await program.account.ghostPool.fetch(GHOST_POOL_PDA);
    console.log('   ✅ Pool exists!');
    console.log('   - Authority:', poolAccount.authority.toBase58());
    console.log('   - USDC Mint:', poolAccount.usdcMint.toBase58());
    console.log('   - Total Deposits:', poolAccount.totalDeposits.toString());
    console.log('   - Total Withdrawals:', poolAccount.totalWithdrawals.toString());
    console.log('   - State Nonce:', poolAccount.stateNonce.toString());
    console.log('   - Investment Threshold:', poolAccount.investmentThreshold.toString());
  } catch (e: any) {
    console.log('   ❌ Pool NOT found or error:', e.message);
  }

  // Check 5: Vault
  console.log('\n5. Checking Vault...');
  console.log('   Expected Vault:', VAULT_PDA.toBase58());
  try {
    const vaultBalance = await provider.connection.getTokenAccountBalance(VAULT_PDA);
    console.log('   ✅ Vault exists!');
    console.log('   - Balance:', vaultBalance.value.uiAmount, 'USDC');
    console.log('   - Raw amount:', vaultBalance.value.amount);
  } catch (e: any) {
    console.log('   ❌ Vault NOT found or error:', e.message);
  }

  // Check 6: USDC Mint
  console.log('\n6. Checking USDC Mint...');
  console.log('   Expected Mint:', USDC_MINT.toBase58());
  try {
    const mintInfo = await provider.connection.getAccountInfo(USDC_MINT);
    if (mintInfo) {
      console.log('   ✅ USDC Mint exists, size:', mintInfo.data.length, 'bytes');
    } else {
      console.log('   ❌ USDC Mint NOT found');
    }
  } catch (e: any) {
    console.log('   ❌ Error:', e.message);
  }

  // Check 7: Comp Defs
  console.log('\n7. Checking Comp Defs...');
  const compDefs = [
    { name: 'init_pool_state', address: '78g6xnwaZsw14MXKCG7rNaKu5zePxqjcXU1TpLuhCL7Z' },
    { name: 'process_deposit', address: '73DERH4q8viKTMWMAqnNrak3zGK9tdAAd6JyqPwrqNS6' },
    { name: 'authorize_withdrawal', address: '23UGJLXTDew9QGPCjhSBnfuLCWT5x6cKNmFyv9MhrKYh' },
  ];

  for (const cd of compDefs) {
    const info = await provider.connection.getAccountInfo(new PublicKey(cd.address));
    if (info) {
      console.log(`   ✅ ${cd.name}: ${cd.address.slice(0, 8)}...`);
    } else {
      console.log(`   ❌ ${cd.name}: NOT FOUND`);
    }
  }

  console.log('\n=== Verification Complete ===\n');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
