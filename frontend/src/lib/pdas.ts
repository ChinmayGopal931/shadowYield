import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { PROGRAM_ID, ARCIUM_PROGRAM_ID } from '@/config/constants'

// Seeds used in Ghost Pool program
const GHOST_POOL_SEED = Buffer.from('ghost_pool')
const VAULT_SEED = Buffer.from('vault')
const ARCIUM_SIGNER_SEED = Buffer.from('ArciumSignerAccount')

// Get Ghost Pool PDA
export function getGhostPoolAddress(authority: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [GHOST_POOL_SEED, authority.toBuffer()],
    PROGRAM_ID
  )
  return address
}

// Get Vault PDA (holds USDC deposits)
export function getVaultAddress(ghostPool: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [VAULT_SEED, ghostPool.toBuffer()],
    PROGRAM_ID
  )
  return address
}

// Get Arcium Signer PDA
export function getArciumSignerAddress(): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [ARCIUM_SIGNER_SEED],
    PROGRAM_ID
  )
  return address
}

// Arcium PDA helpers
export function getMXEAccountAddress(programId: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe')],
    programId
  )
  return address
}

// CompDef addresses are derived by the Arcium client with a specific algorithm
// These are the actual deployed addresses for Ghost Pool v5
const COMP_DEF_ADDRESSES: Record<string, string> = {
  'init_pool_state': '78g6xnwaZsw14MXKCG7rNaKu5zePxqjcXU1TpLuhCL7Z',
  'process_deposit': '73DERH4q8viKTMWMAqnNrak3zGK9tdAAd6JyqPwrqNS6',
  'check_investment_needed': 'AZ8uobmHdNrTGfjQnhNU4Q8oQP8EysUMbRZp9PSQdMfw',
  'record_investment': '951gctFEZ4vvkzKyV7ieg7H1mk2gCZxe8Y5k7m6vaGjA',
  'record_yield': 'CjdFt9paYimiVSe3F4QdrubGtPA3P46QsG87ys2fPGQe',
  'authorize_withdrawal': '23UGJLXTDew9QGPCjhSBnfuLCWT5x6cKNmFyv9MhrKYh',
  'process_withdrawal': 'BkXBMd73CUAzZZ9KguGa7qL9HYqf5PTzzwaaCbj76wvq',
}

export function getCompDefAccountAddress(programId: PublicKey, offset: number): PublicKey {
  // Find the circuit name from the offset
  const offsetToName: Record<number, string> = {
    0xfa38b400: 'init_pool_state',
    0x3f0101eb: 'process_deposit',
    0x914fd06b: 'check_investment_needed',
    0x543ae6bf: 'record_investment',
    0x9bceb826: 'record_yield',
    0x1448933b: 'authorize_withdrawal',
    0xe6beaba6: 'process_withdrawal',
  }

  const name = offsetToName[offset]
  if (name && COMP_DEF_ADDRESSES[name]) {
    return new PublicKey(COMP_DEF_ADDRESSES[name])
  }

  // Fallback to derivation (may not match Arcium client)
  const offsetBuffer = Buffer.alloc(4)
  offsetBuffer.writeUInt32LE(offset)

  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from('comp_def'), offsetBuffer],
    programId
  )
  return address
}

// Arcium PDA seeds (from @arcium-hq/client source)
const ARCIUM_CLUSTER_SEED = 'Cluster'
const ARCIUM_MEMPOOL_SEED = 'Mempool'
const ARCIUM_EXECPOOL_SEED = 'Execpool'
const ARCIUM_COMPUTATION_SEED = 'ComputationAccount'

// Derive Arcium cluster account
export function getClusterAccountAddress(clusterOffset: number): PublicKey {
  const offsetBuffer = Buffer.alloc(4)
  offsetBuffer.writeUInt32LE(clusterOffset)

  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from(ARCIUM_CLUSTER_SEED), offsetBuffer],
    ARCIUM_PROGRAM_ID
  )
  return address
}

// Derive Arcium computation account - uses BN for compatibility with Anchor
export function getComputationAccountAddress(clusterOffset: number, computationOffset: { toArrayLike: (type: typeof Buffer, endian: string, size: number) => Buffer }): PublicKey {
  const clusterBuffer = Buffer.alloc(4)
  clusterBuffer.writeUInt32LE(clusterOffset)

  // computationOffset is a BN, use toArrayLike for proper serialization
  const compBuffer = computationOffset.toArrayLike(Buffer, 'le', 8)

  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from(ARCIUM_COMPUTATION_SEED), clusterBuffer, compBuffer],
    ARCIUM_PROGRAM_ID
  )
  return address
}

// Derive Arcium mempool account
export function getMempoolAccountAddress(clusterOffset: number): PublicKey {
  const offsetBuffer = Buffer.alloc(4)
  offsetBuffer.writeUInt32LE(clusterOffset)

  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from(ARCIUM_MEMPOOL_SEED), offsetBuffer],
    ARCIUM_PROGRAM_ID
  )
  return address
}

// Derive Arcium executing pool account
export function getExecutingPoolAddress(clusterOffset: number): PublicKey {
  const offsetBuffer = Buffer.alloc(4)
  offsetBuffer.writeUInt32LE(clusterOffset)

  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from(ARCIUM_EXECPOOL_SEED), offsetBuffer],
    ARCIUM_PROGRAM_ID
  )
  return address
}

// Compute comp def offset from circuit name (matches Rust implementation)
// These are SHA256(name) first 4 bytes as little-endian u32
export function computeCompDefOffset(name: string): number {
  const knownOffsets: Record<string, number> = {
    'init_pool_state': 0xfa38b400,      // 4198020096
    'process_deposit': 0x3f0101eb,      // 1057030635
    'check_investment_needed': 0x914fd06b, // 2437927019
    'record_investment': 0x543ae6bf,    // 1413146303
    'record_yield': 0x9bceb826,         // 2614016038
    'authorize_withdrawal': 0x1448933b, // 340300603
    'process_withdrawal': 0xe6beaba6,   // 3871255462
  }

  return knownOffsets[name] ?? 0
}
