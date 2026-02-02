import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { GhostPool } from '../target/types/ghost_pool';
import * as fs from 'fs';

const RPC_URL = "https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f";
const PROGRAM_ID = new PublicKey("75zDFC2xyiHxSiLe1ykFGvRAkiUZpRSe1qAEz7kms8L2");
// MXE account is derived from program ID by Arcium
const MXE_ACCOUNT = new PublicKey("BcG3AjsbGjzQKMsyfcnRRW3UquaPqWxmWHZthJz8g37n");
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");

const circuits = [
  'init_pool_state',
  'process_deposit',
  'check_investment_needed',
  'record_investment',
  'record_yield',
  'authorize_withdrawal',
  'process_withdrawal',
];

async function main() {
  console.log('\\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Initialize Comp Defs with Optimized Circuits         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  const walletPath = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const walletKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync('target/idl/ghost_pool.json', 'utf-8'));
  const program = new Program(idl, provider) as Program<GhostPool>;

  console.log('Program ID:', PROGRAM_ID.toString());
  console.log('MXE Account:', MXE_ACCOUNT.toString());
  console.log('Payer:', wallet.publicKey.toString());
  console.log('');

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`SOL Balance: ${(balance / 1e9).toFixed(4)} SOL\\n`);

  if (balance < 1e9) {
    console.log('⚠️  Low balance! You may need more SOL for initialization.');
    console.log('');
  }

  const results = [];

  for (const circuit of circuits) {
    try {
      console.log(`📋 Initializing ${circuit}...`);

      const methodName = `init${circuit.split('_').map(w =>
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join('')}CompDef`;

      console.log(`   Method: ${methodName}`);

      // Derive comp def PDA
      const [compDefAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("comp_def"), Buffer.from(circuit)],
        ARCIUM_PROGRAM_ID
      );

      console.log(`   Comp Def: ${compDefAccount.toString().slice(0, 16)}...`);

      const tx = await program.methods[methodName]()
        .accounts({
          payer: wallet.publicKey,
          mxeAccount: MXE_ACCOUNT,
          compDefAccount,
          arciumProgram: ARCIUM_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true });

      console.log(`   ✅ Success! TX: ${tx.slice(0, 16)}...\\n`);

      results.push({
        circuit,
        status: 'SUCCESS',
        compDefAccount: compDefAccount.toString(),
        tx,
      });

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error: any) {
      console.log(`   ❌ Failed: ${error.message}\\n`);

      results.push({
        circuit,
        status: 'FAILED',
        error: error.message,
      });
    }
  }

  console.log('\\n' + '─'.repeat(80));
  console.log('\\n📊 Summary:\\n');

  const successful = results.filter(r => r.status === 'SUCCESS');
  const failed = results.filter(r => r.status === 'FAILED');

  console.log(`✅ Successful: ${successful.length}/7`);
  console.log(`❌ Failed: ${failed.length}/7\\n`);

  if (successful.length > 0) {
    console.log('✅ Successfully initialized:');
    successful.forEach(r => {
      console.log(`   - ${r.circuit}`);
      console.log(`     Address: ${r.compDefAccount}`);
    });
    console.log('');
  }

  if (failed.length > 0) {
    console.log('❌ Failed:');
    failed.forEach(r => {
      console.log(`   - ${r.circuit}: ${r.error}`);
    });
    console.log('');
  }

  const finalBalance = await connection.getBalance(wallet.publicKey);
  const cost = (balance - finalBalance) / 1e9;
  console.log(`💰 Total Cost: ${cost.toFixed(4)} SOL\\n`);

  if (successful.length === 7) {
    console.log('🎉 All comp defs initialized successfully!');
    console.log('\\n✨ The record_yield circuit is now ready to test! ✨\\n');
  } else {
    console.log(`⚠️  ${failed.length} comp def(s) failed. Review errors above.\\n`);
  }
}

main().catch(err => {
  console.error('\\n❌ Error:', err);
  process.exit(1);
});
