import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDarkMode } from './use-dark-mode'

describe('useDarkMode', () => {
  let matchMediaListeners: Array<() => void>
  let matchMediaMatches: boolean

  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''

    matchMediaListeners = []
    matchMediaMatches = false

    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      get matches() { return matchMediaMatches },
      media: query,
      addEventListener: (_: string, cb: () => void) => {
        matchMediaListeners.push(cb)
      },
      removeEventListener: (_: string, cb: () => void) => {
        matchMediaListeners = matchMediaListeners.filter(l => l !== cb)
      },
    })))
  })

  it('is light when the device is light', () => {
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('is dark when the device is dark', () => {
    matchMediaMatches = true
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('ignores a colour mode stored by earlier versions', () => {
    localStorage.setItem('theme', 'dark')
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)
  })

  it('follows the device when it changes', () => {
    const { result } = renderHook(() => useDarkMode())
    expect(result.current.isDark).toBe(false)

    act(() => {
      matchMediaMatches = true
      matchMediaListeners.forEach(cb => cb())
    })

    expect(result.current.isDark).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
