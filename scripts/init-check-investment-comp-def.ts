import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey('JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3');
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
const MXE_ACCOUNT = new PublicKey('HbxVudVx6za9RQsxuKPanGMJS6KYXigGXTwbMeiotw7f');

// The expected address from the error message
const COMP_DEF_ACCOUNT = new PublicKey('AZ8uobmHdNrTGfjQnhNU4Q8oQP8EysUMbRZp9PSQdMfw');

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync('target/idl/ghost_pool.json', 'utf-8'));
  const program = new anchor.Program(idl, provider);
  
  console.log('Initializing check_investment_needed comp def');
  console.log('  CompDef PDA:', COMP_DEF_ACCOUNT.toBase58());
  
  // Check if already exists
  const existing = await provider.connection.getAccountInfo(COMP_DEF_ACCOUNT);
  if (existing) {
    console.log('  Already initialized!');
    return;
  }
  
  try {
    const tx = await program.methods.initCheckInvestmentNeededCompDef()
      .accounts({
        payer: provider.wallet.publicKey,
        mxeAccount: MXE_ACCOUNT,
        compDefAccount: COMP_DEF_ACCOUNT,
        arciumProgram: ARCIUM_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log('  TX:', tx);
    console.log('  Success!');
  } catch (error: any) {
    console.error('  Error:', error.message);
    if (error.logs) {
      console.error('  Logs:', error.logs);
    }
  }
}

main().catch(console.error);
