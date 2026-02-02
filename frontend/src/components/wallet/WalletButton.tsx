import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { Wallet, SignOut, Copy, Check } from '@phosphor-icons/react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { shortenAddress } from '@/lib/format'

export function WalletButton() {
  const { publicKey, disconnect, connected } = useWallet()
  const { setVisible } = useWalletModal()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey.toBase58())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!connected || !publicKey) {
    return (
      <Button
        onClick={() => setVisible(true)}
        className="gap-2"
      >
        <Wallet size={18} />
        Connect Wallet
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="gap-2 font-mono"
      >
        {copied ? (
          <Check size={16} className="text-privacy-encrypted" />
        ) : (
          <Copy size={16} />
        )}
        {shortenAddress(publicKey.toBase58())}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => disconnect()}
        className="text-foreground-muted hover:text-red-400"
      >
        <SignOut size={18} />
      </Button>
    </div>
  )
}
