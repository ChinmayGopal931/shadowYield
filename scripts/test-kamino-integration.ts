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
  getFeePoolAccAddress,
  getClockAccAddress,
} from '@arcium-hq/client';
import { randomBytes } from 'crypto';
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

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.GhostPool as Program<GhostPool>;

  const mainWallet = provider.wallet.publicKey;
  const mxeAccount = getMXEAccAddress(program.programId);

  console.log('=== Ghost Pool + Kamino Integration Test ===');
  console.log('Program ID:', program.programId.toBase58());
  console.log('Main Wallet:', mainWallet.toBase58());

  // Step 1: Create a test pool
  console.log('\n--- Step 1: Creating Test Pool ---');

  const poolAuthority = Keypair.generate();
  console.log('Pool Authority:', poolAuthority.publicKey.toBase58());

  // Fund the authority
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mainWallet,
      toPubkey: poolAuthority.publicKey,
      lamports: 1 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(provider.connection, fundTx, [provider.wallet.payer]);
  console.log('Funded authority with 1 SOL');

  // Create test USDC mint
  const usdcMint = await createMint(
    provider.connection,
    provider.wallet.payer,
    mainWallet,
    mainWallet,
    6
  );
  console.log('Test USDC Mint:', usdcMint.toBase58());

  // Derive PDAs
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), poolAuthority.publicKey.toBuffer()],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    program.programId
  );

  console.log('Ghost Pool PDA:', ghostPool.toBase58());
  console.log('Vault PDA:', vault.toBase58());

  // Initialize pool with low threshold for testing
  const nonceBytes = randomBytes(16);
  const nonce = new BN(nonceBytes);
  const computationOffsetBytes = randomBytes(8);
  const computationOffset = new BN(computationOffsetBytes);
  const threshold = new BN(100_000_000); // 100 USDC threshold (low for testing)

  const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
  const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
  const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
  const compDefAccount = getCompDefAccAddress(program.programId, computeCompDefOffset('init_pool_state'));

  const poolProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(poolAuthority),
    { commitment: 'confirmed' }
  );
  const poolProgram = new Program(program.idl, poolProvider) as Program<GhostPool>;

  console.log('\nInitializing pool...');

  const initTx = await poolProgram.methods
    .initializePool(computationOffset, nonce, threshold)
    .accountsPartial({
      authority: poolAuthority.publicKey,
      ghostPool: ghostPool,
      usdcMint: usdcMint,
      vault: vault,
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
    .signers([poolAuthority])
    .rpc();

  console.log('Init TX:', initTx);
  console.log('Waiting for callback...');

  const initCallback = await awaitComputationFinalization(
    poolProvider,
    computationOffset,
    program.programId,
    'confirmed'
  );
  console.log('Init Callback:', initCallback);

  // Verify pool state
  let poolAccount = await poolProgram.account.ghostPool.fetch(ghostPool);
  console.log('Pool initialized. Has encrypted state:', poolAccount.encryptedState.some((arr: number[]) => arr.some((b: number) => b !== 0)));

  // Step 2: Deposit USDC
  console.log('\n--- Step 2: Making Deposit ---');

  const depositor = Keypair.generate();
  const depositAmount = 200_000_000; // 200 USDC (above threshold)

  // Fund depositor
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet,
        toPubkey: depositor.publicKey,
        lamports: 0.5 * LAMPORTS_PER_SOL,
      })
    ),
    [provider.wallet.payer]
  );

  // Create depositor's USDC token account and mint tokens
  const depositorAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer,
    usdcMint,
    depositor.publicKey
  );

  await mintTo(
    provider.connection,
    provider.wallet.payer,
    usdcMint,
    depositorAta.address,
    mainWallet,
    depositAmount
  );

  console.log('Depositor:', depositor.publicKey.toBase58());
  console.log('Deposit Amount:', depositAmount / 1_000_000, 'USDC');

  // Make deposit
  const depositOffset = new BN(randomBytes(8));
  const depositNonce = new BN(randomBytes(16));
  const passwordHash = randomBytes(32);
  const userPubkey = randomBytes(32); // X25519 pubkey would go here

  const depositComputation = getComputationAccAddress(CLUSTER_OFFSET, depositOffset);
  const depositCompDef = getCompDefAccAddress(program.programId, computeCompDefOffset('process_deposit'));

  const depositorProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(depositor),
    { commitment: 'confirmed' }
  );
  const depositorProgram = new Program(program.idl, depositorProvider) as Program<GhostPool>;

  const depositTx = await depositorProgram.methods
    .deposit(depositOffset, new BN(depositAmount), Array.from(passwordHash), Array.from(userPubkey), depositNonce)
    .accountsPartial({
      user: depositor.publicKey,
      ghostPool: ghostPool,
      userUsdcToken: depositorAta.address,
      vaultUsdcToken: vault,
      usdcMint: usdcMint,
      mxeAccount: mxeAccount,
      mempoolAccount: mempoolAccount,
      executingPool: executingPool,
      computationAccount: depositComputation,
      compDefAccount: depositCompDef,
      clusterAccount: clusterAccount,
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      arciumProgram: ARCIUM_PROGRAM_ID,
    })
    .signers([depositor])
    .rpc();

  console.log('Deposit TX:', depositTx);
  console.log('Waiting for deposit callback...');

  const depositCallback = await awaitComputationFinalization(
    depositorProvider,
    depositOffset,
    program.programId,
    'confirmed'
  );
  console.log('Deposit Callback:', depositCallback);

  // Verify deposit
  poolAccount = await poolProgram.account.ghostPool.fetch(ghostPool);
  console.log('Total deposits:', poolAccount.totalDeposits.toString());

  // Step 3: Check and invest
  console.log('\n--- Step 3: Check & Invest ---');

  const checkOffset = new BN(randomBytes(8));
  const checkComputation = getComputationAccAddress(CLUSTER_OFFSET, checkOffset);
  const checkCompDef = getCompDefAccAddress(program.programId, computeCompDefOffset('check_investment_needed'));

  const checkTx = await poolProgram.methods
    .checkAndInvest(checkOffset)
    .accountsPartial({
      authority: poolAuthority.publicKey,
      ghostPool: ghostPool,
      mxeAccount: mxeAccount,
      mempoolAccount: mempoolAccount,
      executingPool: executingPool,
      computationAccount: checkComputation,
      compDefAccount: checkCompDef,
      clusterAccount: clusterAccount,
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: SystemProgram.programId,
      arciumProgram: ARCIUM_PROGRAM_ID,
    })
    .signers([poolAuthority])
    .rpc();

  console.log('Check TX:', checkTx);
  console.log('Waiting for check callback...');

  const checkCallback = await awaitComputationFinalization(
    poolProvider,
    checkOffset,
    program.programId,
    'confirmed'
  );
  console.log('Check Callback:', checkCallback);

  // Verify pending investment
  poolAccount = await poolProgram.account.ghostPool.fetch(ghostPool);
  const pendingAmount = (poolAccount as any).pendingInvestmentAmount;
  console.log('Pending investment amount:', pendingAmount?.toString() || '0');

  if (pendingAmount && pendingAmount.toNumber() > 0) {
    console.log('\n*** SUCCESS: Investment approved by MPC! ***');
    console.log('Amount approved:', pendingAmount.toNumber() / 1_000_000, 'USDC');
    console.log('\nThe invest_in_kamino instruction is ready to execute with Kamino reserves.');
    console.log('To complete:');
    console.log('1. Find a Kamino USDC reserve on devnet');
    console.log('2. Create a collateral token account for the pool');
    console.log('3. Call invest_in_kamino with the reserve accounts');
  } else {
    console.log('No investment pending (MPC decided not to invest yet).');
    console.log('This could happen if the circuit logic determined threshold not met.');
  }

  console.log('\n=== Test Complete ===');
  console.log('Pool Address:', ghostPool.toBase58());
  console.log('Total Deposits:', poolAccount.totalDeposits.toString());
  console.log('Total Invested:', poolAccount.totalInvested.toString());

  // Check vault balance
  const vaultBalance = await provider.connection.getTokenAccountBalance(vault);
  console.log('Vault Balance:', vaultBalance.value.uiAmount, 'USDC');
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.logs) {
    console.error('Logs:');
    e.logs.forEach((log: string) => console.error('  ', log));
  }
  process.exit(1);
});
