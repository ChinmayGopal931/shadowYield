import { ReactNode } from 'react'

interface PageContainerProps {
  children: ReactNode
}

export function PageContainer({ children }: PageContainerProps) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {children}
    </div>
  )
}
