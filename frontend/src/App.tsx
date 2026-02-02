import { useMemo, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { WalletError } from '@solana/wallet-adapter-base'
import { clusterApiUrl } from '@solana/web3.js'
import { Header } from '@/components/layout/Header'
import { PageContainer } from '@/components/layout/PageContainer'
import { Toaster } from '@/components/ui/toaster'
import HomePage from '@/pages/HomePage'
import DepositPage from '@/pages/DepositPage'
import WithdrawPage from '@/pages/WithdrawPage'
import PortfolioPage from '@/pages/PortfolioPage'
import { CLUSTER, RPC_ENDPOINT } from '@/config/constants'
import '@solana/wallet-adapter-react-ui/styles.css'

function App() {
  const endpoint = useMemo(() => RPC_ENDPOINT || clusterApiUrl(CLUSTER), [])

  // Use empty array - let wallet-standard handle detection
  // This avoids duplicate registrations that cause conflicts
  const wallets = useMemo(() => [], [])

  // Error handler to log wallet errors for debugging
  const onError = useCallback((error: WalletError) => {
    console.error('Wallet error:', error.name, error.message)
    if (error.error) {
      console.error('Underlying error:', error.error)
    }
  }, [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <WalletModalProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">
              <PageContainer>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/deposit" element={<DepositPage />} />
                  <Route path="/withdraw" element={<WithdrawPage />} />
                  <Route path="/portfolio" element={<PortfolioPage />} />
                </Routes>
              </PageContainer>
            </main>
          </div>
          <Toaster />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default App
