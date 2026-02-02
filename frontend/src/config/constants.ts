import { PublicKey, Cluster } from '@solana/web3.js'

// Ghost Pool Program ID (v5)
export const PROGRAM_ID = new PublicKey('JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3')

// Mock Kamino Program ID
export const KAMINO_PROGRAM_ID = new PublicKey('B4HMWFxLVtCiv9cxbsqRo77LGdcZa6P1tt8YcmEWNwC2')

// Arcium Program ID
export const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ')

export const CLUSTER: Cluster = 'devnet'
export const RPC_ENDPOINT = 'https://devnet.helius-rpc.com/?api-key=a9002ef8-4f2b-45ea-b7b0-40af9f1bd54f'

// Arcium cluster offset for devnet
export const ARCIUM_CLUSTER_OFFSET = 456

// Arcium account addresses
export const ARCIUM_POOL_ACCOUNT = new PublicKey('G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC')
export const ARCIUM_CLOCK_ACCOUNT = new PublicKey('7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot')

// Ghost Pool configuration
export const DEFAULT_INVESTMENT_THRESHOLD = 1000_000_000 // 1000 USDC (6 decimals)

// USDC mint on devnet (created for testing) - v12 pool
export const USDC_MINT = new PublicKey('6Rne9h8p8maqR1Ts5SaCcRE9eaxyVXBfRs8zH62goDSo')

// Ghost Pool Authority for v12 pool
export const GHOST_POOL_AUTHORITY = new PublicKey('8YGx7Q2kP1F8Bt5qeaMEX3k6ZdiVu82zHHctoDZo6QGu')
export const USDC_DECIMALS = 6
