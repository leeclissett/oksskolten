import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHighlightTheme } from './use-highlight-theme'

describe('useHighlightTheme', () => {
  beforeEach(() => {
    const existing = document.getElementById('hljs-theme-link')
    if (existing) existing.remove()
  })

  it('loads the light stylesheet in light mode', () => {
    renderHook(() => useHighlightTheme(false))
    const link = document.getElementById('hljs-theme-link') as HTMLLinkElement
    expect(link).not.toBeNull()
    expect(link.href).toContain('/hljs-themes/github.min.css')
  })

  it('loads the dark stylesheet in dark mode', () => {
    renderHook(() => useHighlightTheme(true))
    const link = document.getElementById('hljs-theme-link') as HTMLLinkElement
    expect(link.href).toContain('/hljs-themes/github-dark.min.css')
  })

  it('reuses one link element when the mode changes', () => {
    const { rerender } = renderHook(({ dark }) => useHighlightTheme(dark), { initialProps: { dark: false } })
    rerender({ dark: true })
    expect(document.querySelectorAll('#hljs-theme-link')).toHaveLength(1)
    expect((document.getElementById('hljs-theme-link') as HTMLLinkElement).href).toContain('github-dark')
  })
})
