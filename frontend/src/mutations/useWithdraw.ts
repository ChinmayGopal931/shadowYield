import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { BN } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import { PROGRAM_ID, ARCIUM_PROGRAM_ID, ARCIUM_CLUSTER_OFFSET, ARCIUM_POOL_ACCOUNT, ARCIUM_CLOCK_ACCOUNT, USDC_MINT } from '@/config/constants'
import {
  getArciumSignerAddress,
  getCompDefAccountAddress,
  computeCompDefOffset,
  getComputationAccountAddress,
  getClusterAccountAddress,
  getMempoolAccountAddress,
  getExecutingPoolAddress,
  getVaultAddress,
} from '@/lib/pdas'

// MXE Account address from deployment (PROJECT_STATUS.md)
const MXE_ACCOUNT_ADDRESS = new PublicKey('HbxVudVx6za9RQsxuKPanGMJS6KYXigGXTwbMeiotw7f')
import { encryptPasswordHash, parseUSDC } from '@/lib/arcium'

interface WithdrawParams {
  ghostPoolAddress: PublicKey
  amount: string        // Amount in USDC (e.g., "100.50")
  password: string      // User's secret password
  mxePublicKey: Uint8Array
}

// Instruction discriminator for withdraw (from Anchor)
// sha256("global:withdraw")[0..8]
const WITHDRAW_DISCRIMINATOR = Buffer.from([183, 18, 70, 156, 148, 109, 161, 34])

export function useWithdraw() {
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ ghostPoolAddress, amount, password, mxePublicKey }: WithdrawParams) => {
      if (!publicKey) throw new Error('Wallet not connected')

      // Parse amount to u64 (with 6 decimals)
      const amountU64 = parseUSDC(amount)

      // Encrypt password hash
      const { encryptedHash, clientPubkey, nonce } = await encryptPasswordHash(password, mxePublicKey)

      // Generate computation offset (unique for this transaction)
      const computationOffsetBN = new BN(Date.now())

      // Derive Arcium accounts
      const signPdaAccount = getArciumSignerAddress()
      const mxeAccount = MXE_ACCOUNT_ADDRESS
      const clusterAccount = getClusterAccountAddress(ARCIUM_CLUSTER_OFFSET)
      const mempoolAccount = getMempoolAccountAddress(ARCIUM_CLUSTER_OFFSET)
      const executingPool = getExecutingPoolAddress(ARCIUM_CLUSTER_OFFSET)
      const computationAccount = getComputationAccountAddress(ARCIUM_CLUSTER_OFFSET, computationOffsetBN)
      const compDefAccount = getCompDefAccountAddress(PROGRAM_ID, computeCompDefOffset('authorize_withdrawal'))

      // Derive vault and user token account
      const vault = getVaultAddress(ghostPoolAddress)
      const userTokenAccount = await getAssociatedTokenAddress(USDC_MINT, publicKey)

      console.log('Building withdraw transaction...')
      console.log('  User:', publicKey.toBase58())
      console.log('  Ghost Pool:', ghostPoolAddress.toBase58())
      console.log('  Vault:', vault.toBase58())
      console.log('  User Token Account:', userTokenAccount.toBase58())
      console.log('  MXE:', mxeAccount.toBase58())
      console.log('  Amount:', amountU64.toString())
      console.log('  Computation Offset:', computationOffsetBN.toString())
      console.log('  CompDef:', compDefAccount.toBase58())

      // Build instruction data
      // withdraw(computation_offset: u64, amount: u64, encrypted_password_hash: [u8; 32], user_pubkey: [u8; 32], nonce: u128)
      const data = Buffer.concat([
        WITHDRAW_DISCRIMINATOR,
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

      // Withdraw instruction accounts (from Withdraw struct in lib.rs)
      // Order: user, ghost_pool, vault, user_token_account, token_program, sign_pda, mxe, mempool, execpool, computation, comp_def, cluster, pool, clock, system, arcium
      const withdrawIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: ghostPoolAddress, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: userTokenAccount, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
          { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data,
      })

      const transaction = new Transaction().add(withdrawIx)

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = publicKey

      console.log('Transaction built:')
      console.log('  Blockhash:', blockhash)
      console.log('  Fee payer:', publicKey.toBase58())
      console.log('  Instruction accounts:', withdrawIx.keys.length)

      // Simulate transaction first
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
        // Continue anyway
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
      queryClient.invalidateQueries({ queryKey: ['vaultBalance'] })
      queryClient.invalidateQueries({ queryKey: ['tokenBalance'] })
      queryClient.invalidateQueries({ queryKey: ['tokenBalances'] })
    },
  })
}
