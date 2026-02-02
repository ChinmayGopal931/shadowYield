import BigNumber from 'bignumber.js'

// Configure BigNumber for high precision
BigNumber.config({
  DECIMAL_PLACES: 18,
  ROUNDING_MODE: BigNumber.ROUND_DOWN,
})

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatAmount(
  amount: bigint | string | number,
  decimals: number,
  displayDecimals = 4
): string {
  const bn = new BigNumber(amount.toString()).dividedBy(new BigNumber(10).pow(decimals))

  if (bn.isZero()) return '0'

  if (bn.isLessThan(new BigNumber(10).pow(-displayDecimals))) {
    return `<${new BigNumber(10).pow(-displayDecimals).toString()}`
  }

  return bn.toFormat(displayDecimals, BigNumber.ROUND_DOWN)
}

export function formatUSD(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num)
}

export function formatPercentage(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function parseAmount(amount: string, decimals: number): bigint {
  if (!amount || amount === '') return BigInt(0)

  const bn = new BigNumber(amount).multipliedBy(new BigNumber(10).pow(decimals))
  return BigInt(bn.integerValue(BigNumber.ROUND_DOWN).toString())
}

export function formatTimestamp(timestamp: bigint | number): string {
  const ts = typeof timestamp === 'bigint' ? Number(timestamp) : timestamp
  const date = new Date(ts * 1000)
  return date.toLocaleString()
}

export function formatTimeRemaining(expiresAt: bigint): string {
  const now = Math.floor(Date.now() / 1000)
  const expiry = Number(expiresAt)
  const remaining = expiry - now

  if (remaining <= 0) return 'Expired'

  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

// Calculate swap output amount using constant product formula
export function calculateSwapOutput(
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint,
  feeBps: number
): bigint {
  if (inputAmount === BigInt(0)) return BigInt(0)
  if (inputReserve === BigInt(0) || outputReserve === BigInt(0)) return BigInt(0)

  // Apply fee: amount_after_fee = input * (10000 - fee_bps) / 10000
  const feeMultiplier = BigInt(10000 - feeBps)
  const inputWithFee = inputAmount * feeMultiplier

  // constant product: output = (input_with_fee * output_reserve) / (input_reserve * 10000 + input_with_fee)
  const numerator = inputWithFee * outputReserve
  const denominator = inputReserve * BigInt(10000) + inputWithFee

  return numerator / denominator
}

// Calculate price impact
export function calculatePriceImpact(
  inputAmount: bigint,
  inputReserve: bigint,
  outputReserve: bigint,
  feeBps: number
): number {
  if (inputAmount === BigInt(0)) return 0
  if (inputReserve === BigInt(0) || outputReserve === BigInt(0)) return 0

  // Spot price before swap
  const spotPrice = new BigNumber(outputReserve.toString()).dividedBy(inputReserve.toString())

  // Output from swap
  const output = calculateSwapOutput(inputAmount, inputReserve, outputReserve, feeBps)

  // Effective price
  const effectivePrice = new BigNumber(output.toString()).dividedBy(inputAmount.toString())

  // Price impact = (spot - effective) / spot * 100
  const impact = spotPrice.minus(effectivePrice).dividedBy(spotPrice).multipliedBy(100)

  return Math.abs(impact.toNumber())
}
