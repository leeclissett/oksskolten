import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface UseGlobalShortcutsOptions {
  onCommandPalette: () => void
  onSearch: () => void
  onAddFeed: () => void
}

export function useGlobalShortcuts({
  onCommandPalette,
  onSearch,
  onAddFeed,
}: UseGlobalShortcutsOptions) {
  const navigate = useNavigate()

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey

      const isInput =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (e.target as HTMLElement).tagName,
        ) || (e.target as HTMLElement).isContentEditable

      if (meta && e.key === 'k' && !e.shiftKey) {
        e.preventDefault()
        onCommandPalette()
        return
      }

      if (meta && e.key === 'k' && e.shiftKey) {
        e.preventDefault()
        onSearch()
        return
      }

      if (isInput) return

      if (meta && e.key === 'n') {
        e.preventDefault()
        onAddFeed()
        return
      }

      if (meta && e.key === ',') {
        e.preventDefault()
        void navigate('/settings/general')
        return
      }

      if (meta && e.key >= '1' && e.key <= '5') {
        e.preventDefault()
        const routes = ['/inbox', '/bookmarks', '/likes', '/history', '/chat']
        const idx = parseInt(e.key) - 1
        if (routes[idx]) void navigate(routes[idx])
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCommandPalette, onSearch, onAddFeed, navigate])
}
