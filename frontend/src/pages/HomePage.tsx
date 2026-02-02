import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ShieldCheck,
  Eye,
  GhostIcon,
  Wallet,
  LockKey,
  TrendUp,
  Vault,
  Clock,
  ChartLineUp,
  Users,
  Target,
  SpinnerGap,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getGhostPoolAddress, getVaultAddress } from "@/lib/pdas";
import { formatUSDC } from "@/lib/arcium";
import { parseGhostPoolData } from "@/lib/idl";
import { GHOST_POOL_AUTHORITY } from "@/config/constants";

// Max deposits from circuit (privacy-preserved capacity)
const MAX_DEPOSITS = 2;

const features = [
  {
    icon: LockKey,
    title: "Password Protected",
    description:
      "Your deposit is secured by a password only you know. Encrypted using MPC - even we cannot see it.",
  },
  {
    icon: Eye,
    title: "Privacy Preserved",
    description:
      "Withdraw from any wallet using your password. No on-chain link between deposit and withdrawal.",
  },
  {
    icon: TrendUp,
    title: "Earn Yield",
    description:
      "Pool funds are invested in Kamino lending protocol. Earn yield while maintaining privacy.",
  },
];

export default function HomePage() {
  const { connected } = useWallet();
  const { connection } = useConnection();

  // Fetch Ghost Pool data
  const ghostPoolAddress = getGhostPoolAddress(GHOST_POOL_AUTHORITY);
  const vaultAddress = getVaultAddress(ghostPoolAddress);

  const {
    data: ghostPool,
    error: poolError,
    isLoading: poolLoading,
  } = useQuery({
    queryKey: ["ghostPool", ghostPoolAddress.toBase58()],
    queryFn: async () => {
      try {
        const accountInfo = await connection.getAccountInfo(ghostPoolAddress);
        if (!accountInfo) {
          console.log("Ghost Pool account not found");
          return null;
        }
        const parsed = parseGhostPoolData(accountInfo.data as Buffer);
        return parsed;
      } catch (error) {
        console.error("Ghost Pool fetch error:", error);
        throw error;
      }
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch vault token balance
  const {
    data: vaultBalance,
    error: vaultError,
    isLoading: vaultLoading,
  } = useQuery({
    queryKey: ["vaultBalance", vaultAddress.toBase58()],
    queryFn: async () => {
      console.log("Fetching vault balance for:", vaultAddress.toBase58());
      try {
        const balance = await connection.getTokenAccountBalance(vaultAddress);
        console.log("Vault balance raw:", balance.value);
        return BigInt(balance.value.amount);
      } catch (error) {
        console.error("Vault balance fetch error:", error);
        throw error; // Re-throw so react-query knows it failed
      }
    },
    refetchInterval: 10000,
  });

  // Log the vault balance state for debugging
  useEffect(() => {
    console.log("Vault balance state:", {
      vaultBalance: vaultBalance?.toString(),
      vaultError: vaultError?.message,
      vaultLoading,
    });
  }, [vaultBalance, vaultError, vaultLoading]);

  // Calculate investment progress
  const investmentProgress = ghostPool
    ? Number(
        (ghostPool.pendingInvestmentAmount * BigInt(100)) /
          (ghostPool.investmentThreshold || BigInt(1)),
      )
    : 0;

  // Format last investment time
  const formatLastInvestment = (timestamp: bigint) => {
    if (timestamp === BigInt(0)) return "Never";
    const date = new Date(Number(timestamp) * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return "Just now";
  };

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="text-center py-16">
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="relative">
            <GhostIcon size={64} weight="fill" className="text-accent" />
            <div className="absolute inset-0 animate-glow blur-xl">
              <GhostIcon
                size={64}
                weight="fill"
                className="text-accent opacity-50"
              />
            </div>
          </div>
        </div>

        <h1 className="text-4xl md:text-6xl font-light tracking-wider mb-4">
          Ghost<span className="text-accent">Pool</span>
        </h1>

        <p className="text-xl text-foreground-muted max-w-2xl mx-auto mb-8">
          Privacy-preserving yield aggregator on Solana. Deposit USDC, earn
          yield, withdraw from any wallet using your secret password.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4">
          {connected ? (
            <>
              <Button asChild size="lg" className="gap-2">
                <Link to="/deposit">
                  <Wallet size={20} />
                  Deposit USDC
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="gap-2">
                <Link to="/withdraw">
                  Withdraw
                  <ArrowRight size={20} />
                </Link>
              </Button>
            </>
          ) : (
            <WalletMultiButton />
          )}
        </div>
      </section>

      {/* Pool Stats */}
      {(ghostPool || poolLoading) && (
        <section className="space-y-6">
          {/* Loading State */}
          {poolLoading && (
            <div className="flex items-center justify-center gap-2 text-foreground-muted">
              <SpinnerGap size={20} className="animate-spin" />
              <span>Loading pool data...</span>
            </div>
          )}

          {/* Error State */}
          {poolError && (
            <div className="flex items-center justify-center gap-2 text-red-400">
              <Warning size={20} />
              <span>Failed to load pool data. Check console for details.</span>
            </div>
          )}

          {ghostPool && (
            <>
              {/* Main Stats Row */}
              <div className="grid md:grid-cols-4 gap-4">
                {/* Vault Balance - Primary Metric */}
                <Card className="text-center relative">
                  <CardContent className="pt-6">
                    <Vault size={24} className="mx-auto mb-2 text-accent" />
                    {vaultLoading ? (
                      <div className="flex items-center justify-center gap-2">
                        <SpinnerGap
                          size={24}
                          className="animate-spin text-accent"
                        />
                      </div>
                    ) : (
                      <p className="text-3xl font-light">
                        {formatUSDC(vaultBalance || BigInt(0))}
                      </p>
                    )}
                    <p className="text-sm text-foreground-muted">
                      Vault Balance (USDC)
                    </p>
                    {vaultError && (
                      <p className="text-xs text-red-400 mt-1">
                        Failed to load
                      </p>
                    )}
                    <p className="text-xs text-foreground-muted mt-1">
                      Actual USDC in vault
                    </p>
                  </CardContent>
                </Card>
                <Card className="text-center">
                  <CardContent className="pt-6">
                    <ChartLineUp
                      size={24}
                      className="mx-auto mb-2 text-green-400"
                    />
                    <p className="text-3xl font-light">
                      {formatUSDC(ghostPool.totalInvested)}
                    </p>
                    <p className="text-sm text-foreground-muted">
                      Invested in Kamino
                    </p>
                    <p className="text-xs text-foreground-muted mt-1">
                      Deployed to yield
                    </p>
                  </CardContent>
                </Card>
                <Card className="text-center">
                  <CardContent className="pt-6">
                    <Users size={24} className="mx-auto mb-2 text-blue-400" />
                    <p className="text-3xl font-light">
                      {ghostPool.totalDeposits.toString()}
                    </p>
                    <p className="text-sm text-foreground-muted">
                      Confirmed Deposits
                    </p>
                    <p className="text-xs text-foreground-muted mt-1">
                      MPC-verified count
                    </p>
                  </CardContent>
                </Card>
                <Card className="text-center">
                  <CardContent className="pt-6">
                    <Clock size={24} className="mx-auto mb-2 text-yellow-400" />
                    <p className="text-3xl font-light">
                      {formatLastInvestment(ghostPool.lastInvestmentTime)}
                    </p>
                    <p className="text-sm text-foreground-muted">Last Batch</p>
                  </CardContent>
                </Card>
              </div>

              {/* Investment Progress Card */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-light flex items-center gap-2">
                    <Target size={20} className="text-accent" />
                    Next Investment Batch
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {/* Progress Bar */}
                    <div className="relative h-4 bg-muted rounded-full overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent to-green-400 transition-all duration-500"
                        style={{
                          width: `${Math.min(investmentProgress, 100)}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground-muted">
                        Pending:{" "}
                        <span className="text-foreground">
                          {formatUSDC(ghostPool.pendingInvestmentAmount)} USDC
                        </span>
                      </span>
                      <span className="text-foreground-muted">
                        Threshold:{" "}
                        <span className="text-foreground">
                          {formatUSDC(ghostPool.investmentThreshold)} USDC
                        </span>
                      </span>
                    </div>
                    <p className="text-xs text-foreground-muted">
                      {investmentProgress >= 100
                        ? "Ready to invest! Funds will be batched to Kamino soon."
                        : `${(100 - investmentProgress).toFixed(0)}% more needed to trigger next batch investment.`}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Secondary Stats Row */}
              <div className="grid md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground-muted">
                          Pool Capacity
                        </p>
                        <p className="text-2xl font-light">
                          {MAX_DEPOSITS} slots
                        </p>
                      </div>
                      <div className="text-xs text-foreground-muted bg-muted px-2 py-1 rounded">
                        Privacy preserved
                      </div>
                    </div>
                    <p className="text-xs text-foreground-muted mt-2">
                      Active depositors hidden via MPC encryption
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground-muted">
                          Confirmed Withdrawals
                        </p>
                        <p className="text-2xl font-light">
                          {ghostPool.totalWithdrawals.toString()}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-foreground-muted mt-2">
                      MPC-verified password withdrawals
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-foreground-muted">
                          Collateral (cTokens)
                        </p>
                        <p className="text-2xl font-light">
                          {formatUSDC(ghostPool.totalCollateralReceived)}
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-foreground-muted mt-2">
                      Kamino cTokens representing invested USDC
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </section>
      )}

      {/* Privacy Badge */}
      <section className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-privacy-encrypted/10 border border-privacy-encrypted/30">
          <ShieldCheck size={20} className="text-privacy-encrypted" />
          <span className="text-sm font-light tracking-wide text-privacy-encrypted">
            Powered by Arcium MPC
          </span>
        </div>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-2xl font-light tracking-wide text-center mb-8">
          Why Ghost Pool?
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {features.map((feature) => (
            <Card key={feature.title} className="card-glow">
              <CardContent className="pt-6">
                <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                  <feature.icon size={24} className="text-accent" />
                </div>
                <h3 className="text-lg font-light tracking-wide mb-2">
                  {feature.title}
                </h3>
                <p className="text-foreground-muted">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="text-center">
        <h2 className="text-2xl font-light tracking-wide mb-8">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-full bg-accent/20 text-accent font-light flex items-center justify-center mx-auto">
              1
            </div>
            <h3 className="font-light tracking-wide">Deposit with Password</h3>
            <p className="text-sm text-foreground-muted">
              Deposit USDC and set a secret password. Your password is encrypted
              using MPC.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-full bg-accent/20 text-accent font-light flex items-center justify-center mx-auto">
              2
            </div>
            <h3 className="font-light tracking-wide">Earn Yield</h3>
            <p className="text-sm text-foreground-muted">
              Pool funds are invested in Kamino. All depositors share returns
              proportionally.
            </p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-full bg-accent/20 text-accent font-light flex items-center justify-center mx-auto">
              3
            </div>
            <h3 className="font-light tracking-wide">Withdraw Privately</h3>
            <p className="text-sm text-foreground-muted">
              Withdraw from any wallet using your password. No link to your
              deposit address.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center py-8">
        <Card className="card-glow inline-block">
          <CardContent className="py-8 px-12">
            <h2 className="text-2xl font-light tracking-wide mb-4">
              Ready to earn yield privately?
            </h2>
            <p className="text-foreground-muted mb-6">
              Connect your wallet and start earning on Solana devnet.
            </p>
            {connected ? (
              <Button asChild size="lg">
                <Link to="/deposit">Make Your First Deposit</Link>
              </Button>
            ) : (
              <WalletMultiButton />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="text-center text-sm text-foreground-muted py-8 border-t border-border">
        <p>Ghost Pool on Solana Devnet</p>
        <p className="mt-2 font-mono text-xs">{ghostPoolAddress.toBase58()}</p>
      </footer>
    </div>
  );
}
