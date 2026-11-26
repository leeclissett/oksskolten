import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HintBanner } from './hint-banner'

describe('HintBanner', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders children when not dismissed', () => {
    render(<HintBanner storageKey="test-hint">Helpful tip</HintBanner>)
    expect(screen.getByText('Helpful tip')).toBeTruthy()
  })

  it('renders nothing when previously dismissed', () => {
    localStorage.setItem('test-hint', '1')
    const { container } = render(<HintBanner storageKey="test-hint">Helpful tip</HintBanner>)
    expect(container.textContent).toBe('')
  })

  it('dismisses on close button click and persists to localStorage', async () => {
    render(<HintBanner storageKey="test-hint">Helpful tip</HintBanner>)
    await userEvent.click(screen.getByLabelText('Close'))
    expect(screen.queryByText('Helpful tip')).toBeNull()
    expect(localStorage.getItem('test-hint')).toBe('1')
  })

  it('uses different storage keys independently', () => {
    localStorage.setItem('hint-a', '1')
    const { container: c1 } = render(<HintBanner storageKey="hint-a">A</HintBanner>)
    expect(c1.textContent).toBe('')
    cleanup()

    const { container: c2 } = render(<HintBanner storageKey="hint-b">B</HintBanner>)
    expect(c2.textContent).toContain('B')
  })
})
