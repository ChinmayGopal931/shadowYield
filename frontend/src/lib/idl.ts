// Ghost Pool IDL and Types
// Privacy-preserving yield aggregator using Arcium MPC

import { PublicKey } from '@solana/web3.js'
import { Buffer } from 'buffer'

export const IDL = {
  "address": "JDCZqN5FRigifouF9PsNMQRt3MxdsVTqYcbaHxS9Y3D3",
  "metadata": {
    "name": "ghost_pool",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Privacy-preserving yield aggregator with hidden depositor identities"
  },
  "instructions": [
    {
      "name": "deposit",
      "discriminator": [242, 35, 198, 137, 82, 225, 242, 182],
      "accounts": [
        { "name": "user", "writable": true, "signer": true },
        { "name": "ghost_pool", "writable": true },
        { "name": "user_usdc_token", "writable": true },
        { "name": "vault_usdc_token", "writable": true },
        { "name": "usdc_mint" },
        { "name": "sign_pda_account", "writable": true },
        { "name": "mxe_account" },
        { "name": "mempool_account", "writable": true },
        { "name": "executing_pool", "writable": true },
        { "name": "computation_account", "writable": true },
        { "name": "comp_def_account" },
        { "name": "cluster_account", "writable": true },
        { "name": "pool_account", "writable": true },
        { "name": "clock_account", "writable": true },
        { "name": "system_program" },
        { "name": "token_program" },
        { "name": "arcium_program" }
      ],
      "args": [
        { "name": "computation_offset", "type": "u64" },
        { "name": "amount", "type": "u64" },
        { "name": "encrypted_password_hash", "type": { "array": ["u8", 32] } },
        { "name": "user_pubkey", "type": { "array": ["u8", 32] } },
        { "name": "nonce", "type": "u128" }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [183, 18, 70, 156, 148, 109, 161, 34],
      "accounts": [
        { "name": "user", "writable": true, "signer": true },
        { "name": "ghost_pool", "writable": true },
        { "name": "sign_pda_account", "writable": true },
        { "name": "mxe_account" },
        { "name": "mempool_account", "writable": true },
        { "name": "executing_pool", "writable": true },
        { "name": "computation_account", "writable": true },
        { "name": "comp_def_account" },
        { "name": "cluster_account", "writable": true },
        { "name": "pool_account", "writable": true },
        { "name": "clock_account", "writable": true },
        { "name": "system_program" },
        { "name": "arcium_program" }
      ],
      "args": [
        { "name": "computation_offset", "type": "u64" },
        { "name": "amount", "type": "u64" },
        { "name": "encrypted_password_hash", "type": { "array": ["u8", 32] } },
        { "name": "user_pubkey", "type": { "array": ["u8", 32] } },
        { "name": "nonce", "type": "u128" }
      ]
    }
  ],
  "accounts": [
    {
      "name": "GhostPool",
      "discriminator": [241, 154, 109, 4, 17, 177, 109, 188]
    }
  ],
  "types": [
    {
      "name": "GhostPool",
      "type": {
        "kind": "struct",
        "fields": [
          { "name": "bump", "type": "u8" },
          { "name": "authority", "type": "pubkey" },
          { "name": "usdc_mint", "type": "pubkey" },
          { "name": "vault_bump", "type": "u8" },
          { "name": "investment_threshold", "type": "u64" },
          { "name": "last_investment_time", "type": "i64" },
          { "name": "state_nonce", "type": "u128" },
          { "name": "encrypted_state", "type": { "array": [{ "array": ["u8", 32] }, 13] } },
          { "name": "total_deposits", "type": "u64" },
          { "name": "total_withdrawals", "type": "u64" },
          { "name": "total_invested", "type": "u64" },
          { "name": "pending_investment_amount", "type": "u64" },
          { "name": "collateral_token_account", "type": "pubkey" },
          { "name": "total_collateral_received", "type": "u64" }
        ]
      }
    }
  ]
} as const

// TypeScript types for Ghost Pool
export type GhostPool = {
  bump: number
  authority: string
  usdcMint: string
  vaultBump: number
  investmentThreshold: bigint
  lastInvestmentTime: bigint
  stateNonce: bigint
  encryptedState: Uint8Array[]
  totalDeposits: bigint
  totalWithdrawals: bigint
  totalInvested: bigint
  pendingInvestmentAmount: bigint
  collateralTokenAccount: string
  totalCollateralReceived: bigint
}

// Helper to parse GhostPool account data
export function parseGhostPoolData(rawData: Buffer | Uint8Array): GhostPool {
  // Ensure we have a Buffer (works in browser with polyfill)
  const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData)
  let offset = 8 // skip discriminator

  const bump = data.readUInt8(offset)
  offset += 1

  const authority = data.slice(offset, offset + 32)
  offset += 32

  const usdcMint = data.slice(offset, offset + 32)
  offset += 32

  const vaultBump = data.readUInt8(offset)
  offset += 1

  const investmentThreshold = data.readBigUInt64LE(offset)
  offset += 8

  const lastInvestmentTime = data.readBigInt64LE(offset)
  offset += 8

  // state_nonce is u128 (16 bytes)
  const stateNonceLo = data.readBigUInt64LE(offset)
  const stateNonceHi = data.readBigUInt64LE(offset + 8)
  const stateNonce = stateNonceLo + (stateNonceHi << BigInt(64))
  offset += 16

  // encrypted_state is [[u8; 32]; 13]
  const encryptedState: Uint8Array[] = []
  for (let i = 0; i < 13; i++) {
    encryptedState.push(new Uint8Array(data.slice(offset, offset + 32)))
    offset += 32
  }

  const totalDeposits = data.readBigUInt64LE(offset)
  offset += 8

  const totalWithdrawals = data.readBigUInt64LE(offset)
  offset += 8

  const totalInvested = data.readBigUInt64LE(offset)
  offset += 8

  const pendingInvestmentAmount = data.readBigUInt64LE(offset)
  offset += 8

  const collateralTokenAccount = data.slice(offset, offset + 32)
  offset += 32

  const totalCollateralReceived = data.readBigUInt64LE(offset)

  return {
    bump,
    authority: new PublicKey(authority).toBase58(),
    usdcMint: new PublicKey(usdcMint).toBase58(),
    vaultBump,
    investmentThreshold,
    lastInvestmentTime,
    stateNonce,
    encryptedState,
    totalDeposits,
    totalWithdrawals,
    totalInvested,
    pendingInvestmentAmount,
    collateralTokenAccount: new PublicKey(collateralTokenAccount).toBase58(),
    totalCollateralReceived,
  }
}
