/**
 * Test the EXISTING working pool on devnet
 * Uses the pool from PROJECT_STATUS.md
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import {
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
  getMXEPublicKey,
  awaitComputationFinalization,
  x25519,
  RescueCipher,
  deserializeLE,
} from '@arcium-hq/client';
import { createHash, randomBytes } from 'crypto';
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';

// EXISTING WORKING POOL from PROJECT_STATUS.md
const EXISTING_POOL = {
  authority: new PublicKey('8YGx7Q2kP1F8Bt5qeaMEX3k6ZdiVu82zHHctoDZo6QGu'),
  ghostPool: new PublicKey('5jmBRB2QSCkDWxUwGeeYSKM64t79FJcNawHKv2ACWR7m'),
  vault: new PublicKey('AHKERJBbWGg64ZappKcmUcTzRjuP6k8NKTwS6wezVTAw'),
  usdcMint: new PublicKey('6Rne9h8p8maqR1Ts5SaCcRE9eaxyVXBfRs8zH62goDSo'),
};

const CLUSTER_OFFSET = 456;
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

function computeCompDefOffset(name: string): number {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

function hashPassword(password: string): Uint8Array {
  const hash = createHash('sha256').update(password).digest();
  return new Uint8Array(hash.slice(0, 16));
}

async function main() {
  console.log('=== Test Existing Pool on Devnet ===\n');

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GhostPool as Program<GhostPool>;
  const mainWallet = provider.wallet.publicKey;

  console.log('Program ID:', program.programId.toBase58());
  console.log('Main Wallet:', mainWallet.toBase58());
  console.log('Ghost Pool:', EXISTING_POOL.ghostPool.toBase58());
  console.log('Vault:', EXISTING_POOL.vault.toBase58());
  console.log('USDC Mint:', EXISTING_POOL.usdcMint.toBase58());

  // Verify pool exists
  console.log('\n--- Verifying Pool ---');
  const poolAccount = await program.account.ghostPool.fetch(EXISTING_POOL.ghostPool);
  console.log('Total Deposits:', poolAccount.totalDeposits.toString());
  console.log('Total Withdrawals:', poolAccount.totalWithdrawals.toString());
  console.log('State Nonce:', poolAccount.stateNonce.toString());

  // Get vault balance
  const vaultBalance = await provider.connection.getTokenAccountBalance(EXISTING_POOL.vault);
  console.log('Vault Balance:', vaultBalance.value.uiAmount, 'USDC');

  // Get MXE public key
  console.log('\n--- Getting MXE Public Key ---');
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxePublicKey = await getMXEPublicKey(provider, program.programId);
  if (!mxePublicKey) {
    throw new Error('MXE public key not available');
  }
  console.log('MXE Public Key:', Buffer.from(mxePublicKey).toString('hex').slice(0, 32) + '...');

  // Create test user
  console.log('\n--- Creating Test User ---');
  const user = Keypair.generate();
  const password = 'test_password_' + Date.now();
  const depositAmount = 50_000_000; // 50 USDC

  console.log('User:', user.publicKey.toBase58());
  console.log('Password:', password);
  console.log('Deposit Amount:', depositAmount / 1_000_000, 'USDC');

  // Fund user with SOL
  console.log('Funding user with SOL...');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mainWallet,
      toPubkey: user.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(provider.connection, fundTx, [provider.wallet.payer]);

  // Create user's USDC ATA and mint tokens
  console.log('Creating user USDC ATA...');
  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer,
    EXISTING_POOL.usdcMint,
    user.publicKey
  );
  console.log('User ATA:', userAta.address.toBase58());

  console.log('Minting', depositAmount / 1_000_000, 'USDC to user...');
  await mintTo(
    provider.connection,
    provider.wallet.payer,
    EXISTING_POOL.usdcMint,
    userAta.address,
    mainWallet,
    depositAmount
  );

  // Verify user balance
  const userBalance = await provider.connection.getTokenAccountBalance(userAta.address);
  console.log('User USDC Balance:', userBalance.value.uiAmount, 'USDC');

  // ==========================================
  // DEPOSIT
  // ==========================================
  console.log('\n--- Making Deposit ---');

  // Generate encryption keypair
  const depositPrivateKey = x25519.utils.randomSecretKey();
  const depositPublicKey = x25519.getPublicKey(depositPrivateKey);
  const depositSharedSecret = x25519.getSharedSecret(depositPrivateKey, mxePublicKey);
  const depositCipher = new RescueCipher(depositSharedSecret);

  // Hash and encrypt password
  const passwordBytes = hashPassword(password);
  const passwordHashBigInt = deserializeLE(passwordBytes);

  const depositNonceBytes = randomBytes(16);
  const depositNonceBigInt = deserializeLE(depositNonceBytes);
  const depositCiphertext = depositCipher.encrypt([passwordHashBigInt], depositNonceBytes);

  console.log('Password encrypted');

  const depositOffset = new BN(Date.now());
  const depositComputation = getComputationAccAddress(CLUSTER_OFFSET, depositOffset);

  // Create user provider
  const userProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(user),
    { commitment: 'confirmed' }
  );
  const userProgram = new Program(program.idl, userProvider) as Program<GhostPool>;

  console.log('Sending deposit transaction...');
  const depositStartTime = Date.now();

  try {
    const depositTx = await userProgram.methods
      .deposit(
        depositOffset,
        new BN(depositAmount),
        Array.from(depositCiphertext[0]) as any,
        Array.from(depositPublicKey) as any,
        new BN(depositNonceBigInt.toString())
      )
      .accountsPartial({
        user: user.publicKey,
        ghostPool: EXISTING_POOL.ghostPool,
        userUsdcToken: userAta.address,
        vaultUsdcToken: EXISTING_POOL.vault,
        usdcMint: EXISTING_POOL.usdcMint,
        mxeAccount: mxeAccount,
        compDefAccount: getCompDefAccAddress(program.programId, computeCompDefOffset('process_deposit')),
        computationAccount: depositComputation,
        clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        arciumProgram: ARCIUM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log('Deposit TX:', depositTx);
    console.log('Waiting for MPC callback (this may take 60-120s)...');

    const depositFinalize = await awaitComputationFinalization(
      provider,
      depositOffset,
      program.programId,
      'confirmed'
    );
    console.log('Deposit finalized:', depositFinalize);
    console.log('Deposit completed in', ((Date.now() - depositStartTime) / 1000).toFixed(1), 'seconds');

    // Verify deposit
    const poolAfterDeposit = await program.account.ghostPool.fetch(EXISTING_POOL.ghostPool);
    console.log('\n--- After Deposit ---');
    console.log('Total Deposits:', poolAfterDeposit.totalDeposits.toString());

    const vaultAfterDeposit = await provider.connection.getTokenAccountBalance(EXISTING_POOL.vault);
    console.log('Vault Balance:', vaultAfterDeposit.value.uiAmount, 'USDC');

    console.log('\n✅ DEPOSIT SUCCESSFUL!');

  } catch (err: any) {
    console.error('❌ Deposit failed:', err.message);
    if (err.logs) {
      console.error('Logs:');
      err.logs.slice(-15).forEach((log: string) => console.error('  ', log));
    }
    throw err;
  }

  // ==========================================
  // WITHDRAWAL
  // ==========================================
  console.log('\n--- Making Withdrawal ---');

  // Generate NEW encryption keypair for withdrawal
  const withdrawPrivateKey = x25519.utils.randomSecretKey();
  const withdrawPublicKey = x25519.getPublicKey(withdrawPrivateKey);
  const withdrawSharedSecret = x25519.getSharedSecret(withdrawPrivateKey, mxePublicKey);
  const withdrawCipher = new RescueCipher(withdrawSharedSecret);

  // Encrypt SAME password hash
  const withdrawNonceBytes = randomBytes(16);
  const withdrawNonceBigInt = deserializeLE(withdrawNonceBytes);
  const withdrawCiphertext = withdrawCipher.encrypt([passwordHashBigInt], withdrawNonceBytes);

  console.log('Password encrypted for withdrawal');

  const withdrawOffset = new BN(Date.now());
  const withdrawComputation = getComputationAccAddress(CLUSTER_OFFSET, withdrawOffset);

  console.log('Sending withdrawal transaction...');
  const withdrawStartTime = Date.now();

  try {
    const withdrawTx = await userProgram.methods
      .withdraw(
        withdrawOffset,
        new BN(depositAmount),
        Array.from(withdrawCiphertext[0]) as any,
        Array.from(withdrawPublicKey) as any,
        new BN(withdrawNonceBigInt.toString())
      )
      .accountsPartial({
        user: user.publicKey,
        ghostPool: EXISTING_POOL.ghostPool,
        vault: EXISTING_POOL.vault,
        userTokenAccount: userAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        mxeAccount: mxeAccount,
        compDefAccount: getCompDefAccAddress(program.programId, computeCompDefOffset('authorize_withdrawal')),
        computationAccount: withdrawComputation,
        clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        arciumProgram: ARCIUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log('Withdraw TX:', withdrawTx);
    console.log('Waiting for MPC callback (this may take 60-120s)...');

    const withdrawFinalize = await awaitComputationFinalization(
      provider,
      withdrawOffset,
      program.programId,
      'confirmed'
    );
    console.log('Withdrawal finalized:', withdrawFinalize);
    console.log('Withdrawal completed in', ((Date.now() - withdrawStartTime) / 1000).toFixed(1), 'seconds');

    // Verify withdrawal
    const poolAfterWithdraw = await program.account.ghostPool.fetch(EXISTING_POOL.ghostPool);
    console.log('\n--- After Withdrawal ---');
    console.log('Total Withdrawals:', poolAfterWithdraw.totalWithdrawals.toString());

    const vaultAfterWithdraw = await provider.connection.getTokenAccountBalance(EXISTING_POOL.vault);
    console.log('Vault Balance:', vaultAfterWithdraw.value.uiAmount, 'USDC');

    const userFinalBalance = await provider.connection.getTokenAccountBalance(userAta.address);
    console.log('User Balance:', userFinalBalance.value.uiAmount, 'USDC');

    console.log('\n✅ WITHDRAWAL SUCCESSFUL!');

  } catch (err: any) {
    console.error('❌ Withdrawal failed:', err.message);
    if (err.logs) {
      console.error('Logs:');
      err.logs.slice(-15).forEach((log: string) => console.error('  ', log));
    }
    throw err;
  }

  console.log('\n=== TEST COMPLETE ===');
  console.log('Both deposit and withdrawal worked on the existing devnet pool!');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
