import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ListNavigationValue {
  /** Path of the article list the user last looked at, used by the article page's back button. */
  lastListUrl: string | null
  setLastListUrl: (url: string | null) => void
}

const STORAGE_KEY = 'kb_last_list_url'

const ListNavigationContext = createContext<ListNavigationValue | null>(null)

export function ListNavigationProvider({ children }: { children: ReactNode }) {
  const [lastListUrl, setLastListUrlState] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY))

  const setLastListUrl = useCallback((url: string | null) => {
    setLastListUrlState(url)
    if (url) sessionStorage.setItem(STORAGE_KEY, url)
    else sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <ListNavigationContext.Provider value={{ lastListUrl, setLastListUrl }}>
      {children}
    </ListNavigationContext.Provider>
  )
}

export function useListNavigationContext() {
  const ctx = useContext(ListNavigationContext)
  if (!ctx) throw new Error('useListNavigationContext must be used within ListNavigationProvider')
  return ctx
}
