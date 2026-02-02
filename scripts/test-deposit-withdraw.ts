/**
 * Test script for deposit + withdrawal flow
 * Uses SDK encryption to debug the withdrawal MPC failure
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
  x25519,
  RescueCipher,
  deserializeLE,
  serializeLE,
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
  getAccount,
  createMint,
} from '@solana/spl-token';

const CLUSTER_OFFSET = 456;
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

function computeCompDefOffset(name: string): number {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

// Hash password like frontend does
function hashPassword(password: string): Uint8Array {
  const hash = createHash('sha256').update(password).digest();
  return new Uint8Array(hash.slice(0, 16)); // First 16 bytes for u128
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ghostPoolProgram = anchor.workspace.GhostPool as Program<GhostPool>;
  const mainWallet = provider.wallet.publicKey;
  const mxeAccount = getMXEAccAddress(ghostPoolProgram.programId);

  console.log('=== Deposit + Withdrawal Test ===\n');
  console.log('Ghost Pool Program:', ghostPoolProgram.programId.toBase58());
  console.log('Main Wallet:', mainWallet.toBase58());
  console.log('MXE Account:', mxeAccount.toBase58());

  // Get MXE public key
  const mxePublicKey = await getMXEPublicKey(provider as anchor.AnchorProvider, ghostPoolProgram.programId);
  if (!mxePublicKey) {
    throw new Error('MXE public key not available');
  }
  console.log('MXE Public Key:', Buffer.from(mxePublicKey).toString('hex'));

  // ==========================================
  // Use existing pool or create new one
  // ==========================================

  // Current pool from PROJECT_STATUS.md
  const poolAuthority = new PublicKey('4HwdR5c5JqNe7vdFTMszUE7qpEbKHrVhsTLHDGLifjXq');
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), poolAuthority.toBuffer()],
    ghostPoolProgram.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    ghostPoolProgram.programId
  );

  console.log('\nUsing existing pool:');
  console.log('  Ghost Pool:', ghostPool.toBase58());
  console.log('  Vault:', vault.toBase58());

  // Fetch pool data
  const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
  console.log('\nPool state:');
  console.log('  Total Deposits:', poolAccount.totalDeposits.toString());
  console.log('  Total Withdrawals:', poolAccount.totalWithdrawals.toString());
  console.log('  USDC Mint:', poolAccount.usdcMint.toBase58());
  console.log('  State Nonce:', poolAccount.stateNonce.toString());

  const usdcMint = poolAccount.usdcMint;

  // ==========================================
  // Create depositor/withdrawer
  // ==========================================
  const user = Keypair.generate();
  const depositAmount = 100_000_000; // 100 USDC
  const password = 'testpassword123';

  console.log('\n--- Setting up user ---');
  console.log('User:', user.publicKey.toBase58());
  console.log('Password:', password);
  console.log('Deposit Amount:', depositAmount / 1_000_000, 'USDC');

  // Fund user
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet,
        toPubkey: user.publicKey,
        lamports: 0.5 * LAMPORTS_PER_SOL,
      })
    ),
    [provider.wallet.payer]
  );

  // Create user's USDC ATA and mint
  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer,
    usdcMint,
    user.publicKey
  );

  // Mint USDC to user (need mint authority)
  // For existing pool, we need to use the existing mint
  // Let's check if main wallet is mint authority
  try {
    await mintTo(
      provider.connection,
      provider.wallet.payer,
      usdcMint,
      userAta.address,
      mainWallet,
      depositAmount
    );
    console.log('Minted', depositAmount / 1_000_000, 'USDC to user');
  } catch (e) {
    console.log('Could not mint USDC (not mint authority). Using existing balance.');
    const balance = await provider.connection.getTokenAccountBalance(userAta.address);
    console.log('User USDC balance:', balance.value.uiAmount);
    if (!balance.value.uiAmount || balance.value.uiAmount < depositAmount / 1_000_000) {
      throw new Error('User needs USDC for testing');
    }
  }

  // ==========================================
  // DEPOSIT
  // ==========================================
  console.log('\n--- Making Deposit ---');

  const depositOffset = new BN(Date.now());

  // Generate X25519 keypair for the user
  const depositUserPrivateKey = x25519.utils.randomSecretKey();
  const depositUserPublicKey = x25519.getPublicKey(depositUserPrivateKey);

  // Compute shared secret
  const depositSharedSecret = x25519.getSharedSecret(depositUserPrivateKey, mxePublicKey);
  const depositCipher = new RescueCipher(depositSharedSecret);

  // Hash password
  const passwordBytes = hashPassword(password);
  const passwordHashBigInt = deserializeLE(passwordBytes);

  console.log('Password hash bytes:', Buffer.from(passwordBytes).toString('hex'));
  console.log('Password hash BigInt:', passwordHashBigInt.toString(16));

  // Generate nonce for encryption
  const depositNonceBytes = randomBytes(16);
  const depositNonceBigInt = deserializeLE(depositNonceBytes);

  console.log('Deposit nonce:', depositNonceBigInt.toString(16));

  // Encrypt password hash
  const depositPlaintext = [passwordHashBigInt];
  const depositCiphertext = depositCipher.encrypt(depositPlaintext, depositNonceBytes);

  console.log('Encrypted password hash:', Buffer.from(depositCiphertext[0]).toString('hex'));
  console.log('User X25519 pubkey:', Buffer.from(depositUserPublicKey).toString('hex'));

  const userProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(user),
    { commitment: 'confirmed' }
  );
  const userProgram = new Program(ghostPoolProgram.idl, userProvider) as Program<GhostPool>;

  console.log('\nSending deposit transaction...');
  const depositTx = await userProgram.methods
    .deposit(
      depositOffset,
      new BN(depositAmount),
      Array.from(depositCiphertext[0]),
      Array.from(depositUserPublicKey),
      new BN(depositNonceBigInt.toString())
    )
    .accountsPartial({
      user: user.publicKey,
      ghostPool: ghostPool,
      userUsdcToken: userAta.address,
      vaultUsdcToken: vault,
      usdcMint: usdcMint,
      mxeAccount: mxeAccount,
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, depositOffset),
      compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('process_deposit')),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      arciumProgram: ARCIUM_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  console.log('Deposit TX:', depositTx);
  console.log('Waiting for MPC callback (60s)...');

  // Wait for callback
  await new Promise(resolve => setTimeout(resolve, 60000));

  // Check pool state
  const poolAfterDeposit = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
  console.log('\nPool state after deposit:');
  console.log('  Total Deposits:', poolAfterDeposit.totalDeposits.toString());
  console.log('  State Nonce:', poolAfterDeposit.stateNonce.toString());

  // Check vault balance
  const vaultBalance = await provider.connection.getTokenAccountBalance(vault);
  console.log('  Vault Balance:', vaultBalance.value.uiAmount, 'USDC');

  if (poolAfterDeposit.totalDeposits.toString() === poolAccount.totalDeposits.toString()) {
    console.log('\n⚠️ WARNING: totalDeposits did not increment. MPC callback may have failed.');
  } else {
    console.log('\n✅ Deposit MPC callback succeeded!');
  }

  // ==========================================
  // WITHDRAWAL
  // ==========================================
  console.log('\n--- Making Withdrawal ---');

  const withdrawOffset = new BN(Date.now());

  // Generate NEW X25519 keypair for withdrawal
  const withdrawUserPrivateKey = x25519.utils.randomSecretKey();
  const withdrawUserPublicKey = x25519.getPublicKey(withdrawUserPrivateKey);

  // Compute shared secret with same MXE public key
  const withdrawSharedSecret = x25519.getSharedSecret(withdrawUserPrivateKey, mxePublicKey);
  const withdrawCipher = new RescueCipher(withdrawSharedSecret);

  // Use SAME password hash
  console.log('Password hash BigInt (same as deposit):', passwordHashBigInt.toString(16));

  // Generate NEW nonce for encryption
  const withdrawNonceBytes = randomBytes(16);
  const withdrawNonceBigInt = deserializeLE(withdrawNonceBytes);

  console.log('Withdraw nonce:', withdrawNonceBigInt.toString(16));

  // Encrypt password hash with NEW shared secret
  const withdrawPlaintext = [passwordHashBigInt];
  const withdrawCiphertext = withdrawCipher.encrypt(withdrawPlaintext, withdrawNonceBytes);

  console.log('Encrypted password hash:', Buffer.from(withdrawCiphertext[0]).toString('hex'));
  console.log('User X25519 pubkey:', Buffer.from(withdrawUserPublicKey).toString('hex'));

  console.log('\nSending withdraw transaction...');
  const withdrawTx = await userProgram.methods
    .withdraw(
      withdrawOffset,
      new BN(depositAmount), // Withdraw same amount
      Array.from(withdrawCiphertext[0]),
      Array.from(withdrawUserPublicKey),
      new BN(withdrawNonceBigInt.toString())
    )
    .accountsPartial({
      user: user.publicKey,
      ghostPool: ghostPool,
      mxeAccount: mxeAccount,
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, withdrawOffset),
      compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('authorize_withdrawal')),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: SystemProgram.programId,
      arciumProgram: ARCIUM_PROGRAM_ID,
    })
    .signers([user])
    .rpc();

  console.log('Withdraw TX:', withdrawTx);
  console.log('Waiting for MPC callback (60s)...');

  // Wait for callback
  await new Promise(resolve => setTimeout(resolve, 60000));

  // Check pool state
  const poolAfterWithdraw = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
  console.log('\nPool state after withdrawal:');
  console.log('  Total Deposits:', poolAfterWithdraw.totalDeposits.toString());
  console.log('  Total Withdrawals:', poolAfterWithdraw.totalWithdrawals.toString());

  if (poolAfterWithdraw.totalWithdrawals.toString() === poolAfterDeposit.totalWithdrawals?.toString()) {
    console.log('\n❌ WITHDRAWAL FAILED: totalWithdrawals did not increment.');
    console.log('Check callback transaction for error details.');
  } else {
    console.log('\n✅ Withdrawal MPC callback succeeded!');
  }

  console.log('\n=== Test Complete ===');
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.logs) {
    console.error('\nLogs:');
    e.logs.forEach((log: string) => console.error('  ', log));
  }
  process.exit(1);
});
