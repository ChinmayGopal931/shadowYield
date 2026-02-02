import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { GhostPool } from '../target/types/ghost_pool';
import { getCompDefAccAddress } from '@arcium-hq/client';

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';
const PROGRAM_ID = 'J8KpY5WEyje3dDGnScRMktdL54RyXUAX1Fs13DjPmxoX';

const CIRCUITS = [
  { name: 'init_pool_state', offset: 0 },
  { name: 'process_deposit', offset: 1 },
  { name: 'check_investment_needed', offset: 2 },
  { name: 'record_investment', offset: 3 },
  { name: 'record_yield', offset: 4 },
  { name: 'authorize_withdrawal', offset: 5 },
  { name: 'process_withdrawal', offset: 6 },
];

async function main() {
  const connection = new anchor.web3.Connection(RPC_URL, 'confirmed');
  const programId = new anchor.web3.PublicKey(PROGRAM_ID);

  console.log('Checking comp defs for program:', PROGRAM_ID);
  console.log('');

  let initialized = 0;

  for (const circuit of CIRCUITS) {
    const compDefAddr = getCompDefAccAddress(programId, circuit.offset);
    const accountInfo = await connection.getAccountInfo(compDefAddr);

    const status = accountInfo ? '✅ INITIALIZED' : '❌ NOT FOUND';
    if (accountInfo) initialized++;

    console.log(`${circuit.name.padEnd(30)} ${status} (${compDefAddr.toBase58().substring(0, 8)}...)`);
  }

  console.log('');
  console.log(`Summary: ${initialized}/7 comp defs initialized`);
}

main().catch(console.error);
