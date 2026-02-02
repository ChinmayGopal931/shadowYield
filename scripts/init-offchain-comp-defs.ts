import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import {
  getClusterAccAddress,
  getMXEAccAddress,
  getCompDefAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
} from '@arcium-hq/client';

// Configuration
const CLUSTER_OFFSET = 456;
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';

// Use new offsets (100-106) to avoid conflict with existing comp defs (0-6)
const OFFCHAIN_COMP_DEF_OFFSETS = {
  initPool: 100,
  deposit: 101,
  checkInvestment: 102,
  recordInvestment: 103,
  recordYield: 104,
  authorizeWithdrawal: 105,
  processWithdrawal: 106,
};

interface CompDefInitResult {
  name: string;
  offset: number;
  address: string;
  txSignature: string;
  success: boolean;
  error?: string;
}

async function initCompDef(
  program: Program<GhostPool>,
  payer: anchor.web3.Keypair,
  initFunctionName: string,
  compDefOffset: number
): Promise<CompDefInitResult> {
  const result: CompDefInitResult = {
    name: initFunctionName,
    offset: compDefOffset,
    address: '',
    txSignature: '',
    success: false,
  };

  try {
    console.log(`\n🔧 Initializing ${initFunctionName} at offset ${compDefOffset}...`);

    const compDefAccount = getCompDefAccAddress(program.programId, compDefOffset);
    result.address = compDefAccount.toBase58();

    // Check if already initialized
    const existingAccount = await program.provider.connection.getAccountInfo(compDefAccount);
    if (existingAccount) {
      console.log(`   ⚠️  Already initialized at ${compDefAccount.toBase58()}`);
      result.success = true;
      result.txSignature = 'already-exists';
      return result;
    }

    const mxeAccount = getMXEAccAddress(program.programId);
    const ARCIUM_PROGRAM_ID = new anchor.web3.PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

    // Call the init function
    const tx = await program.methods[initFunctionName]()
      .accounts({
        payer: payer.publicKey,
        mxeAccount: mxeAccount,
        compDefAccount: compDefAccount,
        arciumProgram: ARCIUM_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    result.txSignature = tx;
    result.success = true;

    console.log(`   ✅ Initialized at ${compDefAccount.toBase58()}`);
    console.log(`   📝 Tx: ${tx}`);

    // Wait for confirmation
    await program.provider.connection.confirmTransaction(tx, 'confirmed');
    console.log(`   ✅ Confirmed`);

  } catch (error: any) {
    result.error = error.message;
    console.error(`   ❌ Error: ${error.message}`);
  }

  return result;
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     Initialize Comp Defs with Offchain IPFS Storage          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Setup connection and provider
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed');
  const wallet = anchor.AnchorProvider.env().wallet;
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  const program = anchor.workspace.GhostPool as Program<GhostPool>;
  const payer = (wallet as anchor.Wallet).payer;

  console.log(`📡 RPC: ${RPC_URL.substring(0, 50)}...`);
  console.log(`🔑 Program: ${program.programId.toBase58()}`);
  console.log(`👤 Payer: ${payer.publicKey.toBase58()}`);
  console.log(`🌐 Cluster Offset: ${CLUSTER_OFFSET}`);
  console.log(`\n💾 Using NEW offsets (100-106) for offchain storage comp defs\n`);
  console.log('─'.repeat(80));

  const results: CompDefInitResult[] = [];

  // Initialize all 7 computation definitions
  const initFunctions = [
    { name: 'initPoolCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.initPool },
    { name: 'initDepositCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.deposit },
    { name: 'initCheckInvestmentNeededCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.checkInvestment },
    { name: 'initRecordInvestmentCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.recordInvestment },
    { name: 'initRecordYieldCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.recordYield },
    { name: 'initAuthorizeWithdrawalCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.authorizeWithdrawal },
    { name: 'initProcessWithdrawalCompDef', offset: OFFCHAIN_COMP_DEF_OFFSETS.processWithdrawal },
  ];

  for (const { name, offset } of initFunctions) {
    const result = await initCompDef(program, payer, name, offset);
    results.push(result);

    // Small delay between transactions
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n📊 Summary:\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`✅ Successful: ${successful.length}/7`);
  console.log(`❌ Failed: ${failed.length}/7\n`);

  if (successful.length > 0) {
    console.log('✅ Successfully initialized:');
    for (const result of successful) {
      console.log(`   ${result.name.padEnd(35)} offset ${result.offset} → ${result.address.substring(0, 8)}...`);
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed to initialize:');
    for (const result of failed) {
      console.log(`   ${result.name.padEnd(35)} offset ${result.offset}`);
      console.log(`      Error: ${result.error}`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\n🎉 Comp defs initialized with offchain IPFS storage!');
  console.log('\n📝 Next steps:');
  console.log('   1. Update test scripts to use new offsets (100-106)');
  console.log('   2. Wait for Arx nodes to fetch circuits from IPFS');
  console.log('   3. Test pool initialization\n');

  // Save offsets to JSON
  const offsetsConfig = {
    clusterOffset: CLUSTER_OFFSET,
    compDefOffsets: OFFCHAIN_COMP_DEF_OFFSETS,
    results: results.map(r => ({
      name: r.name,
      offset: r.offset,
      address: r.address,
      txSignature: r.txSignature,
      success: r.success,
    })),
  };

  const fs = await import('fs');
  fs.writeFileSync('offchain-comp-def-offsets.json', JSON.stringify(offsetsConfig, null, 2));
  console.log('💾 Config saved to: offchain-comp-def-offsets.json\n');
}

main().catch(console.error);
