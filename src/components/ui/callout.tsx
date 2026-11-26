import { cn } from '@/lib/utils'

interface CalloutProps {
  variant?: 'accent' | 'error'
  className?: string
  children: React.ReactNode
}

export function Callout({ variant = 'accent', className, children }: CalloutProps) {
  return (
    <div
      className={cn(
        'bg-bg-subtle border-l-4 rounded p-4 mb-8',
        variant === 'error' ? 'border-error' : 'border-accent',
        className,
      )}
    >
      {children}
    </div>
  )
}
