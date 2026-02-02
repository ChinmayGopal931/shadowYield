import { CurrencyCircleDollar } from '@phosphor-icons/react'
import { getTokenInfo } from '@/config/tokens'
import { cn } from '@/lib/utils'

interface TokenLogoProps {
  mint: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
}

export function TokenLogo({ mint, size = 'md', className }: TokenLogoProps) {
  const tokenInfo = getTokenInfo(mint)

  if (tokenInfo?.logoURI) {
    return (
      <img
        src={tokenInfo.logoURI}
        alt={tokenInfo.symbol}
        className={cn(sizeMap[size], 'rounded-full', className)}
      />
    )
  }

  return (
    <div
      className={cn(
        sizeMap[size],
        'rounded-full bg-background-elevated flex items-center justify-center',
        className
      )}
    >
      <CurrencyCircleDollar
        size={size === 'sm' ? 14 : size === 'md' ? 20 : 24}
        className="text-foreground-muted"
      />
    </div>
  )
}
