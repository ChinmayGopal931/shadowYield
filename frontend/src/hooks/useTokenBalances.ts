import { useQuery } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { getAccount, getAssociatedTokenAddress, TokenAccountNotFoundError } from '@solana/spl-token'

export function useTokenBalance(mint: PublicKey | string | null) {
  const { connection } = useConnection()
  const { publicKey } = useWallet()

  const mintPubkey = mint ? (typeof mint === 'string' ? new PublicKey(mint) : mint) : null

  return useQuery({
    queryKey: ['tokenBalance', publicKey?.toBase58(), mintPubkey?.toBase58()],
    queryFn: async (): Promise<bigint> => {
      if (!publicKey || !mintPubkey) return BigInt(0)

      try {
        const ata = await getAssociatedTokenAddress(mintPubkey, publicKey)
        const account = await getAccount(connection, ata)
        return account.amount
      } catch (e) {
        if (e instanceof TokenAccountNotFoundError) {
          return BigInt(0)
        }
        throw e
      }
    },
    enabled: !!publicKey && !!mintPubkey,
    staleTime: 10_000,
  })
}

export function useTokenBalances(mints: (PublicKey | string)[]) {
  const { connection } = useConnection()
  const { publicKey } = useWallet()

  return useQuery({
    queryKey: ['tokenBalances', publicKey?.toBase58(), mints.map(m => m.toString()).join(',')],
    queryFn: async (): Promise<Map<string, bigint>> => {
      if (!publicKey || mints.length === 0) return new Map()

      const balances = new Map<string, bigint>()

      await Promise.all(
        mints.map(async (mint) => {
          const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint
          try {
            const ata = await getAssociatedTokenAddress(mintPubkey, publicKey)
            const account = await getAccount(connection, ata)
            balances.set(mintPubkey.toBase58(), account.amount)
          } catch (e) {
            if (e instanceof TokenAccountNotFoundError) {
              balances.set(mintPubkey.toBase58(), BigInt(0))
            }
          }
        })
      )

      return balances
    },
    enabled: !!publicKey && mints.length > 0,
    staleTime: 10_000,
  })
}
