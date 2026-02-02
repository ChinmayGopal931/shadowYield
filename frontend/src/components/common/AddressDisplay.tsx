import { useState } from 'react'
import { Copy, Check, ArrowSquareOut } from '@phosphor-icons/react'
import { shortenAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CLUSTER } from '@/config/constants'

interface AddressDisplayProps {
  address: string
  truncate?: boolean
  showCopy?: boolean
  showExplorer?: boolean
  className?: string
}

export function AddressDisplay({
  address,
  truncate = true,
  showCopy = true,
  showExplorer = true,
  className,
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const explorerUrl = `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="font-mono text-sm">
        {truncate ? shortenAddress(address) : address}
      </span>

      {showCopy && (
        <button
          onClick={handleCopy}
          className="text-foreground-muted hover:text-foreground transition-colors"
        >
          {copied ? (
            <Check size={14} className="text-privacy-encrypted" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      )}

      {showExplorer && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground-muted hover:text-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowSquareOut size={14} />
        </a>
      )}
    </div>
  )
}
