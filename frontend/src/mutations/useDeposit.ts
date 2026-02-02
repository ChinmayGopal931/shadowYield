import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import { BN } from '@coral-xyz/anchor'
import { PROGRAM_ID, ARCIUM_PROGRAM_ID, ARCIUM_CLUSTER_OFFSET, ARCIUM_POOL_ACCOUNT, ARCIUM_CLOCK_ACCOUNT } from '@/config/constants'
import {
  getVaultAddress,
  getArciumSignerAddress,
  getCompDefAccountAddress,
  computeCompDefOffset,
  getComputationAccountAddress,
  getClusterAccountAddress,
  getMempoolAccountAddress,
  getExecutingPoolAddress,
} from '@/lib/pdas'

// MXE Account address from deployment (PROJECT_STATUS.md)
const MXE_ACCOUNT_ADDRESS = new PublicKey('HbxVudVx6za9RQsxuKPanGMJS6KYXigGXTwbMeiotw7f')
import { encryptPasswordHash, parseUSDC } from '@/lib/arcium'

interface DepositParams {
  ghostPoolAddress: PublicKey
  usdcMint: PublicKey
  amount: string        // Amount in USDC (e.g., "100.50")
  password: string      // User's secret password
  mxePublicKey: Uint8Array
}

// Instruction discriminator for deposit (from Anchor)
// sha256("global:deposit")[0..8]
const DEPOSIT_DISCRIMINATOR = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182])

export function useDeposit() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ghostPoolAddress, usdcMint, amount, password, mxePublicKey }: DepositParams) => {
      if (!publicKey) throw new Error('Wallet not connected')

      // Parse amount to u64 (with 6 decimals)
      const amountU64 = parseUSDC(amount)

      // Get vault PDA
      const vault = getVaultAddress(ghostPoolAddress)

      // Get user USDC token account
      const userUsdcToken = await getAssociatedTokenAddress(usdcMint, publicKey)

      // Get vault USDC token account (same as vault for SPL tokens)
      const vaultUsdcToken = vault

      // Encrypt password hash
      const { encryptedHash, clientPubkey, nonce } = await encryptPasswordHash(password, mxePublicKey)

      // Generate computation offset (unique for this transaction)
      // Use BN for compatibility with Arcium client
      const computationOffsetBN = new BN(Date.now())

      // Derive Arcium accounts using correct seeds matching @arcium-hq/client
      const signPdaAccount = getArciumSignerAddress()
      const mxeAccount = MXE_ACCOUNT_ADDRESS  // Use deployed MXE account
      const clusterAccount = getClusterAccountAddress(ARCIUM_CLUSTER_OFFSET)

      const mempoolAccount = getMempoolAccountAddress(ARCIUM_CLUSTER_OFFSET)
      const executingPool = getExecutingPoolAddress(ARCIUM_CLUSTER_OFFSET)
      const computationAccount = getComputationAccountAddress(ARCIUM_CLUSTER_OFFSET, computationOffsetBN)
      const compDefAccount = getCompDefAccountAddress(PROGRAM_ID, computeCompDefOffset('process_deposit'))

      console.log('Building deposit transaction...')
      console.log('  User:', publicKey.toBase58())
      console.log('  Ghost Pool:', ghostPoolAddress.toBase58())
      console.log('  Vault:', vault.toBase58())
      console.log('  MXE:', mxeAccount.toBase58())
      console.log('  Amount:', amountU64.toString())
      console.log('  Computation Offset:', computationOffsetBN.toString())
      console.log('  Computation Account:', computationAccount.toBase58())
      console.log('  Cluster:', clusterAccount.toBase58())
      console.log('  Mempool:', mempoolAccount.toBase58())
      console.log('  Executing Pool:', executingPool.toBase58())
      console.log('  CompDef:', compDefAccount.toBase58())

      // Build instruction data
      // deposit(computation_offset: u64, amount: u64, encrypted_password_hash: [u8; 32], user_pubkey: [u8; 32], nonce: u128)
      const data = Buffer.concat([
        DEPOSIT_DISCRIMINATOR,
        computationOffsetBN.toArrayLike(Buffer, 'le', 8),
        new BN(amountU64.toString()).toArrayLike(Buffer, 'le', 8),
        Buffer.from(encryptedHash),
        Buffer.from(clientPubkey),
        // nonce as u128 (16 bytes, little-endian)
        (() => {
          const buf = Buffer.alloc(16)
          let n = nonce
          for (let i = 0; i < 16; i++) {
            buf[i] = Number(n & BigInt(0xff))
            n = n >> BigInt(8)
          }
          return buf
        })(),
      ])

      const depositIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: ghostPoolAddress, isSigner: false, isWritable: true },
          { pubkey: userUsdcToken, isSigner: false, isWritable: true },
          { pubkey: vaultUsdcToken, isSigner: false, isWritable: true },
          { pubkey: usdcMint, isSigner: false, isWritable: false },
          { pubkey: signPdaAccount, isSigner: false, isWritable: true },
          { pubkey: mxeAccount, isSigner: false, isWritable: false },
          { pubkey: mempoolAccount, isSigner: false, isWritable: true },
          { pubkey: executingPool, isSigner: false, isWritable: true },
          { pubkey: computationAccount, isSigner: false, isWritable: true },
          { pubkey: compDefAccount, isSigner: false, isWritable: false },
          { pubkey: clusterAccount, isSigner: false, isWritable: true },
          { pubkey: ARCIUM_POOL_ACCOUNT, isSigner: false, isWritable: true },
          { pubkey: ARCIUM_CLOCK_ACCOUNT, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
      })

      const transaction = new Transaction().add(depositIx)

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      console.log('Transaction built:')
      console.log('  Blockhash:', blockhash)
      console.log('  Fee payer:', publicKey.toBase58())
      console.log('  Instruction accounts:', depositIx.keys.length)

      // Simulate transaction first to catch errors
      try {
        console.log('Simulating transaction...')
        const simulation = await connection.simulateTransaction(transaction)
        if (simulation.value.err) {
          console.error('Simulation failed:', simulation.value.err)
          console.error('Logs:', simulation.value.logs)
          throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`)
        }
        console.log('Simulation successful')
      } catch (simError: unknown) {
        console.error('Simulation error:', simError)
        // Continue anyway - simulation can fail for various reasons
      }

      console.log('Sending transaction to wallet...')
      const signature = await sendTransaction(transaction, connection)
      console.log('Transaction sent:', signature)

      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      })

      return { signature, computationOffset: computationOffsetBN }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghostPool'] })
      queryClient.invalidateQueries({ queryKey: ['tokenBalance'] })
      queryClient.invalidateQueries({ queryKey: ['tokenBalances'] })
    },
  })
}
