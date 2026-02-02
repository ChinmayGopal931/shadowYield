/**
 * Arcium MPC Encryption Utilities for Ghost Pool
 *
 * Ghost Pool uses password-based deposits:
 * - User provides a password
 * - Password is hashed (SHA-256 → truncated to u128)
 * - Hash is encrypted with MXE public key using X25519 + RescueCipher
 * - Encrypted hash is stored in MPC state
 * - For withdrawal, user provides password again, MPC verifies match
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { Buffer } from 'buffer'

// Generate a random nonce (16 bytes = 128 bits)
export function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(16)
  crypto.getRandomValues(nonce)
  return nonce
}

// Convert bytes to bigint (little-endian)
export function deserializeLE(bytes: Uint8Array): bigint {
  let value = BigInt(0)
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << BigInt(8)) | BigInt(bytes[i])
  }
  return value
}

// Serialize bigint to little-endian bytes
export function serializeLE(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length)
  let v = value
  for (let i = 0; i < length; i++) {
    result[i] = Number(v & BigInt(0xff))
    v = v >> BigInt(8)
  }
  return result
}

// Hash password to u128 using SHA-256, take first 16 bytes
export async function hashPassword(password: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  // Take first 16 bytes for u128
  return new Uint8Array(hashBuffer.slice(0, 16))
}

// Lazy load the Arcium crypto utilities to avoid initialization issues
let arciumCrypto: {
  RescueCipher: new (sharedSecret: Uint8Array) => {
    encrypt: (plaintext: bigint[], nonce: Uint8Array) => number[][]
  }
} | null = null

async function getArciumCrypto() {
  if (!arciumCrypto) {
    // Dynamic import to avoid initialization issues
    const module = await import('@arcium-hq/client')
    arciumCrypto = {
      RescueCipher: module.RescueCipher,
    }
  }
  return arciumCrypto
}

/**
 * Encrypt password hash for deposit/withdrawal
 *
 * Uses X25519 key exchange + RescueCipher
 * 1. Generate ephemeral X25519 keypair
 * 2. Derive shared secret via ECDH with MXE public key
 * 3. Initialize RescueCipher with shared secret
 * 4. Encrypt the password hash
 */
export async function encryptPasswordHash(
  password: string,
  mxePublicKey: Uint8Array
): Promise<{
  encryptedHash: Uint8Array   // 32 bytes (encrypted u128)
  clientPubkey: Uint8Array    // 32 bytes (X25519 public key)
  nonce: bigint               // u128 nonce
}> {
  // Hash the password to get a u128 value
  const passwordHashBytes = await hashPassword(password)
  const passwordHashBigInt = deserializeLE(passwordHashBytes)

  // Generate X25519 keypair for encryption
  const userPrivateKey = x25519.utils.randomSecretKey()
  const userPublicKey = x25519.getPublicKey(userPrivateKey)

  // Derive shared secret via ECDH
  const sharedSecret = x25519.getSharedSecret(userPrivateKey, mxePublicKey)

  // Generate nonce for encryption
  const nonceBytes = generateNonce()
  const nonceBigInt = deserializeLE(nonceBytes)

  try {
    // Try to use the Arcium RescueCipher for proper encryption
    console.log('Loading Arcium crypto module...')
    const { RescueCipher } = await getArciumCrypto()
    console.log('RescueCipher loaded successfully')

    const cipher = new RescueCipher(sharedSecret)
    console.log('RescueCipher initialized with shared secret')

    // Encrypt just the password hash (u128)
    // The circuit expects Enc<Shared, u128> - a single encrypted field element
    const plaintext = [passwordHashBigInt]
    console.log('Encrypting password hash:', passwordHashBigInt.toString(16))
    const ciphertext = cipher.encrypt(plaintext, nonceBytes)
    console.log('Encryption successful, ciphertext length:', ciphertext.length)

    // The ciphertext[0] is the encrypted password hash as 32 bytes
    const encryptedHash = new Uint8Array(ciphertext[0])
    console.log('Encrypted hash (hex):', Buffer.from(encryptedHash).toString('hex'))

    return {
      encryptedHash,
      clientPubkey: userPublicKey,
      nonce: nonceBigInt,
    }
  } catch (error) {
    console.error('RescueCipher encryption failed:', error)
    console.error('Falling back to XOR (will NOT work with MPC!)')

    // Fallback: Simple XOR encryption with shared secret (for testing only)
    // This won't work with the MPC but allows testing the transaction flow
    const encryptedHash = new Uint8Array(32)
    const hashBytes = serializeLE(passwordHashBigInt, 16)
    for (let i = 0; i < 16; i++) {
      encryptedHash[i] = hashBytes[i] ^ sharedSecret[i]
    }

    return {
      encryptedHash,
      clientPubkey: userPublicKey,
      nonce: nonceBigInt,
    }
  }
}

// Check if MXE keygen is complete (utility pubkeys are set)
export interface MXEAccount {
  cluster: number | null
  utilityPubkeys: {
    set?: {
      x25519Pubkey: Uint8Array
      ed25519VerifyingKey: Uint8Array
      elgamalPubkey: Uint8Array
    }
  }
  status: { active?: object; recovery?: object }
}

export function isMXEReady(mxeAccount: MXEAccount | null): boolean {
  if (!mxeAccount) return false
  if (mxeAccount.cluster === null) return false
  if (!mxeAccount.utilityPubkeys?.set) return false
  if (!('active' in mxeAccount.status)) return false
  return true
}

export function getMXEPublicKey(mxeAccount: MXEAccount): Uint8Array | null {
  if (!mxeAccount.utilityPubkeys?.set) return null
  return mxeAccount.utilityPubkeys.set.x25519Pubkey
}

/**
 * Format USDC amount for display
 * USDC has 6 decimals
 */
export function formatUSDC(amount: bigint): string {
  const divisor = BigInt(1_000_000)
  const whole = amount / divisor
  const fraction = amount % divisor
  if (fraction === BigInt(0)) {
    return whole.toString()
  }
  const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole}.${fractionStr}`
}

/**
 * Parse USDC amount from string
 */
export function parseUSDC(amount: string): bigint {
  const parts = amount.split('.')
  const whole = BigInt(parts[0] || '0')
  let fraction = BigInt(0)
  if (parts[1]) {
    const fractionStr = parts[1].padEnd(6, '0').slice(0, 6)
    fraction = BigInt(fractionStr)
  }
  return whole * BigInt(1_000_000) + fraction
}
