import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

import { useGlobalShortcuts } from './use-global-shortcuts'

describe('useGlobalShortcuts', () => {
  const onCommandPalette = vi.fn()
  const onSearch = vi.fn()
  const onAddFeed = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setup() {
    renderHook(() =>
      useGlobalShortcuts({ onCommandPalette, onSearch, onAddFeed }),
    )
  }

  function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...opts,
    })
    document.dispatchEvent(event)
  }

  it('Cmd+K opens command palette', () => {
    setup()
    fireKey('k', { metaKey: true })
    expect(onCommandPalette).toHaveBeenCalledTimes(1)
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+K opens search', () => {
    setup()
    fireKey('k', { metaKey: true, shiftKey: true })
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onCommandPalette).not.toHaveBeenCalled()
  })

  it('Cmd+N opens add feed', () => {
    setup()
    fireKey('n', { metaKey: true })
    expect(onAddFeed).toHaveBeenCalledTimes(1)
  })

  it('Cmd+, navigates to settings', () => {
    setup()
    fireKey(',', { metaKey: true })
    expect(mockNavigate).toHaveBeenCalledWith('/settings/general')
  })

  it('Cmd+1-5 navigates to correct routes', () => {
    setup()
    const routes = ['/inbox', '/bookmarks', '/likes', '/history', '/chat']
    for (let i = 0; i < 5; i++) {
      mockNavigate.mockClear()
      fireKey(String(i + 1), { metaKey: true })
      expect(mockNavigate).toHaveBeenCalledWith(routes[i])
    }
  })
})
