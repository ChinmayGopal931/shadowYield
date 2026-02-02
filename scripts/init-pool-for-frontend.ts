/**
 * Initialize Ghost Pool for Frontend Testing
 *
 * This script:
 * 1. Creates a test USDC mint
 * 2. Sets up Mock Kamino lending market + reserve
 * 3. Initializes Ghost Pool with your default keypair as authority
 * 4. Mints test USDC to a specified wallet
 *
 * Usage: npx ts-node scripts/init-pool-for-frontend.ts [recipient_wallet]
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import { MockKamino } from '../target/types/mock_kamino';
import {
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
} from '@arcium-hq/client';
import { randomBytes } from 'crypto';
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';

const CLUSTER_OFFSET = 456;
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

function computeCompDefOffset(name: string): number {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

async function awaitCallbackWithTimeout(
  connection: anchor.web3.Connection,
  accountAddress: PublicKey,
  expectedOwner: PublicKey,
  timeoutMs: number = 60000
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const account = await connection.getAccountInfo(accountAddress);
      if (account && account.owner.equals(expectedOwner) && account.data.length > 100) {
        return true;
      }
    } catch (e) {
      // Account may not exist yet
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    process.stdout.write('.');
  }
  return false;
}

async function main() {
  // Get recipient wallet from args or use default
  const recipientArg = process.argv[2];

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ghostPoolProgram = anchor.workspace.GhostPool as Program<GhostPool>;
  const mockKaminoProgram = anchor.workspace.MockKamino as Program<MockKamino>;

  // Use a fresh keypair as authority to get a new pool
  // (The default wallet may already have a pool)
  const authorityKeypair = anchor.web3.Keypair.generate();
  const authority = authorityKeypair.publicKey;
  const mainWallet = provider.wallet.publicKey;
  const mxeAccount = getMXEAccAddress(ghostPoolProgram.programId);

  // Fund the new authority from main wallet
  console.log('Funding new authority keypair from main wallet...');
  const transferIx = anchor.web3.SystemProgram.transfer({
    fromPubkey: mainWallet,
    toPubkey: authority,
    lamports: 2 * LAMPORTS_PER_SOL,
  });
  const tx = new anchor.web3.Transaction().add(transferIx);
  await provider.sendAndConfirm(tx);
  console.log('Funded with 2 SOL');

  console.log('=== Ghost Pool Frontend Initialization (v9) ===\n');
  console.log('Main Wallet:', mainWallet.toBase58());
  console.log('Pool Authority (new):', authority.toBase58());
  console.log('Ghost Pool Program:', ghostPoolProgram.programId.toBase58());
  console.log('Mock Kamino Program:', mockKaminoProgram.programId.toBase58());

  // Derive Ghost Pool PDA
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), authority.toBuffer()],
    ghostPoolProgram.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    ghostPoolProgram.programId
  );

  console.log('\nDerived Addresses:');
  console.log('  Ghost Pool PDA:', ghostPool.toBase58());
  console.log('  Vault PDA:', vault.toBase58());

  // Check if pool already exists
  const existingPool = await provider.connection.getAccountInfo(ghostPool);
  if (existingPool) {
    console.log('\n*** Ghost Pool already exists! ***');
    console.log('Pool data length:', existingPool.data.length, 'bytes');

    // Still need to set up USDC mint for the user
    // Try to read the existing pool to get USDC mint
    // For now, just exit
    console.log('\nTo mint USDC, you need the USDC mint address from the existing pool.');
    return;
  }

  // ==========================================
  // STEP 1: Create USDC Mint
  // ==========================================
  console.log('\n--- Step 1: Creating Test USDC Mint ---');

  // Use main wallet as mint authority so we can mint tokens
  const usdcMint = await createMint(
    provider.connection,
    provider.wallet.payer,
    mainWallet,  // mint authority = main wallet
    mainWallet,  // freeze authority
    6
  );
  console.log('USDC Mint:', usdcMint.toBase58());

  // ==========================================
  // STEP 2: Set up Mock Kamino
  // ==========================================
  console.log('\n--- Step 2: Setting up Mock Kamino ---');

  // Use mainWallet for Kamino (separate from Ghost Pool authority)
  const [lendingMarket] = PublicKey.findProgramAddressSync(
    [Buffer.from('lending_market'), mainWallet.toBuffer()],
    mockKaminoProgram.programId
  );

  const existingMarket = await provider.connection.getAccountInfo(lendingMarket);
  if (!existingMarket) {
    await mockKaminoProgram.methods
      .initLendingMarket()
      .accountsPartial({ authority: mainWallet })
      .rpc();
    console.log('Lending market initialized:', lendingMarket.toBase58());
  } else {
    console.log('Lending market exists:', lendingMarket.toBase58());
  }

  const [lendingMarketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('lending_market_authority'), lendingMarket.toBuffer()],
    mockKaminoProgram.programId
  );

  // Create cToken mint
  const cTokenMint = await createMint(
    provider.connection,
    provider.wallet.payer,
    lendingMarketAuthority,
    null,
    6
  );
  console.log('cToken Mint:', cTokenMint.toBase58());

  // Derive reserve PDAs
  const [reserve] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve'), lendingMarket.toBuffer(), usdcMint.toBuffer()],
    mockKaminoProgram.programId
  );

  // Initialize reserve (use mainWallet as authority)
  await mockKaminoProgram.methods
    .initReserve(new BN(1_000_000))
    .accountsPartial({
      authority: mainWallet,
      lendingMarket,
      liquidityMint: usdcMint,
      collateralMint: cTokenMint,
    })
    .rpc();
  console.log('Reserve initialized:', reserve.toBase58());

  // ==========================================
  // STEP 3: Initialize Ghost Pool
  // ==========================================
  console.log('\n--- Step 3: Initializing Ghost Pool ---');

  const initOffset = new BN(randomBytes(8));
  const initNonce = new BN(randomBytes(16));
  const threshold = new BN(100_000_000); // 100 USDC threshold

  const compDefAccount = getCompDefAccAddress(
    ghostPoolProgram.programId,
    computeCompDefOffset('init_pool_state')
  );

  console.log('Sending initialize transaction...');
  const initTx = await ghostPoolProgram.methods
    .initializePool(initOffset, initNonce, threshold)
    .accountsPartial({
      authority,
      ghostPool,
      usdcMint,
      vault,
      mxeAccount,
      compDefAccount,
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, initOffset),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      arciumProgram: ARCIUM_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorityKeypair])
    .rpc();

  console.log('Init TX:', initTx);
  console.log('Waiting for MPC callback (up to 60s)...');

  const success = await awaitCallbackWithTimeout(
    provider.connection,
    ghostPool,
    ghostPoolProgram.programId,
    60000
  );

  if (success) {
    console.log('\nGhost Pool initialized successfully!');
  } else {
    console.log('\nWarning: Timeout - check transaction on explorer');
  }

  // ==========================================
  // STEP 4: Mint USDC to recipient
  // ==========================================
  const recipient = recipientArg
    ? new PublicKey(recipientArg)
    : mainWallet;  // Default to main wallet

  console.log('\n--- Step 4: Minting Test USDC ---');
  console.log('Recipient:', recipient.toBase58());

  const recipientAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer,
    usdcMint,
    recipient
  );

  const mintAmount = 10_000_000_000; // 10,000 USDC
  await mintTo(
    provider.connection,
    provider.wallet.payer,
    usdcMint,
    recipientAta.address,
    mainWallet,  // mint authority is main wallet
    mintAmount
  );

  console.log('Minted', mintAmount / 1_000_000, 'USDC to', recipientAta.address.toBase58());

  // ==========================================
  // Summary
  // ==========================================
  console.log('\n========================================');
  console.log('=== FRONTEND CONFIGURATION ===');
  console.log('========================================');
  console.log('\nUpdate frontend/src/pages/HomePage.tsx:');
  console.log(`const GHOST_POOL_AUTHORITY = new PublicKey('${authority.toBase58()}')`);
  console.log('\nUpdate frontend/src/config/constants.ts (if needed):');
  console.log(`export const USDC_MINT = new PublicKey('${usdcMint.toBase58()}')`);
  console.log('\nAddresses:');
  console.log('  Ghost Pool:', ghostPool.toBase58());
  console.log('  Vault:', vault.toBase58());
  console.log('  USDC Mint:', usdcMint.toBase58());
  console.log('  cToken Mint:', cTokenMint.toBase58());
  console.log('  Reserve:', reserve.toBase58());
  console.log('\nRecipient USDC Balance: 10,000 USDC');
  console.log('========================================');
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.logs) {
    console.error('\nLogs:');
    e.logs.forEach((log: string) => console.error('  ', log));
  }
  process.exit(1);
});
