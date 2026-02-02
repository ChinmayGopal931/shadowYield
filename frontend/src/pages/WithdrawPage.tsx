import { useState, useEffect } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PublicKey } from '@solana/web3.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatUSDC } from '@/lib/arcium'
import { useToast } from '@/hooks/useToast'
import { useGhostPoolData } from '@/hooks/useGhostPool'
import { useWithdraw } from '@/mutations/useWithdraw'
import { getGhostPoolAddress } from '@/lib/pdas'
import { Eye, EyeOff, Shield, ArrowDownToLine } from 'lucide-react'

import { GHOST_POOL_AUTHORITY } from '@/config/constants'

// MXE Account for fetching public key
const MXE_ACCOUNT_ADDRESS = new PublicKey('HbxVudVx6za9RQsxuKPanGMJS6KYXigGXTwbMeiotw7f')

export default function WithdrawPage() {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const { toast } = useToast()
  const withdrawMutation = useWithdraw()

  const [amount, setAmount] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mxePublicKey, setMxePublicKey] = useState<Uint8Array | null>(null)

  // Use centralized ghost pool hooks
  const { ghostPool, vaultBalance } = useGhostPoolData(connected)
  const ghostPoolAddress = getGhostPoolAddress(GHOST_POOL_AUTHORITY)

  // Fetch MXE public key on mount
  useEffect(() => {
    const fetchMxeKey = async () => {
      try {
        const accountInfo = await connection.getAccountInfo(MXE_ACCOUNT_ADDRESS)
        if (accountInfo) {
          // Extract x25519 public key from MXE account
          // MXE Account structure: The x25519 public key is at offset 95 for 32 bytes
          // Verified by comparing with getMXEPublicKey from @arcium-hq/client SDK
          const X25519_PUBKEY_OFFSET = 95
          const X25519_PUBKEY_LENGTH = 32
          const x25519Key = accountInfo.data.slice(
            X25519_PUBKEY_OFFSET,
            X25519_PUBKEY_OFFSET + X25519_PUBKEY_LENGTH
          )
          setMxePublicKey(new Uint8Array(x25519Key))
          console.log('*** MXE PUBLIC KEY FOR WITHDRAWAL (offset 97) ***')
          console.log('  Hex:', Buffer.from(x25519Key).toString('hex'))
          console.log('  First 4 bytes:', x25519Key[0], x25519Key[1], x25519Key[2], x25519Key[3])
        }
      } catch (error) {
        console.error('Failed to fetch MXE public key:', error)
      }
    }
    fetchMxeKey()
  }, [connection])

  const handleWithdraw = async () => {
    if (!publicKey || !ghostPool) {
      toast({ title: 'Error', description: 'Please connect wallet', variant: 'destructive' })
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast({ title: 'Error', description: 'Please enter a valid amount', variant: 'destructive' })
      return
    }

    if (!password) {
      toast({ title: 'Error', description: 'Please enter your password', variant: 'destructive' })
      return
    }

    if (!mxePublicKey) {
      toast({ title: 'Error', description: 'MXE not ready. Please try again.', variant: 'destructive' })
      return
    }

    try {
      toast({
        title: 'Withdrawal Initiated',
        description: 'Encrypting password and sending to MPC...',
      })

      const result = await withdrawMutation.mutateAsync({
        ghostPoolAddress,
        amount,
        password,
        mxePublicKey,
      })

      toast({
        title: 'Withdrawal Submitted!',
        description: `MPC is verifying your password. TX: ${result.signature.slice(0, 8)}...`,
      })

      // Clear form
      setAmount('')
      setPassword('')

      // Note about MPC callback
      toast({
        title: 'Waiting for MPC Callback',
        description: 'If your password is correct, the withdrawal will be authorized in ~30-60 seconds.',
      })
    } catch (error: any) {
      console.error('Withdrawal error:', error)
      toast({
        title: 'Withdrawal Failed',
        description: error.message || 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="text-center space-y-4">
          <Shield className="w-16 h-16 mx-auto text-primary" />
          <h1 className="text-3xl font-bold">Ghost Pool</h1>
          <p className="text-muted-foreground max-w-md">
            Connect your wallet to withdraw. You can withdraw from any wallet
            as long as you have your password.
          </p>
        </div>
        <WalletMultiButton />
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Withdraw USDC</h1>
        <p className="text-muted-foreground">
          Enter your deposit password to withdraw your funds to this wallet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownToLine className="w-5 h-5" />
            Private Withdrawal
          </CardTitle>
          <CardDescription>
            Your withdrawal is verified using MPC. No one can see which deposit you're withdrawing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pool Stats */}
          {ghostPool && (
            <div className="space-y-3">
              {/* Primary: Vault Balance */}
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <p className="text-sm text-muted-foreground">Pool Vault Balance</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatUSDC(vaultBalance || BigInt(0))} USDC
                </p>
                <p className="text-xs text-muted-foreground mt-1">Available for withdrawal</p>
              </div>

              {/* Secondary Stats */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">MPC Confirmed Deposits</p>
                  <p className="text-lg font-semibold">{ghostPool.totalDeposits.toString()}</p>
                  <p className="text-xs text-muted-foreground">Verified count</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">MPC Confirmed Withdrawals</p>
                  <p className="text-lg font-semibold">{ghostPool.totalWithdrawals.toString()}</p>
                  <p className="text-xs text-muted-foreground">Completed exits</p>
                </div>
              </div>
            </div>
          )}

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USDC)</Label>
            <div className="relative">
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pr-20"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <span className="text-sm text-muted-foreground">USDC</span>
              </div>
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <Label htmlFor="password">Deposit Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your deposit password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Privacy Notice */}
          <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-600 dark:text-green-400">
              <strong>Privacy Protected:</strong> Your withdrawal is processed through MPC.
              There is no on-chain link between your deposit address and withdrawal address.
            </p>
          </div>

          {/* Beta Notice */}
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              <strong>Beta:</strong> This step verifies your password via MPC. If successful,
              a <code>WithdrawalAuthorizedEvent</code> will be emitted. Full token transfer
              coming in v2.
            </p>
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleWithdraw}
            disabled={withdrawMutation.isPending || !amount || !password || !mxePublicKey}
            className="w-full"
            size="lg"
          >
            {withdrawMutation.isPending ? (
              'Verifying with MPC...'
            ) : !mxePublicKey ? (
              'Loading MXE...'
            ) : (
              <>
                <ArrowDownToLine className="w-4 h-4 mr-2" />
                Withdraw USDC
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle>Frequently Asked Questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="font-medium">Can I withdraw from a different wallet?</p>
            <p className="text-sm text-muted-foreground">
              Yes! You can withdraw from any wallet as long as you have your deposit password.
              This is what makes Ghost Pool private.
            </p>
          </div>
          <div>
            <p className="font-medium">What if I forgot my password?</p>
            <p className="text-sm text-muted-foreground">
              Unfortunately, there is no password recovery. The password is only known to you
              and verified through MPC without ever being revealed.
            </p>
          </div>
          <div>
            <p className="font-medium">How is my yield calculated?</p>
            <p className="text-sm text-muted-foreground">
              Yield is shared proportionally among all depositors based on deposit amount and time.
              The pool invests in Kamino to generate returns.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
