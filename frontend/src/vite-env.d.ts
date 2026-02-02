/// <reference types="vite/client" />

declare module '*.css' {
  const content: string
  export default content
}

declare module '@solana/wallet-adapter-react-ui/styles.css'

interface Window {
  Buffer: typeof import('buffer').Buffer
}
