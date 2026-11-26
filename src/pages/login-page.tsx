import { useState, useEffect, useRef, type FormEvent } from 'react'
import { Input } from '../components/ui/input'
import { FormField } from '../components/ui/form-field'
import { useI18n } from '../lib/i18n'
import { useDarkMode } from '../hooks/use-dark-mode'
import { useTheme } from '../hooks/use-theme'
import { SetupPage } from './setup-page'

interface AuthMethods {
  setup_required?: boolean
}

export function LoginPage({ onLogin }: { onLogin?: (token: string) => void }) {
  const { t } = useI18n()
  const { isDark } = useDarkMode()
  useTheme(isDark)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Prevent browser/PWA from auto-focusing form inputs on mount.
  // Browsers (especially mobile PWA) may autofocus with a delay after render,
  // so we repeatedly blur any focused input for a short window.
  useEffect(() => {
    containerRef.current?.focus()
    const timer = setInterval(() => {
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.blur()
      }
    }, 50)
    const cleanup = setTimeout(() => clearInterval(timer), 500)
    return () => { clearInterval(timer); clearTimeout(cleanup) }
  }, [])

  useEffect(() => {
    fetch('/api/auth/methods')
      .then(r => r.json())
      .then(setMethods)
      .catch(() => {
        // Fallback: show the login form
        setMethods({})
      })
  }, [])

  if (methods?.setup_required && onLogin) {
    return <SetupPage onLogin={onLogin} />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        setError(t('login.failed'))
        return
      }

      const data = await res.json()
      if (onLogin && data.token) {
        onLogin(data.token)
      } else {
        window.location.href = '/'
      }
    } catch {
      setError(t('login.networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-sidebar px-4 outline-none" ref={containerRef} tabIndex={-1}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg shadow-lg p-8">
        <h1 className="mb-1.5 text-xl font-bold text-text select-none">{t('login.title')}</h1>
        <p className="mb-6 text-sm text-muted select-none">{t('login.subtitle')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label={t('login.email')} htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="py-2.5"
            />
          </FormField>

          <FormField label={t('login.password')} htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="py-2.5"
            />
          </FormField>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-text transition-opacity hover:opacity-80 disabled:opacity-50 select-none"
          >
            {loading ? t('login.loading') : t('login.submit')}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-error">{error}</p>
        )}
      </div>
    </div>
  )
}
