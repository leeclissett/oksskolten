import { useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { AUTH_LOGOUT_EVENT, getAuthToken, setAuthToken } from '../../lib/auth'
import { LoginPage } from '../../pages/login-page'

// AuthGate uses its own fetcher that does NOT redirect on 401.
// The global fetcher calls window.location.href = '/' on 401, which causes
// an infinite reload loop when unauthenticated. AuthGate handles 401 by
// showing LoginPage instead.
const meFetcher = (url: string) => {
  const token = getAuthToken()
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then(r => {
    if (!r.ok) throw new Error('Unauthorized')
    return r.json()
  })
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, error, isLoading, mutate } = useSWR<{ email: string }>('/api/me', meFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    errorRetryCount: 0,
  })

  const handleLogin = useCallback((token: string) => {
    setAuthToken(token)
    void mutate()
  }, [mutate])

  useEffect(() => {
    const handleLogout = () => {
      void mutate(undefined, { revalidate: false })
    }

    window.addEventListener(AUTH_LOGOUT_EVENT, handleLogout)
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handleLogout)
  }, [mutate])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text">
        <div className="rounded-full border-2 border-border border-t-accent h-8 w-8 animate-spin" aria-label="Loading" />
      </div>
    )
  }
  if (error || !data) return <LoginPage onLogin={handleLogin} />

  return <>{children}</>
}
