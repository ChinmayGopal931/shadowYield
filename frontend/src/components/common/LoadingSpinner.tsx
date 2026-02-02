import { CircleNotch } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  size?: number
  className?: string
}

export function LoadingSpinner({ size = 24, className }: LoadingSpinnerProps) {
  return (
    <CircleNotch
      size={size}
      className={cn('animate-spin text-accent', className)}
    />
  )
}
