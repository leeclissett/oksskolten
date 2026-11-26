import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { Input } from '../components/ui/input'
import { FormField } from '../components/ui/form-field'
import { PasswordStrength } from '../components/ui/password-strength'
import { useI18n } from '../lib/i18n'
import { useDarkMode } from '../hooks/use-dark-mode'

export function SetupPage({ onLogin }: { onLogin: (token: string) => void }) {
  const { t } = useI18n()
  useDarkMode()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError(t('setup.passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'))
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || t('setup.failed'))
        return
      }

      const data = await res.json()
      if (data.token) {
        onLogin(data.token)
      }
    } catch {
      setError(t('setup.networkError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-sidebar px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg shadow-lg p-8">
        <h1 className="mb-1.5 text-xl font-bold text-text select-none">{t('setup.title')}</h1>
        <p className="mb-6 text-sm text-muted select-none">{t('setup.subtitle')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label={t('login.email')} htmlFor="setup-email">
            <Input
              id="setup-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="py-2.5"
            />
          </FormField>

          <FormField label={t('login.password')} htmlFor="setup-password">
            <Input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="py-2.5"
            />
            <PasswordStrength password={password} />
          </FormField>

          <FormField label={t('setup.confirmPassword')} htmlFor="setup-confirm-password">
            <div className="relative">
              <Input
                id="setup-confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="py-2.5"
              />
              {confirmPassword && password && confirmPassword === password && (
                <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-accent" />
              )}
            </div>
          </FormField>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-text transition-opacity hover:opacity-80 disabled:opacity-50 select-none"
          >
            {loading ? t('setup.creating') : t('setup.submit')}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-error">{error}</p>
        )}
      </div>
    </div>
  )
}
