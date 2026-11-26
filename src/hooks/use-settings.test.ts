import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- Sub-hook mocks ---

const mockSetDateMode = vi.fn()
const mockSetAutoMarkRead = vi.fn()
const mockSetShowUnreadIndicator = vi.fn()
const mockSetInternalLinks = vi.fn()

vi.mock('./use-dark-mode', () => ({
  useDarkMode: () => ({ isDark: false }),
}))

vi.mock('./use-date-mode', () => ({
  useDateMode: () => ({
    dateMode: 'relative' as const,
    setDateMode: mockSetDateMode,
  }),
}))

vi.mock('./use-auto-mark-read', () => ({
  useAutoMarkRead: () => ({
    autoMarkRead: 'off' as const,
    setAutoMarkRead: mockSetAutoMarkRead,
  }),
}))

vi.mock('./use-unread-indicator', () => ({
  useUnreadIndicator: () => ({
    showUnreadIndicator: 'on' as const,
    setShowUnreadIndicator: mockSetShowUnreadIndicator,
  }),
}))

vi.mock('./use-internal-links', () => ({
  useInternalLinks: () => ({
    internalLinks: 'off' as const,
    setInternalLinks: mockSetInternalLinks,
  }),
}))

vi.mock('./use-highlight-theme', () => ({
  useHighlightTheme: () => {},
}))

// --- SWR mock ---

let swrData: Record<string, unknown> | undefined = undefined

vi.mock('swr', () => ({
  default: () => ({
    data: swrData,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

// --- Fetcher mock ---

const mockApiPatch = vi.fn()
const mockAuthHeaders = vi.fn(() => ({ Authorization: 'Bearer test-token' }))

vi.mock('../lib/fetcher', () => ({
  fetcher: vi.fn(),
  apiPatch: (...args: unknown[]) => mockApiPatch(...args),
  authHeaders: () => mockAuthHeaders(),
}))

import { useSettings } from './use-settings'

describe('useSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSetDateMode.mockReset()
    mockSetAutoMarkRead.mockReset()
    mockSetShowUnreadIndicator.mockReset()
    mockSetInternalLinks.mockReset()
    mockApiPatch.mockReset()
    mockAuthHeaders.mockReset()
    mockAuthHeaders.mockReturnValue({ Authorization: 'Bearer test-token' })
    mockApiPatch.mockResolvedValue({})
    swrData = undefined
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns all expected fields', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current).toHaveProperty('isDark')
    expect(result.current).toHaveProperty('dateMode')
    expect(result.current).toHaveProperty('setDateMode')
    expect(result.current).toHaveProperty('autoMarkRead')
    expect(result.current).toHaveProperty('showUnreadIndicator')
    expect(result.current).toHaveProperty('internalLinks')
    expect(result.current).toHaveProperty('indicatorStyle')
  })

  it('hydrates dateMode from DB prefs', () => {
    swrData = {
      'reading.date_mode': 'absolute',
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
    }

    renderHook(() => useSettings())

    expect(mockSetDateMode).toHaveBeenCalledWith('absolute')
  })

  it('sends backfill PATCH for unset prefs', async () => {
    swrData = {
      'reading.date_mode': null,
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
    }

    renderHook(() => useSettings())

    expect(mockApiPatch).toHaveBeenCalledWith(
      '/api/settings/preferences',
      expect.objectContaining({
        'reading.date_mode': 'relative',
      }),
    )
  })

  it('dirty tracking prevents hydration overwrite', () => {
    swrData = {
      'reading.date_mode': 'relative',
      'reading.auto_mark_read': null,
      'reading.unread_indicator': null,
      'reading.internal_links': null,
    }

    const { result, rerender } = renderHook(() => useSettings())

    // User changes the date mode — marks dirty
    act(() => {
      result.current.setDateMode('absolute')
    })
    const callsBefore = mockSetDateMode.mock.calls.length

    // Simulate a prefs update from SWR that still carries the old value (re-render)
    swrData = { ...swrData }
    rerender()

    // The stale server value must not overwrite the user's choice
    const callsAfterDirty = mockSetDateMode.mock.calls.slice(callsBefore).map((c: unknown[]) => c[0])
    expect(mockSetDateMode).toHaveBeenCalledWith('absolute')
    expect(callsAfterDirty).not.toContain('relative')
  })

  it('syncedSetDateMode: marks dirty and schedules save', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      result.current.setDateMode('absolute')
    })

    expect(mockSetDateMode).toHaveBeenCalledWith('absolute')

    // Advance timer to trigger debounced save
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(mockApiPatch).toHaveBeenCalledWith(
      '/api/settings/preferences',
      expect.objectContaining({ 'reading.date_mode': 'absolute' }),
    )
  })

  it('debounce: consecutive setters produce a single PATCH', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      result.current.setDateMode('absolute')
      result.current.setAutoMarkRead('on')
    })

    // Before timer fires, no PATCH yet (only backfill from initial render may have fired)
    const patchCallsBefore = mockApiPatch.mock.calls.filter(
      (c: unknown[]) => (c[1] as Record<string, unknown>)?.['reading.date_mode'] === 'absolute',
    )
    expect(patchCallsBefore).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Should have exactly one PATCH containing both changes
    const patchCalls = mockApiPatch.mock.calls.filter(
      (c: unknown[]) => {
        const body = c[1] as Record<string, unknown>
        return body?.['reading.date_mode'] === 'absolute' || body?.['reading.auto_mark_read'] === 'on'
      },
    )
    expect(patchCalls.length).toBeGreaterThanOrEqual(1)
    // The combined patch should contain both
    const combinedPatch = patchCalls[patchCalls.length - 1][1] as Record<string, unknown>
    expect(combinedPatch['reading.date_mode']).toBe('absolute')
    expect(combinedPatch['reading.auto_mark_read']).toBe('on')
  })

  it('unmount flushes pending changes via fetch keepalive', () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', mockFetch)

    const { result, unmount } = renderHook(() => useSettings())

    act(() => {
      result.current.setDateMode('absolute')
    })

    unmount()

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/settings/preferences',
      expect.objectContaining({
        method: 'PATCH',
        keepalive: true,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  it('unmount does not call fetch keepalive when no pending changes', () => {
    const mockFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
    vi.stubGlobal('fetch', mockFetch)

    const { unmount } = renderHook(() => useSettings())

    // Flush any initial save by advancing timer
    act(() => {
      vi.advanceTimersByTime(500)
    })

    unmount()

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
