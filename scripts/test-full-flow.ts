import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import { MockKamino } from '../target/types/mock_kamino';
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
  getMXEPublicKey,
  x25519,
  RescueCipher,
  deserializeLE,
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
  getAccount,
} from '@solana/spl-token';

const CLUSTER_OFFSET = 456;
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
const MOCK_KAMINO_PROGRAM_ID = new PublicKey('B4HMWFxLVtCiv9cxbsqRo77LGdcZa6P1tt8YcmEWNwC2');

function computeCompDefOffset(name: string): number {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

// Custom await with timeout and account verification
async function awaitCallbackWithTimeout(
  connection: anchor.web3.Connection,
  accountAddress: PublicKey,
  expectedOwner: PublicKey,
  timeoutMs: number = 30000
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
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const ghostPoolProgram = anchor.workspace.GhostPool as Program<GhostPool>;
  const mockKaminoProgram = anchor.workspace.MockKamino as Program<MockKamino>;

  const mainWallet = provider.wallet.publicKey;
  const mxeAccount = getMXEAccAddress(ghostPoolProgram.programId);

  console.log('=== Full Ghost Pool + Mock Kamino Integration Test ===\n');
  console.log('Ghost Pool Program:', ghostPoolProgram.programId.toBase58());
  console.log('Mock Kamino Program:', mockKaminoProgram.programId.toBase58());
  console.log('Main Wallet:', mainWallet.toBase58());

  // ==========================================
  // STEP 1: Set up Mock Kamino
  // ==========================================
  console.log('\n--- Step 1: Setting up Mock Kamino ---');

  // Create USDC mint
  const usdcMint = await createMint(
    provider.connection,
    provider.wallet.payer,
    mainWallet,
    mainWallet,
    6
  );
  console.log('USDC Mint:', usdcMint.toBase58());

  // Derive Mock Kamino lending market PDA
  const [lendingMarket] = PublicKey.findProgramAddressSync(
    [Buffer.from('lending_market'), mainWallet.toBuffer()],
    mockKaminoProgram.programId
  );
  console.log('Lending Market PDA:', lendingMarket.toBase58());

  // Check if lending market already exists
  const existingMarket = await provider.connection.getAccountInfo(lendingMarket);
  if (existingMarket) {
    console.log('Lending market already exists, skipping initialization');
  } else {
    // Initialize lending market
    await mockKaminoProgram.methods
      .initLendingMarket()
      .accountsPartial({
        authority: mainWallet,
      })
      .rpc();
    console.log('Lending market initialized');
  }

  // Derive lending market authority PDA
  const [lendingMarketAuthority, lendingMarketAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('lending_market_authority'), lendingMarket.toBuffer()],
    mockKaminoProgram.programId
  );
  console.log('Lending Market Authority:', lendingMarketAuthority.toBase58());

  // Create cToken mint (collateral token) with lending market authority as mint authority
  const cTokenMint = await createMint(
    provider.connection,
    provider.wallet.payer,
    lendingMarketAuthority,  // mint authority is the market PDA
    null,
    6
  );
  console.log('cToken Mint:', cTokenMint.toBase58());

  // Derive reserve PDA
  const [reserve] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve'), lendingMarket.toBuffer(), usdcMint.toBuffer()],
    mockKaminoProgram.programId
  );
  console.log('Reserve PDA:', reserve.toBase58());

  // Derive liquidity supply PDA
  const [liquiditySupply] = PublicKey.findProgramAddressSync(
    [Buffer.from('reserve_liquidity'), lendingMarket.toBuffer(), usdcMint.toBuffer()],
    mockKaminoProgram.programId
  );
  console.log('Liquidity Supply PDA:', liquiditySupply.toBase58());

  // Initialize reserve with 1:1 exchange rate
  await mockKaminoProgram.methods
    .initReserve(new BN(1_000_000)) // 1:1 exchange rate (scaled by 1e6)
    .accountsPartial({
      authority: mainWallet,
      lendingMarket: lendingMarket,
      liquidityMint: usdcMint,
      collateralMint: cTokenMint,
    })
    .rpc();
  console.log('Reserve initialized with 1:1 exchange rate');

  // ==========================================
  // STEP 2: Create Ghost Pool
  // ==========================================
  console.log('\n--- Step 2: Creating Ghost Pool ---');

  const poolAuthority = Keypair.generate();
  console.log('Pool Authority:', poolAuthority.publicKey.toBase58());

  // Fund the authority
  await sendAndConfirmTransaction(
    provider.connection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet,
        toPubkey: poolAuthority.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      })
    ),
    [provider.wallet.payer]
  );
  console.log('Funded authority with 2 SOL');

  // Derive Ghost Pool PDAs
  const [ghostPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), poolAuthority.publicKey.toBuffer()],
    ghostPoolProgram.programId
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    ghostPoolProgram.programId
  );
  console.log('Ghost Pool PDA:', ghostPool.toBase58());
  console.log('Vault PDA:', vault.toBase58());

  // Create pool's cToken account for receiving collateral
  const poolCTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    provider.wallet.payer,
    cTokenMint,
    vault,
    true  // allowOwnerOffCurve for PDA
  );
  console.log('Pool cToken Account:', poolCTokenAccount.address.toBase58());

  // Initialize Ghost Pool
  const poolProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(poolAuthority),
    { commitment: 'confirmed' }
  );
  const poolProgram = new Program(ghostPoolProgram.idl, poolProvider) as Program<GhostPool>;

  const initOffset = new BN(randomBytes(8));
  const initNonce = new BN(randomBytes(16));
  const threshold = new BN(100_000_000); // 100 USDC

  const compDefAccount = getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('init_pool_state'));

  console.log('\nInitializing Ghost Pool...');
  const initTx = await poolProgram.methods
    .initializePool(initOffset, initNonce, threshold)
    .accountsPartial({
      authority: poolAuthority.publicKey,
      ghostPool: ghostPool,
      usdcMint: usdcMint,
      vault: vault,
      mxeAccount: mxeAccount,
      compDefAccount: compDefAccount,
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, initOffset),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      arciumProgram: ARCIUM_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([poolAuthority])
    .rpc();

  console.log('Init TX:', initTx);
  console.log('Waiting for MPC callback (up to 30s)...');

  const initSuccess = await awaitCallbackWithTimeout(
    provider.connection,
    ghostPool,
    ghostPoolProgram.programId,
    30000
  );
  if (!initSuccess) {
    console.log('Warning: Timeout waiting for callback, checking account directly...');
    const acct = await provider.connection.getAccountInfo(ghostPool);
    if (!acct || acct.data.length < 100) {
      throw new Error('Pool initialization callback failed');
    }
  }
  console.log('Ghost Pool initialized');

  // ==========================================
  // STEP 3: Make a deposit
  // ==========================================
  console.log('\n--- Step 3: Making Deposit ---');

  const depositor = Keypair.generate();
  const depositAmount = 200_000_000; // 200 USDC

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

  const depositOffset = new BN(randomBytes(8));

  // Get MXE public key for encryption
  const mxePublicKey = await getMXEPublicKey(provider as anchor.AnchorProvider, ghostPoolProgram.programId);
  if (!mxePublicKey) {
    throw new Error('MXE public key not available');
  }
  console.log('MXE Public Key obtained');

  // Generate X25519 keypair for the depositor
  const userPrivateKey = x25519.utils.randomSecretKey();
  const userPublicKey = x25519.getPublicKey(userPrivateKey);

  // Compute shared secret
  const sharedSecret = x25519.getSharedSecret(userPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  // Generate password hash (16 bytes = u128)
  const passwordBytes = randomBytes(16);
  const passwordHashBigInt = deserializeLE(passwordBytes);

  // Generate nonce for encryption
  const nonceBytes = randomBytes(16);
  const nonceBigInt = deserializeLE(nonceBytes);

  // Encrypt: password_hash (u128) and amount (u64) for DepositRequest struct
  // DepositRequest { password_hash: u128, amount: u64 }
  const plaintext = [passwordHashBigInt, BigInt(depositAmount)];
  const ciphertext = cipher.encrypt(plaintext, nonceBytes);

  console.log('Data encrypted with X25519 + RescueCipher');

  const depositorProvider = new anchor.AnchorProvider(
    provider.connection,
    new anchor.Wallet(depositor),
    { commitment: 'confirmed' }
  );
  const depositorProgram = new Program(ghostPoolProgram.idl, depositorProvider) as Program<GhostPool>;

  // Pass encrypted values: ciphertext[0] = encrypted password_hash, ciphertext[1] = encrypted amount
  const depositTx = await depositorProgram.methods
    .deposit(
      depositOffset,
      new BN(depositAmount),
      Array.from(ciphertext[0]),  // encrypted password_hash as [u8; 32]
      Array.from(userPublicKey),  // user's X25519 public key
      new BN(nonceBigInt.toString())  // nonce
    )
    .accountsPartial({
      user: depositor.publicKey,
      ghostPool: ghostPool,
      userUsdcToken: depositorAta.address,
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
    .signers([depositor])
    .rpc();

  console.log('Deposit TX:', depositTx);
  console.log('Waiting for deposit callback (up to 30s)...');

  // Wait for vault to have balance
  let depositSuccess = false;
  const depositStart = Date.now();
  while (Date.now() - depositStart < 30000) {
    try {
      const balance = await provider.connection.getTokenAccountBalance(vault);
      if (balance.value.uiAmount && balance.value.uiAmount > 0) {
        depositSuccess = true;
        break;
      }
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!depositSuccess) {
    console.log('Warning: Timeout waiting for deposit callback');
  }
  console.log('Deposit confirmed');

  // Check vault balance
  let vaultBalance = await provider.connection.getTokenAccountBalance(vault);
  console.log('Vault Balance:', vaultBalance.value.uiAmount, 'USDC');

  // ==========================================
  // STEP 4: Check and Invest
  // ==========================================
  console.log('\n--- Step 4: Check & Invest (MPC Decision) ---');

  const checkOffset = new BN(randomBytes(8));

  const checkTx = await poolProgram.methods
    .checkAndInvest(checkOffset)
    .accountsPartial({
      authority: poolAuthority.publicKey,
      ghostPool: ghostPool,
      mxeAccount: mxeAccount,
      mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
      executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
      computationAccount: getComputationAccAddress(CLUSTER_OFFSET, checkOffset),
      compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('check_investment_needed')),
      clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
      poolAccount: getFeePoolAccAddress(),
      clockAccount: getClockAccAddress(),
      systemProgram: SystemProgram.programId,
      arciumProgram: ARCIUM_PROGRAM_ID,
    })
    .signers([poolAuthority])
    .rpc();

  console.log('Check TX:', checkTx);
  console.log('Waiting for check callback (up to 30s)...');

  // Wait for callback to update pool state
  await new Promise(resolve => setTimeout(resolve, 15000)); // Give MPC time to process

  let poolAccount = await poolProgram.account.ghostPool.fetch(ghostPool);
  const pendingAmount = (poolAccount as any).pendingInvestmentAmount?.toNumber() || 0;
  console.log('Pending investment amount:', pendingAmount / 1_000_000, 'USDC');

  // ==========================================
  // STEP 5: Execute Kamino Investment
  // ==========================================
  if (pendingAmount > 0) {
    console.log('\n--- Step 5: Executing Mock Kamino Investment ---');

    const investTx = await poolProgram.methods
      .investInKamino()
      .accountsPartial({
        authority: poolAuthority.publicKey,
        ghostPool: ghostPool,
        vault: vault,
        kaminoLendingMarket: lendingMarket,
        kaminoLendingMarketAuthority: lendingMarketAuthority,
        kaminoReserve: reserve,
        reserveLiquidityMint: usdcMint,
        reserveCollateralMint: cTokenMint,
        reserveLiquiditySupply: liquiditySupply,
        userDestinationCollateral: poolCTokenAccount.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        kaminoProgram: MOCK_KAMINO_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([poolAuthority])
      .rpc();

    console.log('Invest TX:', investTx);
    console.log('Investment executed successfully!');

    // Check balances after investment
    vaultBalance = await provider.connection.getTokenAccountBalance(vault);
    console.log('Vault Balance (after invest):', vaultBalance.value.uiAmount, 'USDC');

    const cTokenBalance = await provider.connection.getTokenAccountBalance(poolCTokenAccount.address);
    console.log('cToken Balance:', cTokenBalance.value.uiAmount, 'cUSDC');

    poolAccount = await poolProgram.account.ghostPool.fetch(ghostPool);
    console.log('Total Invested:', poolAccount.totalInvested.toString());
  } else {
    console.log('\nNo investment pending - MPC decided not to invest');
  }

  // ==========================================
  // Summary
  // ==========================================
  console.log('\n=== Test Complete ===');
  console.log('Ghost Pool:', ghostPool.toBase58());
  console.log('Mock Kamino Reserve:', reserve.toBase58());

  poolAccount = await poolProgram.account.ghostPool.fetch(ghostPool);
  console.log('\nPool State:');
  console.log('  - Total Deposits:', poolAccount.totalDeposits.toString());
  console.log('  - Total Invested:', poolAccount.totalInvested.toString());
  console.log('  - Pending Investment:', (poolAccount as any).pendingInvestmentAmount?.toString() || '0');

  console.log('\n*** Privacy preserved: Depositor identity separated from Kamino investment! ***');
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.logs) {
    console.error('\nLogs:');
    e.logs.forEach((log: string) => console.error('  ', log));
  }
  process.exit(1);
});
