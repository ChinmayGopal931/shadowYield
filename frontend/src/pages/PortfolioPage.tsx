import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { Link } from 'react-router-dom'
import { PublicKey } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token'
import { Wallet, GhostIcon, CurrencyCircleDollar, ShieldCheck, Info } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatUSDC } from '@/lib/arcium'
import { useGhostPoolData } from '@/hooks/useGhostPool'

export default function PortfolioPage() {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()

  // Use the centralized ghost pool hooks
  const {
    ghostPool,
    ghostPoolLoading: poolLoading,
    vaultBalance,
    vaultLoading,
  } = useGhostPoolData(connected)

  // Fetch user USDC balance
  const { data: usdcBalance, isLoading: balanceLoading } = useQuery({
    queryKey: ['usdcBalance', publicKey?.toBase58(), ghostPool?.usdcMint],
    queryFn: async () => {
      if (!publicKey || !ghostPool) return BigInt(0)
      try {
        const usdcMint = new PublicKey(ghostPool.usdcMint)
        const ata = await getAssociatedTokenAddress(usdcMint, publicKey)
        const account = await getAccount(connection, ata)
        return account.amount
      } catch {
        return BigInt(0)
      }
    },
    enabled: connected && !!ghostPool,
  })

  if (!connected) {
    return (
      <div className="text-center py-16">
        <Wallet size={48} className="mx-auto text-foreground-muted mb-4" />
        <h2 className="text-xl font-light tracking-wide mb-2">Connect Your Wallet</h2>
        <p className="text-foreground-muted">
          Connect your wallet to view your portfolio
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Wallet size={28} className="text-accent" />
        <h1 className="text-2xl font-light tracking-wide">Portfolio</h1>
      </div>

      {/* Wallet Balance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CurrencyCircleDollar size={24} className="text-accent" />
            Wallet Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balanceLoading ? (
            <Skeleton className="h-10 w-32" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-light">{formatUSDC(usdcBalance || BigInt(0))}</span>
              <span className="text-foreground-muted">USDC</span>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button asChild>
              <Link to="/deposit">Deposit to Pool</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pool Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GhostIcon size={24} weight="fill" className="text-accent" />
            Ghost Pool Stats
          </CardTitle>
          <CardDescription>
            Current state of the privacy pool
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(poolLoading || vaultLoading) ? (
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : ghostPool ? (
            <div className="space-y-4">
              {/* Primary: Vault Balance */}
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-sm text-foreground-muted">Pool Vault Balance</p>
                <p className="text-3xl font-light text-green-600 dark:text-green-400">
                  {formatUSDC(vaultBalance || BigInt(0))} USDC
                </p>
                <p className="text-xs text-foreground-muted mt-1">
                  Actual USDC held in the vault (updates immediately after deposits)
                </p>
              </div>

              {/* Secondary Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-background-elevated rounded-lg">
                  <p className="text-sm text-foreground-muted">MPC Confirmed Deposits</p>
                  <p className="text-2xl font-light">{ghostPool.totalDeposits.toString()}</p>
                  <p className="text-xs text-foreground-muted">Updates after MPC callback</p>
                </div>
                <div className="p-4 bg-background-elevated rounded-lg">
                  <p className="text-sm text-foreground-muted">Invested in Kamino</p>
                  <p className="text-2xl font-light">{formatUSDC(ghostPool.totalInvested)} USDC</p>
                  <p className="text-xs text-foreground-muted">Deployed to earn yield</p>
                </div>
                <div className="p-4 bg-background-elevated rounded-lg">
                  <p className="text-sm text-foreground-muted">MPC Confirmed Withdrawals</p>
                  <p className="text-2xl font-light">{ghostPool.totalWithdrawals.toString()}</p>
                  <p className="text-xs text-foreground-muted">Password-verified exits</p>
                </div>
                <div className="p-4 bg-background-elevated rounded-lg">
                  <p className="text-sm text-foreground-muted">Pending Investment</p>
                  <p className="text-2xl font-light">{formatUSDC(ghostPool.pendingInvestmentAmount)} USDC</p>
                  <p className="text-xs text-foreground-muted">Awaiting batch to Kamino</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-foreground-muted">Pool not found</p>
          )}
        </CardContent>
      </Card>

      {/* Privacy Notice */}
      <Card className="border-privacy-encrypted/30">
        <CardContent className="py-6">
          <div className="flex gap-4">
            <ShieldCheck size={32} className="text-privacy-encrypted flex-shrink-0" />
            <div>
              <h3 className="font-light tracking-wide mb-2">Your Deposits are Private</h3>
              <p className="text-sm text-foreground-muted">
                Ghost Pool uses MPC encryption to protect your deposits. Your individual deposit
                details are not visible on-chain or to anyone else. Only you can withdraw your
                funds using your secret password.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Help Section */}
      <Card>
        <CardContent className="py-6">
          <div className="flex gap-4">
            <Info size={24} className="text-accent flex-shrink-0" />
            <div className="space-y-3">
              <h3 className="font-light tracking-wide">Need to Withdraw?</h3>
              <p className="text-sm text-foreground-muted">
                To withdraw your funds, go to the Withdraw page and enter the password you
                used when depositing. You can withdraw from any wallet - your deposit address
                is not linked to your withdrawal.
              </p>
              <Button asChild variant="outline">
                <Link to="/withdraw">Go to Withdraw</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
