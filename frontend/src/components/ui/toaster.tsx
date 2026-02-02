import { useToast } from '@/hooks/useToast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Toaster() {
  const { toasts, dismiss } = useToast()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'relative flex w-full max-w-sm items-center justify-between space-x-4 overflow-hidden rounded-lg border p-4 shadow-lg transition-all',
            toast.variant === 'destructive'
              ? 'border-red-600/50 bg-red-600/10 text-red-400'
              : 'border-border bg-background-card text-foreground'
          )}
        >
          <div className="flex-1">
            {toast.title && (
              <div className="text-sm font-light tracking-wide">{toast.title}</div>
            )}
            {toast.description && (
              <div className="text-sm text-foreground-muted">
                {toast.description}
              </div>
            )}
          </div>
          <button
            onClick={() => dismiss(toast.id)}
            className="text-foreground-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
