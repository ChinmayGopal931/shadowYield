/**
 * Ghost Pool Devnet Test
 *
 * Test suite for devnet - handles existing pool and persistent comp defs.
 * Initializes comp defs with v9 IPFS circuit URLs if they don't exist.
 *
 * Run with: arcium test --cluster devnet --skip-build
 */

import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import { MockKamino } from '../target/types/mock_kamino';
import {
  RescueCipher,
  awaitComputationFinalization,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getCompDefAccAddress,
  getMXEPublicKey,
  getArciumEnv,
  x25519,
  deserializeLE,
  getFeePoolAccAddress,
  getClockAccAddress,
} from '@arcium-hq/client';
import { createHash, randomBytes } from 'crypto';
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from '@solana/spl-token';
import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';

// Circuit names used by Ghost Pool
const CIRCUIT_NAMES = [
  'init_pool_state',
  'process_deposit',
  'check_investment_needed',
  'record_investment',
  'record_yield',
  'authorize_withdrawal',
  'process_withdrawal',
];

// Helper function to read keypair from JSON file
function readKpJson(path: string): Keypair {
  const content = fs.readFileSync(path, 'utf-8');
  const secretKey = Uint8Array.from(JSON.parse(content));
  return Keypair.fromSecretKey(secretKey);
}

// Hash password to u128 (same as frontend)
function hashPassword(password: string): Uint8Array {
  const hash = createHash('sha256').update(password).digest();
  return new Uint8Array(hash.slice(0, 16)); // First 16 bytes for u128
}

// Compute comp def offset from circuit name
function computeCompDefOffset(name: string): number {
  const hash = createHash('sha256').update(name).digest();
  return hash.readUInt32LE(0);
}

// Retry helper for RPC calls that may fail due to network issues
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  delayMs = 3000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRetryable =
        err.message?.includes('Blockhash not found') ||
        err.message?.includes('block height exceeded') ||
        err.message?.includes('was not confirmed') ||
        err.message?.includes('Transaction simulation failed') ||
        err.message?.includes('429') ||
        err.message?.includes('Too Many Requests');

      if (isRetryable && attempt < maxRetries) {
        console.log(`  Retry ${attempt}/${maxRetries} after error: ${err.message?.slice(0, 80)}...`);
        await new Promise(r => setTimeout(r, delayMs * attempt)); // Exponential backoff
        continue;
      }
      throw err;
    }
  }
  throw new Error('Exhausted retries');
}

// Check if account exists
async function accountExists(connection: anchor.web3.Connection, pubkey: PublicKey): Promise<boolean> {
  try {
    const info = await connection.getAccountInfo(pubkey);
    return info !== null;
  } catch {
    return false;
  }
}

describe('Ghost Pool - Devnet Full Flow', () => {
  // Configure the client to use devnet
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  // Patch provider.sendAndConfirm with blockhash retry logic
  const origSendAndConfirm = provider.sendAndConfirm.bind(provider);
  provider.sendAndConfirm = async (tx: any, signers?: any[], opts?: any) => {
    return withRetry(() => origSendAndConfirm(tx, signers, opts), 5, 3000);
  };

  const ghostPoolProgram = anchor.workspace.GhostPool as Program<GhostPool>;
  const mockKaminoProgram = anchor.workspace.MockKamino as Program<MockKamino>;

  // Get Arcium environment - devnet uses cluster offset 456
  const CLUSTER_OFFSET = getArciumEnv().arciumClusterOffset;

  const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

  // Test state
  let owner: Keypair;
  let authority: PublicKey;
  let usdcMint: PublicKey;
  let cTokenMint: PublicKey;
  let ghostPool: PublicKey;
  let vault: PublicKey;
  let mxeAccount: PublicKey;
  let lendingMarket: PublicKey;
  let lendingMarketAuthority: PublicKey;
  let reserve: PublicKey;
  let reserveLiquiditySupply: PublicKey;

  // User test state
  let userKeypair: Keypair;
  let userUsdcAta: PublicKey;
  let userCTokenAta: PublicKey;
  const testPassword = 'devnet_password_' + Date.now(); // Unique password for each run
  const depositAmount = 100_000_000; // 100 USDC (6 decimals)

  // MPC encryption state
  let mxePublicKey: Uint8Array;
  let userPrivateKey: Uint8Array;
  let userPublicKey: Uint8Array;
  let sharedSecret: Uint8Array;
  let cipher: RescueCipher;

  // Track if pool already exists
  let poolExists: boolean = false;

  before(async () => {
    console.log('\n========================================');
    console.log('Ghost Pool DEVNET Test Setup');
    console.log('========================================\n');

    // Load owner keypair - use devnet-test.json for fresh pool PDA
    const keypairPath = `${os.homedir()}/.config/solana/devnet-test.json`;
    owner = readKpJson(keypairPath);
    authority = owner.publicKey;
    console.log('Using keypair:', keypairPath);

    console.log('Cluster Offset:', CLUSTER_OFFSET, CLUSTER_OFFSET === 456 ? '(devnet)' : CLUSTER_OFFSET === 0 ? '(localnet)' : '(unknown)');
    console.log('Ghost Pool Program:', ghostPoolProgram.programId.toBase58());
    console.log('Mock Kamino Program:', mockKaminoProgram.programId.toBase58());
    console.log('Authority:', authority.toBase58());

    // Check wallet balance
    const balance = await provider.connection.getBalance(authority);
    console.log('Wallet Balance:', balance / LAMPORTS_PER_SOL, 'SOL');

    if (balance < 0.5 * LAMPORTS_PER_SOL) {
      throw new Error('Insufficient SOL balance. Need at least 0.5 SOL for devnet testing.');
    }

    // Get MXE account
    mxeAccount = getMXEAccAddress(ghostPoolProgram.programId);
    console.log('MXE Account:', mxeAccount.toBase58());

    // Get PDAs
    [ghostPool] = PublicKey.findProgramAddressSync(
      [Buffer.from('ghost_pool'), authority.toBuffer()],
      ghostPoolProgram.programId
    );
    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), ghostPool.toBuffer()],
      ghostPoolProgram.programId
    );

    console.log('Ghost Pool PDA:', ghostPool.toBase58());
    console.log('Vault PDA:', vault.toBase58());

    // Check if pool already exists
    poolExists = await accountExists(provider.connection, ghostPool);
    console.log('Pool Already Exists:', poolExists);

    if (poolExists) {
      // Use existing pool's USDC mint
      const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
      usdcMint = poolAccount.usdcMint;
      console.log('\nUsing existing pool USDC mint:', usdcMint.toBase58());
    } else {
      // Create test USDC mint (with retry)
      console.log('\nCreating test USDC mint...');
      usdcMint = await withRetry(() => createMint(
        provider.connection,
        owner,
        authority,
        authority,
        6
      ));
      console.log('USDC Mint:', usdcMint.toBase58());
    }

    // Setup user for testing
    userKeypair = Keypair.generate();
    console.log('\nTest User:', userKeypair.publicKey.toBase58());

    // Fund user with SOL
    console.log('Funding user with SOL...');
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority,
        toPubkey: userKeypair.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx, [owner]);

    // Create user's USDC ATA and mint test tokens (with retry)
    console.log('Creating user USDC ATA...');
    const userAtaInfo = await withRetry(() => getOrCreateAssociatedTokenAccount(
      provider.connection,
      owner,
      usdcMint,
      userKeypair.publicKey
    ));
    userUsdcAta = userAtaInfo.address;

    console.log('Minting 1000 USDC to user...');
    await withRetry(() => mintTo(
      provider.connection,
      owner,
      usdcMint,
      userUsdcAta,
      authority,
      1_000_000_000 // 1000 USDC
    ));
    console.log('Minted 1000 USDC to user');
  });

  describe('1. Computation Definition Initialization', () => {
    // Helper to init comp def with retry
    async function initCompDef(
      name: string,
      initMethod: () => Promise<anchor.web3.TransactionSignature>
    ) {
      const compDefOffset = computeCompDefOffset(name);
      const compDefAccount = getCompDefAccAddress(ghostPoolProgram.programId, compDefOffset);

      // Check if already exists
      const exists = await accountExists(provider.connection, compDefAccount);
      if (exists) {
        console.log(`  Comp def ${name} already exists`);
        return;
      }

      try {
        const tx = await withRetry(initMethod);
        console.log(`  Initialized ${name}: ${tx.slice(0, 20)}...`);
      } catch (err: any) {
        if (err.message?.includes('already') || err.message?.includes('custom program error: 0x0')) {
          console.log(`  Comp def ${name} already exists`);
        } else {
          throw err;
        }
      }
    }

    it('Initializes init_pool_state comp def', async () => {
      await initCompDef('init_pool_state', () =>
        ghostPoolProgram.methods
          .initPoolCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('init_pool_state')),
          })
          .signers([owner])
          .rpc()
      );
    });

    it('Initializes process_deposit comp def', async () => {
      await initCompDef('process_deposit', () =>
        ghostPoolProgram.methods
          .initDepositCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('process_deposit')),
          })
          .signers([owner])
          .rpc()
      );
    });

    it('Initializes check_investment_needed comp def', async () => {
      await initCompDef('check_investment_needed', () =>
        ghostPoolProgram.methods
          .initCheckInvestmentNeededCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('check_investment_needed')),
          })
          .signers([owner])
          .rpc()
      );
    });

    it('Initializes record_investment comp def', async () => {
      await initCompDef('record_investment', () =>
        ghostPoolProgram.methods
          .initRecordInvestmentCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('record_investment')),
          })
          .signers([owner])
          .rpc()
      );
    });

    it('Initializes record_yield comp def', async () => {
      await initCompDef('record_yield', () =>
        ghostPoolProgram.methods
          .initRecordYieldCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('record_yield')),
          })
          .signers([owner])
          .rpc()
      );
    });

    it('Initializes authorize_withdrawal comp def', async () => {
      await initCompDef('authorize_withdrawal', () =>
        ghostPoolProgram.methods
          .initAuthorizeWithdrawalCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('authorize_withdrawal')),
          })
          .signers([owner])
          .rpc()
      );
    });

    it('Initializes process_withdrawal comp def', async () => {
      await initCompDef('process_withdrawal', () =>
        ghostPoolProgram.methods
          .initProcessWithdrawalCompDef()
          .accountsPartial({
            payer: authority,
            mxeAccount: mxeAccount,
            compDefAccount: getCompDefAccAddress(ghostPoolProgram.programId, computeCompDefOffset('process_withdrawal')),
          })
          .signers([owner])
          .rpc()
      );
    });
  });

  describe('2. Mock Kamino Setup', () => {
    it('Initializes lending market', async () => {
      [lendingMarket] = PublicKey.findProgramAddressSync(
        [Buffer.from('lending_market'), authority.toBuffer()],
        mockKaminoProgram.programId
      );

      [lendingMarketAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('lending_market_authority'), lendingMarket.toBuffer()],
        mockKaminoProgram.programId
      );

      console.log('  Lending Market:', lendingMarket.toBase58());
      console.log('  Lending Market Authority:', lendingMarketAuthority.toBase58());

      const exists = await accountExists(provider.connection, lendingMarket);
      if (exists) {
        console.log('  Lending market already exists');
        return;
      }

      try {
        const tx = await withRetry(() =>
          mockKaminoProgram.methods
            .initLendingMarket()
            .accountsPartial({
              authority: authority,
            })
            .signers([owner])
            .rpc()
        );
        console.log('  Lending market initialized:', tx.slice(0, 20) + '...');
      } catch (err: any) {
        if (err.message?.includes('already')) {
          console.log('  Lending market already exists');
        } else {
          throw err;
        }
      }
    });

    it('Creates cToken mint and initializes reserve', async () => {
      // Create cToken mint with lending market authority as mint authority
      cTokenMint = await withRetry(() => createMint(
        provider.connection,
        owner,
        lendingMarketAuthority,
        null,
        6
      ));
      console.log('  cToken Mint:', cTokenMint.toBase58());

      [reserve] = PublicKey.findProgramAddressSync(
        [Buffer.from('reserve'), lendingMarket.toBuffer(), usdcMint.toBuffer()],
        mockKaminoProgram.programId
      );

      [reserveLiquiditySupply] = PublicKey.findProgramAddressSync(
        [Buffer.from('reserve_liquidity'), lendingMarket.toBuffer(), usdcMint.toBuffer()],
        mockKaminoProgram.programId
      );

      console.log('  Reserve:', reserve.toBase58());
      console.log('  Reserve Liquidity Supply:', reserveLiquiditySupply.toBase58());

      try {
        const tx = await withRetry(() =>
          mockKaminoProgram.methods
            .initReserve(new BN(1_000_000)) // 1:1 initial exchange rate
            .accountsPartial({
              authority: authority,
              lendingMarket: lendingMarket,
              liquidityMint: usdcMint,
              collateralMint: cTokenMint,
            })
            .signers([owner])
            .rpc()
        );
        console.log('  Reserve initialized:', tx.slice(0, 20) + '...');
      } catch (err: any) {
        if (err.message?.includes('already')) {
          console.log('  Reserve already exists');
        } else {
          throw err;
        }
      }
    });
  });

  describe('3. Ghost Pool Initialization', () => {
    it('Gets MXE public key for encryption', async () => {
      mxePublicKey = await getMXEPublicKey(provider, ghostPoolProgram.programId);

      if (!mxePublicKey) {
        throw new Error('MXE public key not available - is the MXE account initialized on devnet?');
      }

      console.log('  MXE Public Key:', Buffer.from(mxePublicKey).toString('hex').slice(0, 32) + '...');

      // Setup encryption
      userPrivateKey = x25519.utils.randomSecretKey();
      userPublicKey = x25519.getPublicKey(userPrivateKey);
      sharedSecret = x25519.getSharedSecret(userPrivateKey, mxePublicKey);
      cipher = new RescueCipher(sharedSecret);

      console.log('  User Public Key:', Buffer.from(userPublicKey).toString('hex').slice(0, 32) + '...');
    });

    it('Initializes the ghost pool (or uses existing)', async () => {
      if (poolExists) {
        console.log('  Pool already exists - using existing pool');
        console.log('  Pool address:', ghostPool.toBase58());

        // Verify existing pool state
        const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
        console.log('  Pool Authority:', poolAccount.authority.toBase58());
        console.log('  Pool USDC Mint:', poolAccount.usdcMint.toBase58());
        console.log('  Total Deposits:', poolAccount.totalDeposits.toString());
        console.log('  Total Withdrawals:', poolAccount.totalWithdrawals.toString());
        console.log('  State Nonce:', poolAccount.stateNonce.toString());
        return;
      }

      const initNonceBytes = randomBytes(16);
      const initNonce = new BN(deserializeLE(initNonceBytes).toString());
      const computationOffset = new BN(randomBytes(8), 'hex');
      const investmentThreshold = new BN(50_000_000); // 50 USDC threshold

      console.log('  Investment Threshold:', investmentThreshold.toString(), '(50 USDC)');
      console.log('  Computation Offset:', computationOffset.toString());

      const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
      const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
      const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
      const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
      const compDefAccount = getCompDefAccAddress(
        ghostPoolProgram.programId,
        computeCompDefOffset('init_pool_state')
      );
      const feePoolAccount = getFeePoolAccAddress();
      const clockAccount = getClockAccAddress();

      try {
        const tx = await withRetry(() =>
          ghostPoolProgram.methods
            .initializePool(computationOffset, initNonce, investmentThreshold)
            .accountsPartial({
              authority: authority,
              ghostPool: ghostPool,
              usdcMint: usdcMint,
              vault: vault,
              mxeAccount: mxeAccount,
              compDefAccount: compDefAccount,
              computationAccount: computationAccount,
              clusterAccount: clusterAccount,
              mempoolAccount: mempoolAccount,
              executingPool: executingPool,
              poolAccount: feePoolAccount,
              clockAccount: clockAccount,
              arciumProgram: ARCIUM_PROGRAM_ID,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([owner])
            .rpc({ commitment: 'confirmed' })
        );

        console.log('  Pool init queued:', tx.slice(0, 20) + '...');

        // Wait for MPC callback (may take 30-90 seconds on devnet)
        console.log('  Waiting for MPC callback (this may take 60-90s on devnet)...');
        const finalizeSig = await awaitComputationFinalization(
          provider,
          computationOffset,
          ghostPoolProgram.programId,
          'confirmed'
        );
        console.log('  Pool initialized with MPC:', finalizeSig.slice(0, 20) + '...');

        // Verify pool state
        const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
        console.log('  Pool Authority:', poolAccount.authority.toBase58());
        console.log('  Total Deposits:', poolAccount.totalDeposits.toString());
        console.log('  State Nonce:', poolAccount.stateNonce.toString());

      } catch (err: any) {
        if (err.message?.includes('already')) {
          console.log('  Pool already exists');
          poolExists = true;
        } else {
          throw err;
        }
      }
    });
  });

  describe('4. Deposit Flow', () => {
    it('User deposits USDC with encrypted password', async function() {
      const startTime = Date.now();
      const logTime = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

      console.log(`${logTime()} Starting deposit test...`);

      // Hash password
      const passwordBytes = hashPassword(testPassword);
      const passwordHashBigInt = deserializeLE(passwordBytes);

      console.log(`${logTime()} Password: ${testPassword}`);
      console.log(`${logTime()} Password Hash: ${passwordHashBigInt.toString(16).slice(0, 20)}...`);

      // Generate encryption nonce
      const nonceBytes = randomBytes(16);
      const nonceBigInt = deserializeLE(nonceBytes);

      // Encrypt password hash
      const plaintext = [passwordHashBigInt];
      console.log(`${logTime()} Encrypting password...`);
      const ciphertext = cipher.encrypt(plaintext, nonceBytes);

      console.log(`${logTime()} Encrypted Password: ${Buffer.from(ciphertext[0]).toString('hex').slice(0, 40)}...`);
      console.log(`${logTime()} Deposit Amount: ${depositAmount / 1_000_000} USDC`);

      const computationOffset = new BN(randomBytes(8), 'hex');
      const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
      const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
      const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
      const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
      const compDefAccount = getCompDefAccAddress(
        ghostPoolProgram.programId,
        computeCompDefOffset('process_deposit')
      );
      const feePoolAccount = getFeePoolAccAddress();
      const clockAccount = getClockAccAddress();

      // Get user's balance before
      console.log(`${logTime()} Getting user balance...`);
      const balanceBefore = await provider.connection.getTokenAccountBalance(userUsdcAta);
      console.log(`${logTime()} User USDC Balance Before: ${balanceBefore.value.uiAmount}`);

      // Create user provider
      console.log(`${logTime()} Creating user provider...`);
      const userProvider = new anchor.AnchorProvider(
        provider.connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
      );
      // Patch userProvider with retry logic
      const origUserSendAndConfirm = userProvider.sendAndConfirm.bind(userProvider);
      userProvider.sendAndConfirm = async (tx: any, signers?: any[], opts?: any) => {
        return withRetry(() => origUserSendAndConfirm(tx, signers, opts), 5, 3000);
      };
      const userProgram = new Program(
        ghostPoolProgram.idl,
        userProvider
      ) as Program<GhostPool>;

      console.log(`${logTime()} Building deposit transaction...`);
      console.log(`${logTime()} Computation offset: ${computationOffset.toString()}`);

      try {
        console.log(`${logTime()} Sending deposit transaction...`);
        const tx = await userProgram.methods
          .deposit(
            computationOffset,
            new BN(depositAmount),
            Array.from(ciphertext[0]) as any,
            Array.from(userPublicKey) as any,
            new BN(nonceBigInt.toString())
          )
          .accountsPartial({
            user: userKeypair.publicKey,
            ghostPool: ghostPool,
            userUsdcToken: userUsdcAta,
            vaultUsdcToken: vault,
            usdcMint: usdcMint,
            mxeAccount: mxeAccount,
            compDefAccount: compDefAccount,
            computationAccount: computationAccount,
            clusterAccount: clusterAccount,
            mempoolAccount: mempoolAccount,
            executingPool: executingPool,
            poolAccount: feePoolAccount,
            clockAccount: clockAccount,
            arciumProgram: ARCIUM_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([userKeypair])
          .rpc({ commitment: 'confirmed' });

        console.log(`${logTime()} Deposit tx queued: ${tx.slice(0, 20)}...`);

        // Wait for MPC callback (may take 60-120s on devnet)
        console.log(`${logTime()} Waiting for MPC callback (this may take 60-120s on devnet)...`);
        const finalizeSig = await awaitComputationFinalization(
          provider,
          computationOffset,
          ghostPoolProgram.programId,
          'confirmed'
        );
        console.log(`${logTime()} Deposit confirmed: ${finalizeSig.slice(0, 20)}...`);
      } catch (err: any) {
        console.error(`${logTime()} Deposit transaction failed:`, err.message);
        if (err.logs) {
          console.error(`${logTime()} Transaction logs:`);
          err.logs.slice(-10).forEach((log: string) => console.error(`  ${log}`));
        }
        throw err;
      }

      // Verify state
      console.log(`${logTime()} Verifying state...`);
      const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
      const vaultBalance = await provider.connection.getTokenAccountBalance(vault);
      const userBalanceAfter = await provider.connection.getTokenAccountBalance(userUsdcAta);

      console.log(`${logTime()} Total Deposits: ${poolAccount.totalDeposits.toString()}`);
      console.log(`${logTime()} Vault Balance: ${vaultBalance.value.uiAmount} USDC`);
      console.log(`${logTime()} User USDC Balance After: ${userBalanceAfter.value.uiAmount}`);
      console.log(`${logTime()} Deposit test completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      expect(poolAccount.totalDeposits.toNumber()).to.be.greaterThan(0);
    });
  });

  describe('5. Withdrawal Flow', () => {
    it('User withdraws USDC with password verification', async function() {
      const startTime = Date.now();
      const logTime = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

      console.log(`${logTime()} Starting withdrawal test...`);

      // Use SAME password hash (critical for MPC verification)
      const passwordBytes = hashPassword(testPassword);
      const passwordHashBigInt = deserializeLE(passwordBytes);

      // Generate NEW encryption keypair and nonce for withdrawal
      console.log(`${logTime()} Generating withdrawal encryption keypair...`);
      const withdrawPrivateKey = x25519.utils.randomSecretKey();
      const withdrawPublicKey = x25519.getPublicKey(withdrawPrivateKey);
      const withdrawSharedSecret = x25519.getSharedSecret(withdrawPrivateKey, mxePublicKey);
      const withdrawCipher = new RescueCipher(withdrawSharedSecret);

      const nonceBytes = randomBytes(16);
      const nonceBigInt = deserializeLE(nonceBytes);

      // Encrypt password hash with new shared secret
      const plaintext = [passwordHashBigInt];
      const ciphertext = withdrawCipher.encrypt(plaintext, nonceBytes);

      console.log(`${logTime()} Withdrawing with password: ${testPassword}`);
      console.log(`${logTime()} Withdraw Amount: ${depositAmount / 1_000_000} USDC`);

      const computationOffset = new BN(randomBytes(8), 'hex');
      const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
      const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
      const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
      const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
      const compDefAccount = getCompDefAccAddress(
        ghostPoolProgram.programId,
        computeCompDefOffset('authorize_withdrawal')
      );
      const feePoolAccount = getFeePoolAccAddress();
      const clockAccount = getClockAccAddress();

      // Get balances before
      console.log(`${logTime()} Getting balances...`);
      const vaultBefore = await provider.connection.getTokenAccountBalance(vault);
      const userBefore = await provider.connection.getTokenAccountBalance(userUsdcAta);
      console.log(`${logTime()} Vault Balance Before: ${vaultBefore.value.uiAmount} USDC`);
      console.log(`${logTime()} User Balance Before: ${userBefore.value.uiAmount} USDC`);

      // Create user provider
      console.log(`${logTime()} Creating user provider...`);
      const userProvider = new anchor.AnchorProvider(
        provider.connection,
        new anchor.Wallet(userKeypair),
        { commitment: 'confirmed' }
      );
      // Patch userProvider with retry logic
      const origUserSendAndConfirm = userProvider.sendAndConfirm.bind(userProvider);
      userProvider.sendAndConfirm = async (tx: any, signers?: any[], opts?: any) => {
        return withRetry(() => origUserSendAndConfirm(tx, signers, opts), 5, 3000);
      };
      const userProgram = new Program(
        ghostPoolProgram.idl,
        userProvider
      ) as Program<GhostPool>;

      console.log(`${logTime()} Building withdrawal transaction...`);

      try {
        console.log(`${logTime()} Sending withdrawal transaction...`);
        const tx = await userProgram.methods
          .withdraw(
            computationOffset,
            new BN(depositAmount),
            Array.from(ciphertext[0]) as any,
            Array.from(withdrawPublicKey) as any,
            new BN(nonceBigInt.toString())
          )
          .accountsPartial({
            user: userKeypair.publicKey,
            ghostPool: ghostPool,
            vault: vault,
            userTokenAccount: userUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            mxeAccount: mxeAccount,
            compDefAccount: compDefAccount,
            computationAccount: computationAccount,
            clusterAccount: clusterAccount,
            mempoolAccount: mempoolAccount,
            executingPool: executingPool,
            poolAccount: feePoolAccount,
            clockAccount: clockAccount,
            arciumProgram: ARCIUM_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([userKeypair])
          .rpc({ commitment: 'confirmed' });

        console.log(`${logTime()} Withdraw tx queued: ${tx.slice(0, 20)}...`);

        // Wait for MPC callback (may take 60-120s on devnet)
        console.log(`${logTime()} Waiting for MPC callback (this may take 60-120s on devnet)...`);
        const finalizeSig = await awaitComputationFinalization(
          provider,
          computationOffset,
          ghostPoolProgram.programId,
          'confirmed'
        );
        console.log(`${logTime()} Withdrawal confirmed: ${finalizeSig.slice(0, 20)}...`);
      } catch (err: any) {
        console.error(`${logTime()} Withdrawal transaction failed:`, err.message);
        if (err.logs) {
          console.error(`${logTime()} Transaction logs:`);
          err.logs.slice(-10).forEach((log: string) => console.error(`  ${log}`));
        }
        throw err;
      }

      // Verify state
      console.log(`${logTime()} Verifying state...`);
      const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);
      const vaultAfter = await provider.connection.getTokenAccountBalance(vault);
      const userAfter = await provider.connection.getTokenAccountBalance(userUsdcAta);

      console.log(`${logTime()} Total Withdrawals: ${poolAccount.totalWithdrawals.toString()}`);
      console.log(`${logTime()} Vault Balance After: ${vaultAfter.value.uiAmount} USDC`);
      console.log(`${logTime()} User Balance After: ${userAfter.value.uiAmount} USDC`);
      console.log(`${logTime()} Withdrawal test completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

      expect(poolAccount.totalWithdrawals.toNumber()).to.be.greaterThan(0);
    });
  });

  describe('6. Summary', () => {
    it('Prints test summary', async () => {
      const poolAccount = await ghostPoolProgram.account.ghostPool.fetch(ghostPool);

      console.log('\n========================================');
      console.log('Ghost Pool DEVNET Test Complete!');
      console.log('========================================');
      console.log('\nCluster Info:');
      console.log('  Cluster Offset:', CLUSTER_OFFSET);
      console.log('  Network: Devnet');
      console.log('\nProgram Addresses:');
      console.log('  Ghost Pool Program:', ghostPoolProgram.programId.toBase58());
      console.log('  Mock Kamino Program:', mockKaminoProgram.programId.toBase58());
      console.log('\nPool State:');
      console.log('  Ghost Pool PDA:', ghostPool.toBase58());
      console.log('  Vault PDA:', vault.toBase58());
      console.log('  Total Deposits:', poolAccount.totalDeposits.toString());
      console.log('  Total Withdrawals:', poolAccount.totalWithdrawals.toString());
      console.log('  State Nonce:', poolAccount.stateNonce.toString());
      console.log('\nTest Results:');
      console.log('  Comp defs initialized (v9 circuits)');
      console.log('  Mock Kamino setup complete');
      console.log('  Pool initialized/verified');
      console.log('  Deposit with encrypted password');
      console.log('  Withdrawal with password verification');
      console.log('========================================\n');
    });
  });
});
