import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import {
  awaitComputationFinalization,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
} from '@arcium-hq/client';
import { randomBytes } from 'crypto';
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
} from '@solana/spl-token';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.GhostPool as Program<GhostPool>;

  const CLUSTER_OFFSET = 456;
  const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

  const authority = provider.wallet.publicKey;
  const mxeAccount = getMXEAccAddress(program.programId);

  // Compute comp def offset for deposit
  function computeCompDefOffset(name: string): number {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(name).digest();
    return hash.readUInt32LE(0);
  }

  // Get existing pool PDA
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), authority.toBuffer()],
    program.programId
  );

  console.log('=== Test Deposit with Fixed Callback ===');
  console.log('Program ID:', program.programId.toBase58());
  console.log('Authority:', authority.toBase58());
  console.log('Ghost Pool:', ghostPool.toBase58());
  console.log('MXE Account:', mxeAccount.toBase58());

  // Check if pool exists
  const poolAccount = await program.account.ghostPool.fetch(ghostPool);
  console.log('\nExisting Pool State:');
  console.log('- Authority:', poolAccount.authority.toBase58());
  console.log('- USDC Mint:', poolAccount.usdcMint.toBase58());
  console.log('- Total Deposits:', poolAccount.totalDeposits.toString());
  console.log('- State Nonce:', poolAccount.stateNonce.toString());

  // Get or create USDC token account for user
  const usdcMint = poolAccount.usdcMint;

  // Get vault PDA
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    program.programId
  );
  console.log('Vault:', vault.toBase58());

  // Get user's token account
  let userTokenAccount;
  try {
    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      usdcMint,
      authority
    );
    console.log('User Token Account:', userTokenAccount.address.toBase58());
    console.log('User Token Balance:', userTokenAccount.amount.toString());
  } catch (err) {
    console.log('Creating user token account...');
    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      usdcMint,
      authority
    );
  }

  // Mint some test tokens if balance is low
  if (userTokenAccount.amount < BigInt(1_000_000)) {
    console.log('\nMinting test USDC...');
    try {
      await mintTo(
        provider.connection,
        provider.wallet.payer,
        usdcMint,
        userTokenAccount.address,
        authority,
        100_000_000 // 100 USDC
      );
      console.log('Minted 100 USDC to user account');
    } catch (err) {
      console.log('Could not mint (not mint authority):', err.message);
    }
  }

  // Create deposit
  const depositAmount = new BN(1_000_000); // 1 USDC
  const password = 'test_password_123';
  const passwordHash = require('crypto').createHash('sha256').update(password).digest();
  const encryptedPasswordHash = new Uint8Array(32);
  encryptedPasswordHash.set(passwordHash.slice(0, 32));

  // Generate random public key for encryption (test only)
  const publicKey = randomBytes(32);

  const nonceBytes = randomBytes(16);
  const nonce = new BN(nonceBytes);
  const computationOffsetBytes = randomBytes(8);
  const computationOffset = new BN(computationOffsetBytes);

  console.log('\n=== Submitting Deposit ===');
  console.log('Amount:', depositAmount.toString(), 'lamports (1 USDC)');
  console.log('Computation Offset:', computationOffset.toString());

  const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
  const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
  const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
  const compDefAccount = getCompDefAccAddress(program.programId, computeCompDefOffset('process_deposit'));

  console.log('Computation Account:', computationAccount.toBase58());
  console.log('Comp Def Account:', compDefAccount.toBase58());

  try {
    const tx = await program.methods
      .deposit(
        computationOffset,
        depositAmount,
        Array.from(encryptedPasswordHash) as any,
        Array.from(publicKey) as any,
        nonce
      )
      .accountsPartial({
        user: authority,
        ghostPool: ghostPool,
        userUsdcToken: userTokenAccount.address,
        vaultUsdcToken: vault,
        usdcMint: usdcMint,
        mxeAccount: mxeAccount,
        compDefAccount: compDefAccount,
        computationAccount: computationAccount,
        clusterAccount: clusterAccount,
        mempoolAccount: mempoolAccount,
        executingPool: executingPool,
        arciumProgram: ARCIUM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('\n✅ Deposit queued:', tx);
    console.log('Solscan: https://solscan.io/tx/' + tx + '?cluster=devnet');

    // Wait for MPC computation
    console.log('\nWaiting for MPC computation and callback...');
    console.log('(This may take 5-30 seconds)');

    const finalizeSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      'confirmed'
    );

    console.log('\n✅ Callback received:', finalizeSig);
    console.log('Solscan: https://solscan.io/tx/' + finalizeSig + '?cluster=devnet');

    // Check updated pool state
    const updatedPool = await program.account.ghostPool.fetch(ghostPool);
    console.log('\nUpdated Pool State:');
    console.log('- Total Deposits:', updatedPool.totalDeposits.toString());
    console.log('- State Nonce:', updatedPool.stateNonce.toString());

    console.log('\n🎉 Callback deserialization fix confirmed working!');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.logs) {
      console.error('\nLogs:');
      err.logs.forEach(log => console.error(log));
    }
    throw err;
  }
}

main().catch(console.error);
