import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDeposit } from "@/mutations/useDeposit";
import { getGhostPoolAddress, getVaultAddress } from "@/lib/pdas";
import { formatUSDC } from "@/lib/arcium";
import { parseGhostPoolData } from "@/lib/idl";
import { useToast } from "@/hooks/useToast";
import { Eye, EyeOff, Shield, Lock, Wallet, Loader2, CheckCircle, Clock, ExternalLink } from "lucide-react";

import { GHOST_POOL_AUTHORITY } from "@/config/constants";

export default function DepositPage() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const { toast } = useToast();
  const depositMutation = useDeposit();

  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [depositStatus, setDepositStatus] = useState<{
    step: 'idle' | 'encrypting' | 'building' | 'signing' | 'confirming' | 'waiting_mpc' | 'done' | 'error';
    message: string;
    txSignature?: string;
  }>({ step: 'idle', message: '' });

  // Fetch Ghost Pool data
  const ghostPoolAddress = getGhostPoolAddress(GHOST_POOL_AUTHORITY);

  const {
    data: ghostPool,
    isLoading: isLoadingPool,
    error: poolError,
  } = useQuery({
    queryKey: ["ghostPool", ghostPoolAddress.toBase58()],
    queryFn: async () => {
      console.log("Fetching Ghost Pool:", ghostPoolAddress.toBase58());
      const accountInfo = await connection.getAccountInfo(ghostPoolAddress);
      if (!accountInfo) {
        console.log("Ghost Pool not found on chain");
        return null;
      }
      console.log("Ghost Pool found, parsing...");
      return parseGhostPoolData(accountInfo.data as Buffer);
    },
    enabled: connected,
  });

  // Log pool fetch results
  if (poolError) console.error("Pool fetch error:", poolError);

  // Get vault address and fetch balance
  const vaultAddress = getVaultAddress(ghostPoolAddress);

  const { data: vaultBalance, isLoading: isLoadingVault } = useQuery({
    queryKey: ["vaultBalance", vaultAddress.toBase58()],
    queryFn: async () => {
      console.log("Fetching vault balance:", vaultAddress.toBase58());
      try {
        const balance = await connection.getTokenAccountBalance(vaultAddress);
        console.log("Vault balance:", balance.value);
        return BigInt(balance.value.amount);
      } catch (error) {
        console.error("Vault balance error:", error);
        return BigInt(0);
      }
    },
    enabled: connected,
    refetchInterval: 5000, // Refresh every 5 seconds to show updates
  });

  // MXE Account address from deployment (PROJECT_STATUS.md)
  const MXE_ACCOUNT_ADDRESS = new PublicKey(
    "HbxVudVx6za9RQsxuKPanGMJS6KYXigGXTwbMeiotw7f",
  );

  // Fetch MXE public key
  const {
    data: mxePublicKey,
    isLoading: _isLoadingMXE,
    error: mxeError,
  } = useQuery({
    queryKey: ["mxePublicKey", MXE_ACCOUNT_ADDRESS.toBase58()],
    queryFn: async () => {
      console.log("Fetching MXE account:", MXE_ACCOUNT_ADDRESS.toBase58());
      const accountInfo = await connection.getAccountInfo(MXE_ACCOUNT_ADDRESS);
      if (!accountInfo) {
        throw new Error("MXE account not found");
      }
      console.log("MXE account found, data length:", accountInfo.data.length);

      // MXE Account structure (from Arcium IDL):
      // The x25519 public key is at offset 95 for 32 bytes
      // Verified by comparing with getMXEPublicKey from @arcium-hq/client SDK
      const X25519_PUBKEY_OFFSET = 95;
      const X25519_PUBKEY_LENGTH = 32;

      if (accountInfo.data.length < X25519_PUBKEY_OFFSET + X25519_PUBKEY_LENGTH) {
        throw new Error("MXE account data too short");
      }

      const x25519Pubkey = accountInfo.data.slice(
        X25519_PUBKEY_OFFSET,
        X25519_PUBKEY_OFFSET + X25519_PUBKEY_LENGTH
      );

      console.log("Extracted x25519 public key:", Buffer.from(x25519Pubkey).toString('hex'));
      return new Uint8Array(x25519Pubkey);
    },
    enabled: connected,
  });

  // Log MXE fetch results
  if (mxeError) console.error("MXE fetch error:", mxeError);

  // Fetch user USDC balance
  const { data: usdcBalance } = useQuery({
    queryKey: ["usdcBalance", publicKey?.toBase58(), ghostPool?.usdcMint],
    queryFn: async () => {
      if (!publicKey || !ghostPool) return BigInt(0);
      try {
        const usdcMint = new PublicKey(ghostPool.usdcMint);
        const ata = await getAssociatedTokenAddress(usdcMint, publicKey);
        const account = await getAccount(connection, ata);
        return account.amount;
      } catch {
        return BigInt(0);
      }
    },
    enabled: connected && !!ghostPool,
  });

  const handleDeposit = async () => {
    console.log("Deposit clicked:", {
      publicKey: publicKey?.toBase58(),
      ghostPool,
      mxePublicKey,
    });

    if (!publicKey) {
      toast({
        title: "Error",
        description: "Please connect your wallet",
        variant: "destructive",
      });
      return;
    }

    if (!ghostPool) {
      toast({
        title: "Error",
        description:
          "Ghost Pool not found. Please check the pool exists on devnet.",
        variant: "destructive",
      });
      return;
    }

    if (!mxePublicKey) {
      toast({
        title: "Error",
        description: "MXE not ready. Please try again in a moment.",
        variant: "destructive",
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: "Error",
        description: "Please enter a valid amount",
        variant: "destructive",
      });
      return;
    }

    if (!password || password.length < 8) {
      toast({
        title: "Error",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    try {
      setDepositStatus({ step: 'encrypting', message: 'Encrypting your password with MPC...' });

      // Small delay to show encryption step
      await new Promise(r => setTimeout(r, 500));

      setDepositStatus({ step: 'building', message: 'Building transaction...' });

      const result = await depositMutation.mutateAsync({
        ghostPoolAddress,
        usdcMint: new PublicKey(ghostPool.usdcMint),
        amount,
        password,
        mxePublicKey,
      });

      setDepositStatus({
        step: 'waiting_mpc',
        message: 'Transaction confirmed! Waiting for MPC to process your deposit...',
        txSignature: result.signature
      });

      toast({
        title: "Deposit Submitted!",
        description: "Your USDC has been deposited. The MPC network is now processing your encrypted deposit.",
      });

      // Clear form after a delay
      setTimeout(() => {
        setAmount("");
        setPassword("");
        setConfirmPassword("");
        setDepositStatus({ step: 'idle', message: '' });
      }, 10000);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setDepositStatus({ step: 'error', message: errorMessage });
      toast({
        title: "Deposit Failed",
        description: errorMessage,
        variant: "destructive",
      });

      // Reset after showing error
      setTimeout(() => {
        setDepositStatus({ step: 'idle', message: '' });
      }, 5000);
    }
  };

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="text-center space-y-4">
          <Shield className="w-16 h-16 mx-auto text-primary" />
          <h1 className="text-3xl font-bold">Ghost Pool</h1>
          <p className="text-muted-foreground max-w-md">
            Privacy-preserving yield aggregator. Deposit USDC, earn yield,
            withdraw from any wallet using your secret password.
          </p>
        </div>
        <WalletMultiButton />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Deposit USDC</h1>
        <p className="text-muted-foreground">
          Your deposit is protected by MPC encryption. Only you can withdraw
          with your password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Private Deposit
          </CardTitle>
          <CardDescription>
            Set a password to protect your deposit. You'll need this password to
            withdraw.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pool Stats */}
          {isLoadingPool || isLoadingVault ? (
            <div className="p-4 bg-muted rounded-lg text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Loading pool data...
              </p>
            </div>
          ) : ghostPool ? (
            <div className="space-y-3">
              {/* Primary Metric: Vault Balance */}
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Pool Vault Balance</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {formatUSDC(vaultBalance || BigInt(0))} USDC
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    Actual USDC in vault
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  This updates immediately after your deposit transaction confirms.
                </p>
              </div>

              {/* Secondary Stats */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">MPC Confirmed</p>
                  <p className="text-lg font-semibold">
                    {ghostPool.totalDeposits.toString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Updates after MPC callback (~5-60s)
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Invested in Kamino</p>
                  <p className="text-lg font-semibold">
                    {formatUSDC(ghostPool.totalInvested)} USDC
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Deployed to earn yield
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">
                Ghost Pool not found. Make sure the pool is initialized on
                devnet.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Expected address: {ghostPoolAddress.toBase58()}
              </p>
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
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">USDC</span>
              </div>
            </div>
            {usdcBalance !== undefined && (
              <p className="text-sm text-muted-foreground">
                Balance: {formatUSDC(usdcBalance)} USDC
                <button
                  onClick={() => setAmount(formatUSDC(usdcBalance))}
                  className="ml-2 text-primary hover:underline"
                >
                  Max
                </button>
              </p>
            )}
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 8 characters)</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter a secure password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type={showPassword ? "text" : "password"}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {password && confirmPassword && password !== confirmPassword && (
              <p className="text-sm text-destructive">Passwords do not match</p>
            )}
          </div>

          {/* Warning */}
          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">
              <strong>Important:</strong> Remember your password! It's the only
              way to withdraw your funds. There is no password recovery.
            </p>
          </div>

          {/* Transaction Status */}
          {depositStatus.step !== 'idle' && (
            <div className={`p-4 rounded-lg border ${
              depositStatus.step === 'error'
                ? 'bg-red-500/10 border-red-500/20'
                : depositStatus.step === 'waiting_mpc'
                ? 'bg-green-500/10 border-green-500/20'
                : 'bg-blue-500/10 border-blue-500/20'
            }`}>
              <div className="flex items-center gap-3">
                {depositStatus.step === 'error' ? (
                  <div className="w-5 h-5 text-red-500">✕</div>
                ) : depositStatus.step === 'waiting_mpc' ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                )}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    depositStatus.step === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : depositStatus.step === 'waiting_mpc'
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-blue-600 dark:text-blue-400'
                  }`}>
                    {depositStatus.message}
                  </p>
                  {depositStatus.txSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${depositStatus.txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mt-1"
                    >
                      View transaction <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              {depositStatus.step === 'waiting_mpc' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>MPC callback typically takes 5-30 seconds. Refresh the page to see updated stats.</span>
                </div>
              )}
            </div>
          )}

          {/* Submit Button */}
          <Button
            onClick={handleDeposit}
            disabled={
              depositMutation.isPending ||
              depositStatus.step !== 'idle' ||
              !amount ||
              !password ||
              password !== confirmPassword
            }
            className="w-full"
            size="lg"
          >
            {depositStatus.step !== 'idle' && depositStatus.step !== 'error' ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {depositStatus.step === 'encrypting' && 'Encrypting...'}
                {depositStatus.step === 'building' && 'Building Transaction...'}
                {depositStatus.step === 'signing' && 'Waiting for Signature...'}
                {depositStatus.step === 'confirming' && 'Confirming...'}
                {depositStatus.step === 'waiting_mpc' && 'Processing...'}
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4 mr-2" />
                Deposit USDC
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle>How Ghost Pool Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              1
            </div>
            <div>
              <p className="font-medium">Deposit with Password</p>
              <p className="text-sm text-muted-foreground">
                Your password is encrypted using MPC. Only the encrypted hash is
                stored on-chain.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              2
            </div>
            <div>
              <p className="font-medium">Earn Yield</p>
              <p className="text-sm text-muted-foreground">
                Pool funds are invested in Kamino to earn yield. All depositors
                share the returns.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              3
            </div>
            <div>
              <p className="font-medium">Withdraw Privately</p>
              <p className="text-sm text-muted-foreground">
                Withdraw from any wallet using your password. No on-chain link
                between deposit and withdrawal.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
