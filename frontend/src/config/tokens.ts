import { PublicKey } from '@solana/web3.js'

export interface TokenInfo {
  address: PublicKey
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

// Known tokens on devnet - these would typically be populated from a token list
export const KNOWN_TOKENS: Record<string, TokenInfo> = {
  // These are placeholder addresses - replace with actual devnet token mints
  'So11111111111111111111111111111111111111112': {
    address: new PublicKey('So11111111111111111111111111111111111111112'),
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
}

export function getTokenInfo(mint: PublicKey | string): TokenInfo | undefined {
  const mintStr = typeof mint === 'string' ? mint : mint.toBase58()
  return KNOWN_TOKENS[mintStr]
}

export function getTokenSymbol(mint: PublicKey | string): string {
  const info = getTokenInfo(mint)
  return info?.symbol || shortenAddress(typeof mint === 'string' ? mint : mint.toBase58())
}

export function getTokenDecimals(mint: PublicKey | string): number {
  const info = getTokenInfo(mint)
  return info?.decimals ?? 9 // Default to 9 decimals
}

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}
