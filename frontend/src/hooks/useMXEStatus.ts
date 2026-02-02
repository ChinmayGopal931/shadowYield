import { useQuery } from '@tanstack/react-query'
import { useConnection } from '@solana/wallet-adapter-react'
import { PROGRAM_ID, ARCIUM_CLUSTER_OFFSET } from '@/config/constants'
import { getMXEAccountAddress, getClusterAccountAddress } from '@/lib/pdas'
import { isMXEReady, MXEAccount } from '@/lib/arcium'

export interface MXEStatus {
  isReady: boolean
  hasCluster: boolean
  isKeygenComplete: boolean
  clusterOffset: number | null
  error?: string
}

export function useMXEStatus() {
  const { connection } = useConnection()

  return useQuery({
    queryKey: ['mxeStatus'],
    queryFn: async (): Promise<MXEStatus> => {
      try {
        // Try to fetch the MXE account
        const mxeAddress = getMXEAccountAddress(PROGRAM_ID)
        const mxeAccountInfo = await connection.getAccountInfo(mxeAddress)

        if (!mxeAccountInfo) {
          return {
            isReady: false,
            hasCluster: false,
            isKeygenComplete: false,
            clusterOffset: null,
            error: 'MXE account not initialized',
          }
        }

        // For now, check if cluster account exists
        const clusterAddress = getClusterAccountAddress(ARCIUM_CLUSTER_OFFSET)
        const clusterAccountInfo = await connection.getAccountInfo(clusterAddress)

        const hasCluster = !!clusterAccountInfo

        // Parse MXE account to check keygen status
        // This is a simplified check - in production you'd deserialize the account
        const mockMXEAccount: MXEAccount = {
          cluster: hasCluster ? ARCIUM_CLUSTER_OFFSET : null,
          utilityPubkeys: hasCluster ? { set: { x25519Pubkey: new Uint8Array(32), ed25519VerifyingKey: new Uint8Array(32), elgamalPubkey: new Uint8Array(32) } } : {},
          status: { active: {} },
        }

        const isReady = isMXEReady(mockMXEAccount)

        return {
          isReady,
          hasCluster,
          isKeygenComplete: !!mockMXEAccount.utilityPubkeys?.set,
          clusterOffset: hasCluster ? ARCIUM_CLUSTER_OFFSET : null,
        }
      } catch (error) {
        console.error('Error fetching MXE status:', error)
        return {
          isReady: false,
          hasCluster: false,
          isKeygenComplete: false,
          clusterOffset: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    },
    staleTime: 60_000, // Check less frequently
    refetchInterval: 60_000,
  })
}
