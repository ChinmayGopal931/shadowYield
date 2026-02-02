import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

const KAMINO_PROGRAM_ID = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  process.stdout.write('Searching for Kamino program accounts on devnet...\n');
  process.stdout.write(`Kamino Program ID: ${KAMINO_PROGRAM_ID.toBase58()}\n`);

  try {
    // First check if program exists
    const programInfo = await connection.getAccountInfo(KAMINO_PROGRAM_ID);
    if (programInfo) {
      process.stdout.write(`Kamino program exists, executable: ${programInfo.executable}\n`);
    } else {
      process.stdout.write('Kamino program not found on devnet!\n');
      return;
    }

    // Try different account sizes for different account types
    const sizes = [8936, 8192, 4096, 2048, 1024, 512, 256];

    for (const size of sizes) {
      const accounts = await connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
        commitment: 'confirmed',
        filters: [
          { dataSize: size }
        ]
      });

      if (accounts.length > 0) {
        process.stdout.write(`\nFound ${accounts.length} accounts with size ${size}:\n`);
        for (const acc of accounts.slice(0, 3)) {
          process.stdout.write(`  ${acc.pubkey.toBase58()}\n`);
        }
      }
    }

    // Also try without size filter to see what's there
    process.stdout.write('\nSearching without size filter (max 20)...\n');
    const allAccounts = await connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
      commitment: 'confirmed',
    });

    process.stdout.write(`Total accounts: ${allAccounts.length}\n`);

    // Group by size
    const sizeMap = new Map<number, number>();
    for (const acc of allAccounts) {
      const size = acc.account.data.length;
      sizeMap.set(size, (sizeMap.get(size) || 0) + 1);
    }

    process.stdout.write('\nAccount sizes found:\n');
    for (const [size, count] of sizeMap.entries()) {
      process.stdout.write(`  Size ${size}: ${count} accounts\n`);
    }

  } catch (error: any) {
    process.stderr.write(`Error: ${error.message}\n`);
  }
}

main().catch(e => process.stderr.write(`${e}\n`));
