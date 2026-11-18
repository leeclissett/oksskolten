import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMessageBubble } from './chat-message-bubble'
import type { ChatMessage } from '../../hooks/use-chat'

describe('ChatMessageBubble', () => {
  it('renders user message as plain text bubble', () => {
    const message: ChatMessage = { role: 'user', text: 'Hello there' }
    render(<ChatMessageBubble message={message} />)
    expect(screen.getByText('Hello there')).toBeTruthy()
    // User bubble has accent background
    const bubble = screen.getByText('Hello there').closest('div.max-w-\\[80\\%\\]')
    expect(bubble?.className).toContain('bg-accent')
  })

  it('renders assistant message as HTML', () => {
    const message: ChatMessage = { role: 'assistant', text: 'This is **bold**' }
    render(<ChatMessageBubble message={message} />)
    const prose = document.querySelector('.prose')!
    expect(prose.innerHTML).toContain('<strong>')
    expect(prose.innerHTML).toContain('bold')
  })

  it('renders streaming dots when text is empty and streaming', () => {
    const message: ChatMessage = { role: 'assistant', text: '' }
    render(<ChatMessageBubble message={message} streaming />)
    const dots = document.querySelectorAll('.animate-pulse')
    expect(dots.length).toBe(3)
  })

  it('renders nothing for empty assistant text when not streaming', () => {
    const message: ChatMessage = { role: 'assistant', text: '' }
    const { container } = render(<ChatMessageBubble message={message} />)
    expect(container.querySelector('.prose')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse').length).toBe(0)
  })

  it('renders usage info for assistant message', () => {
    const message: ChatMessage = {
      role: 'assistant',
      text: 'Response',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        elapsed_ms: 1500,
        model: 'claude-haiku-4-5-20251001',
      },
    }
    render(<ChatMessageBubble message={message} />)
    const usage = document.querySelector('.text-\\[11px\\]')!
    expect(usage.textContent).toContain('Haiku 4.5')
    expect(usage.textContent).toContain('1.5s')
    expect(usage.textContent).toContain('$')
  })

  it('does not render usage while streaming', () => {
    const message: ChatMessage = {
      role: 'assistant',
      text: 'Partial...',
      usage: { input_tokens: 100, output_tokens: 50, elapsed_ms: 1000, model: 'claude-haiku-4-5-20251001' },
    }
    render(<ChatMessageBubble message={message} streaming />)
    expect(document.querySelector('.text-\\[11px\\]')).toBeNull()
  })

  it('rewrites external links to app paths', () => {
    const message: ChatMessage = {
      role: 'assistant',
      text: 'Check [this](https://example.com/article)',
    }
    render(<ChatMessageBubble message={message} />)
    const link = document.querySelector('.prose a') as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toContain('/example.com/article')
  })
})
