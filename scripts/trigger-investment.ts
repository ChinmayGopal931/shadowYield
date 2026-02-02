import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey('JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3');
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
const MXE_ACCOUNT = new PublicKey('HbxVudVx6za9RQsxuKPanGMJS6KYXigGXTwbMeiotw7f');
const CLUSTER_OFFSET = 456;

const GHOST_POOL_AUTHORITY = new PublicKey('8YGx7Q2kP1F8Bt5qeaMEX3k6ZdiVu82zHHctoDZo6QGu');
const CHECK_INVESTMENT_COMP_DEF = new PublicKey('AZ8uobmHdNrTGfjQnhNU4Q8oQP8EysUMbRZp9PSQdMfw');

function getGhostPoolAddress(authority: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ghost_pool'), authority.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function getVaultAddress(ghostPool: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), ghostPool.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

// Correct seed: 'ArciumSignerAccount'
function getSignPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    PROGRAM_ID
  );
  return pda;
}

function getClusterPda(): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(CLUSTER_OFFSET);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('Cluster'), offsetBuffer],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

function getMempoolPda(): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(CLUSTER_OFFSET);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('Mempool'), offsetBuffer],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

function getExecpoolPda(): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(CLUSTER_OFFSET);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('Execpool'), offsetBuffer],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

function getComputationPda(offset: anchor.BN): PublicKey {
  const clusterBuffer = Buffer.alloc(4);
  clusterBuffer.writeUInt32LE(CLUSTER_OFFSET);
  const compBuffer = offset.toArrayLike(Buffer, 'le', 8);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ComputationAccount'), clusterBuffer, compBuffer],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync('target/idl/ghost_pool.json', 'utf-8'));
  const program = new anchor.Program(idl, provider);
  
  const ghostPool = getGhostPoolAddress(GHOST_POOL_AUTHORITY);
  const vault = getVaultAddress(ghostPool);
  
  console.log('=== Trigger Investment Check ===');
  console.log('Ghost Pool:', ghostPool.toBase58());
  
  const vaultBalance = await provider.connection.getTokenAccountBalance(vault);
  console.log('Vault Balance:', vaultBalance.value.uiAmount, 'USDC');
  
  const computationOffset = new anchor.BN(Date.now());
  
  const signPda = getSignPda();
  const clusterAccount = getClusterPda();
  const mempoolAccount = getMempoolPda();
  const execpoolAccount = getExecpoolPda();
  const computationAccount = getComputationPda(computationOffset);
  
  const poolAccount = new PublicKey('G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC');
  const clockAccount = new PublicKey('7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot');
  
  console.log('Sign PDA:', signPda.toBase58());
  
  try {
    const tx = await program.methods.checkAndInvest(computationOffset)
      .accounts({
        authority: provider.wallet.publicKey,
        ghostPool,
        signPdaAccount: signPda,
        mxeAccount: MXE_ACCOUNT,
        mempoolAccount,
        executingPool: execpoolAccount,
        computationAccount,
        compDefAccount: CHECK_INVESTMENT_COMP_DEF,
        clusterAccount,
        poolAccount,
        clockAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        arciumProgram: ARCIUM_PROGRAM_ID,
      })
      .rpc();
    
    console.log('Check investment TX:', tx);
    console.log('Waiting for MPC callback (60s)...');
    
    await new Promise(r => setTimeout(r, 60000));
    
    const poolInfo = await provider.connection.getAccountInfo(ghostPool);
    const pendingAmount = poolInfo!.data.readBigUInt64LE(546);
    console.log('Pending Investment Amount:', Number(pendingAmount) / 1e6, 'USDC');
  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.logs) console.error('Logs:', error.logs);
  }
}

main().catch(console.error);
