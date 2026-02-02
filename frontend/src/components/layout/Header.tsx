import { Link, useLocation } from 'react-router-dom'
import { GhostIcon, ArrowDown, ArrowUp, ChartLine } from '@phosphor-icons/react'
import { WalletButton } from '@/components/wallet/WalletButton'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/deposit', label: 'Deposit', icon: ArrowDown },
  { href: '/withdraw', label: 'Withdraw', icon: ArrowUp },
  { href: '/portfolio', label: 'Portfolio', icon: ChartLine },
]

export function Header() {
  const location = useLocation()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="relative">
            <GhostIcon size={32} weight="fill" className="text-accent" />
            <div className="absolute inset-0 animate-pulse-slow blur-md">
              <GhostIcon size={32} weight="fill" className="text-accent opacity-50" />
            </div>
          </div>
          <span className="text-xl font-light tracking-wider">
            Ghost<span className="text-accent">Pool</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = location.pathname === href
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-light tracking-wide transition-colors',
                  isActive
                    ? 'bg-background-elevated text-foreground'
                    : 'text-foreground-muted hover:text-foreground hover:bg-background-elevated/50'
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-4">
          <WalletButton />
        </div>
      </div>
    </header>
  )
}
