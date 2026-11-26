import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface HintBannerProps {
  storageKey: string
  children: ReactNode
}

export function HintBanner({ storageKey, children }: HintBannerProps) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1')

  if (dismissed) return null

  const handleDismiss = () => {
    localStorage.setItem(storageKey, '1')
    setDismissed(true)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 pt-3 pb-3">
      <div className="flex items-start gap-2 rounded-lg bg-bg-subtle px-3 py-2.5 text-sm text-muted select-none">
        <span className="flex-1">{children}</span>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded p-0.5 hover:bg-hover transition-colors"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
