import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { Settings, LogOut } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import { fetcher } from '../../lib/fetcher'
import { logoutClient } from '../../lib/auth'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu'

interface SidebarMenuProps {
  onClose: () => void
}

export function SidebarMenu({ onClose }: SidebarMenuProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const { data: profile } = useSWR<{ account_name: string; email: string }>('/api/settings/profile', fetcher)

  const accountName = profile?.account_name || ''
  const email = profile?.email || ''

  const initial = (accountName || '?')[0].toUpperCase()

  return (
    <div className="border-t border-border px-2 py-2 shrink-0 select-none">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-text flex items-center gap-2.5 hover:bg-hover-sidebar transition-colors outline-none"
          >
            <span className="w-7 h-7 rounded-full bg-bg-avatar flex items-center justify-center text-xs font-semibold text-muted shrink-0 select-none">
              {initial}
            </span>
            <span className="truncate">{accountName}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          {email && (
            <div className="px-3.5 py-2 text-xs text-muted truncate">{email}</div>
          )}
          <DropdownMenuItem
            onSelect={() => { void navigate('/settings/general'); onClose() }}
          >
            <Settings size={16} strokeWidth={1.5} />
            {t('sidebar.settings')}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={async () => {
              await fetch('/api/logout', { method: 'POST', signal: AbortSignal.timeout(10_000) }).catch(() => {})
              logoutClient()
            }}
          >
            <LogOut size={16} strokeWidth={1.5} />
            {t('sidebar.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
