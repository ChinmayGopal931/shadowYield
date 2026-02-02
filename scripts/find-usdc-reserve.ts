import * as anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

const KAMINO_PROGRAM_ID = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f';

// Known USDC mints on devnet
const USDC_MINTS = [
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Circle devnet USDC
  'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr', // Another common devnet USDC
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Mainnet USDC (for reference)
];

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  process.stdout.write('Searching for USDC Kamino reserves on devnet...\n\n');

  // Get all Reserve-sized accounts (size 8624)
  const reserves = await connection.getProgramAccounts(KAMINO_PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [
      { dataSize: 8624 }
    ]
  });

  process.stdout.write(`Found ${reserves.length} reserve accounts\n\n`);

  for (const reserve of reserves) {
    const data = reserve.account.data;

    // Reserve struct layout (approximate):
    // 0-8: discriminator
    // Various fields...
    // The liquidity mint pubkey is typically at a specific offset

    // Try to extract potential mint pubkeys from the data
    // Looking at offsets that might contain mint pubkeys

    // Common offsets to check for mint pubkey in Reserve struct
    const offsets = [8, 40, 72, 104, 136, 168, 200, 232, 264, 296];

    process.stdout.write(`\nReserve: ${reserve.pubkey.toBase58()}\n`);

    for (const offset of offsets) {
      if (offset + 32 <= data.length) {
        const potentialPubkey = new PublicKey(data.slice(offset, offset + 32));
        const pubkeyStr = potentialPubkey.toBase58();

        // Check if this looks like a known USDC mint
        if (USDC_MINTS.includes(pubkeyStr)) {
          process.stdout.write(`  *** USDC MINT FOUND at offset ${offset}: ${pubkeyStr}\n`);
        }

        // Also check if it's a valid-looking pubkey (not all zeros/ones)
        const isNonZero = data.slice(offset, offset + 32).some((b: number) => b !== 0);
        const isNonMax = data.slice(offset, offset + 32).some((b: number) => b !== 255);
        if (isNonZero && isNonMax && offset < 300) {
          // Print first few potential pubkeys for debugging
          process.stdout.write(`  Offset ${offset}: ${pubkeyStr.substring(0, 20)}...\n`);
        }
      }
    }
  }

  // Let's also check what USDC-looking token mints exist
  process.stdout.write('\n\nChecking for any token accounts that might be USDC vaults...\n');

  // Get accounts with size 165 (token accounts)
  const tokenAccounts = await connection.getProgramAccounts(
    new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    {
      commitment: 'confirmed',
      filters: [
        { dataSize: 165 },
        {
          memcmp: {
            offset: 32, // owner offset
            bytes: reserves[0]?.pubkey.toBase58() || '',
          }
        }
      ]
    }
  );

  process.stdout.write(`Found ${tokenAccounts.length} token accounts owned by first reserve\n`);
}

main().catch(e => process.stderr.write(`${e}\n`));
