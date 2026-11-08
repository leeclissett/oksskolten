import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// --- Mocks ---
const mockMutate = vi.fn()
let swrReturn: { data: any; error: any; isLoading: boolean }

vi.mock('swr', () => ({
  default: (_key: string, _fetcher: any, _opts: any) => ({
    ...swrReturn,
    mutate: mockMutate,
  }),
}))

vi.mock('../../lib/auth', () => ({
  getAuthToken: vi.fn(() => 'test-token'),
  setAuthToken: vi.fn(),
  AUTH_LOGOUT_EVENT: 'reader:auth-logout',
}))

vi.mock('../../pages/login-page', () => ({
  LoginPage: ({ onLogin }: { onLogin: (token: string) => void }) => (
    <div data-testid="login-page">
      <button onClick={() => onLogin('new-token')}>Login</button>
    </div>
  ),
}))

import { AuthGate } from './auth-gate'
import { setAuthToken, AUTH_LOGOUT_EVENT } from '../../lib/auth'

describe('AuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swrReturn = { data: undefined, error: undefined, isLoading: true }
  })

  it('shows loading spinner while authenticating', () => {
    swrReturn = { data: undefined, error: undefined, isLoading: true }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByLabelText('Loading')).toBeTruthy()
    expect(screen.queryByText('App Content')).toBeNull()
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('shows children when authenticated', () => {
    swrReturn = { data: { email: 'user@example.com' }, error: undefined, isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByText('App Content')).toBeTruthy()
    expect(screen.queryByTestId('login-page')).toBeNull()
  })

  it('shows LoginPage when auth error', () => {
    swrReturn = { data: undefined, error: new Error('Unauthorized'), isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByTestId('login-page')).toBeTruthy()
    expect(screen.queryByText('App Content')).toBeNull()
  })

  it('shows LoginPage when no data', () => {
    swrReturn = { data: undefined, error: undefined, isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    expect(screen.getByTestId('login-page')).toBeTruthy()
  })

  it('calls setAuthToken and mutate on login', async () => {
    swrReturn = { data: undefined, error: new Error('Unauthorized'), isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    const loginBtn = screen.getByText('Login')
    loginBtn.click()

    expect(setAuthToken).toHaveBeenCalledWith('new-token')
    expect(mockMutate).toHaveBeenCalled()
  })

  it('clears data on logout event', () => {
    swrReturn = { data: { email: 'user@example.com' }, error: undefined, isLoading: false }
    render(<AuthGate><div>App Content</div></AuthGate>)

    window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT))

    expect(mockMutate).toHaveBeenCalledWith(undefined, { revalidate: false })
  })
})
