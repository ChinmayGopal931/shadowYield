/**
 * Hook for fetching Ghost Pool data from the blockchain
 *
 * Provides access to the GhostPool account state including:
 * - totalDeposits: Count of MPC-verified deposits
 * - totalWithdrawals: Count of MPC-verified withdrawals
 * - totalInvested: USDC deployed to Kamino
 * - pendingInvestmentAmount: USDC awaiting batch investment
 */

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { getGhostPoolAddress, getVaultAddress } from "@/lib/pdas";
import { parseGhostPoolData } from "@/lib/idl";
import { GHOST_POOL_AUTHORITY } from "@/config/constants";

// Query key factory for consistent cache keys
export const ghostPoolKeys = {
  all: ["ghostPool"] as const,
  pool: (address: string) => [...ghostPoolKeys.all, address] as const,
  vault: (address: string) => ["vaultBalance", address] as const,
};

/**
 * Hook to fetch Ghost Pool account data
 */
export function useGhostPool(enabled = true) {
  const { connection } = useConnection();
  const ghostPoolAddress = getGhostPoolAddress(GHOST_POOL_AUTHORITY);

  return useQuery({
    queryKey: ghostPoolKeys.pool(ghostPoolAddress.toBase58()),
    queryFn: async () => {
      const accountInfo = await connection.getAccountInfo(ghostPoolAddress);
      if (!accountInfo) {
        console.log("Ghost Pool account not found");
        return null;
      }
      const parsed = parseGhostPoolData(accountInfo.data as Buffer);
      return parsed;
    },
    enabled,
    refetchInterval: 10000, // Refresh every 10 seconds
    staleTime: 5000, // Consider data stale after 5 seconds
  });
}

/**
 * Hook to fetch the vault's USDC balance
 * This shows the actual USDC in the vault (updates immediately after deposits)
 */
export function useVaultBalance(enabled = true) {
  const { connection } = useConnection();
  const ghostPoolAddress = getGhostPoolAddress(GHOST_POOL_AUTHORITY);
  const vaultAddress = getVaultAddress(ghostPoolAddress);

  return useQuery({
    queryKey: ghostPoolKeys.vault(vaultAddress.toBase58()),
    queryFn: async () => {
      try {
        const balance = await connection.getTokenAccountBalance(vaultAddress);
        return BigInt(balance.value.amount);
      } catch (error) {
        console.error("Vault balance fetch error:", error);
        throw error;
      }
    },
    enabled,
    refetchInterval: 5000, // Refresh every 5 seconds (faster for vault balance)
    staleTime: 3000,
  });
}

/**
 * Hook that provides all ghost pool related data
 * Combines pool state and vault balance into a single hook
 */
export function useGhostPoolData(enabled = true) {
  const ghostPool = useGhostPool(enabled);
  const vaultBalance = useVaultBalance(enabled);
  const ghostPoolAddress = getGhostPoolAddress(GHOST_POOL_AUTHORITY);
  const vaultAddress = getVaultAddress(ghostPoolAddress);

  return {
    // Ghost Pool state
    ghostPool: ghostPool.data,
    ghostPoolLoading: ghostPool.isLoading,
    ghostPoolError: ghostPool.error,

    // Vault balance (actual USDC)
    vaultBalance: vaultBalance.data,
    vaultLoading: vaultBalance.isLoading,
    vaultError: vaultBalance.error,

    // Addresses
    ghostPoolAddress,
    vaultAddress,

    // Combined loading state
    isLoading: ghostPool.isLoading || vaultBalance.isLoading,

    // Refetch functions
    refetchGhostPool: ghostPool.refetch,
    refetchVaultBalance: vaultBalance.refetch,
    refetchAll: () => {
      ghostPool.refetch();
      vaultBalance.refetch();
    },
  };
}
