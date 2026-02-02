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
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
} from '@solana/spl-token';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.GhostPool as Program<GhostPool>;

  const CLUSTER_OFFSET = 456;
  const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

  const mainWallet = provider.wallet.publicKey;
  const mxeAccount = getMXEAccAddress(program.programId);

  // Compute comp def offset
  function computeCompDefOffset(name: string): number {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(name).digest();
    return hash.readUInt32LE(0);
  }

  console.log('=== Test Init Pool Callback Fix ===');
  console.log('Program ID:', program.programId.toBase58());
  console.log('Main Wallet:', mainWallet.toBase58());

  // Create a new keypair for a fresh authority
  const newAuthority = Keypair.generate();
  console.log('\nNew Authority:', newAuthority.publicKey.toBase58());

  // Fund the new authority from main wallet
  console.log('Funding new authority from main wallet...');
  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: mainWallet,
      toPubkey: newAuthority.publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    })
  );
  const transferSig = await sendAndConfirmTransaction(
    provider.connection,
    transferTx,
    [provider.wallet.payer]
  );
  console.log('Funded with 0.5 SOL:', transferSig);

  // Create USDC mint
  console.log('\nCreating test USDC mint...');
  const usdcMint = await createMint(
    provider.connection,
    provider.wallet.payer,
    mainWallet,
    mainWallet,
    6
  );
  console.log('USDC Mint:', usdcMint.toBase58());

  // Get PDAs for the new authority
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), newAuthority.publicKey.toBuffer()],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    program.programId
  );

  console.log('Ghost Pool PDA:', ghostPool.toBase58());
  console.log('Vault PDA:', vault.toBase58());

  // Setup computation params
  const nonceBytes = randomBytes(16);
  const nonce = new BN(nonceBytes);
  const computationOffsetBytes = randomBytes(8);
  const computationOffset = new BN(computationOffsetBytes);
  const threshold = new BN(50_000_000_000); // 50K USDC

  console.log('\n=== Initializing Pool ===');
  console.log('Computation Offset:', computationOffset.toString());

  const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
  const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
  const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
  const compDefAccount = getCompDefAccAddress(program.programId, computeCompDefOffset('init_pool_state'));

  console.log('Comp Def Account:', compDefAccount.toBase58());
  console.log('Computation Account:', computationAccount.toBase58());

  try {
    // Create provider with new authority
    const newProvider = new anchor.AnchorProvider(
      provider.connection,
      new anchor.Wallet(newAuthority),
      { commitment: 'confirmed' }
    );
    const newProgram = new Program(program.idl, newProvider) as Program<GhostPool>;

    const tx = await newProgram.methods
      .initializePool(computationOffset, nonce, threshold)
      .accountsPartial({
        authority: newAuthority.publicKey,
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
      .signers([newAuthority])
      .rpc();

    console.log('\n✅ Pool initialization queued!');
    console.log('TX:', tx);
    console.log('Solscan: https://solscan.io/tx/' + tx + '?cluster=devnet');

    // Wait for MPC computation and callback
    console.log('\n⏳ Waiting for MPC computation and callback...');
    console.log('(This may take 5-30 seconds)');

    const startTime = Date.now();
    const finalizeSig = await awaitComputationFinalization(
      newProvider,
      computationOffset,
      program.programId,
      'confirmed'
    );
    const elapsed = (Date.now() - startTime) / 1000;

    console.log('\n✅ CALLBACK RECEIVED! (' + elapsed.toFixed(1) + 's)');
    console.log('Callback TX:', finalizeSig);
    console.log('Solscan: https://solscan.io/tx/' + finalizeSig + '?cluster=devnet');

    // Verify pool state was updated
    const poolAccount = await newProgram.account.ghostPool.fetch(ghostPool);
    console.log('\n=== Pool State After Callback ===');
    console.log('- Authority:', poolAccount.authority.toBase58());
    console.log('- State Nonce:', poolAccount.stateNonce.toString());
    console.log('- Total Deposits:', poolAccount.totalDeposits.toString());

    // Check if encrypted_state has data (not all zeros)
    const hasEncryptedState = poolAccount.encryptedState.some(
      (arr: number[]) => arr.some((b: number) => b !== 0)
    );
    console.log('- Has Encrypted State:', hasEncryptedState ? '✅ YES' : '❌ NO');

    if (hasEncryptedState) {
      console.log('\n🎉🎉🎉 CALLBACK FIX CONFIRMED WORKING! 🎉🎉🎉');
      console.log('The InstructionDidNotDeserialize error is fixed!');
    } else {
      console.log('\n⚠️ Callback ran but encrypted_state is empty');
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.logs) {
      console.error('\nLogs:');
      err.logs.forEach((log: string) => console.error(log));
    }
    throw err;
  }
}

main().catch(console.error);
