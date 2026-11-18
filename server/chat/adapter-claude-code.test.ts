import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChatSSEEvent } from './adapter.js'

class MockStream extends EventEmitter {
  emitData(text: string) {
    this.emit('data', Buffer.from(text))
  }
}

class MockProcess extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() }
  stdout = new MockStream()
  stderr = new MockStream()
  kill = vi.fn()
}

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

const { runClaudeCodeTurn } = await import('./adapter-claude-code.js')

describe('runClaudeCodeTurn (Claude Code)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns claude with verbose stream-json and local tsx CLI', async () => {
    const proc = new MockProcess()
    spawnMock.mockReturnValueOnce(proc)

    const events: ChatSSEEvent[] = []
    const promise = runClaudeCodeTurn({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      system: 'test system',
      model: 'claude-haiku-4-5-20251001',
      onEvent: (event) => events.push(event),
    })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args] = spawnMock.mock.calls[0]
    expect(command).toBe('claude')
    expect(args).toContain('--verbose')
    expect(args).toContain('--output-format')
    expect(args).toContain('stream-json')

    const configIndex = args.indexOf('--mcp-config')
    expect(configIndex).toBeGreaterThan(-1)
    const mcpConfig = JSON.parse(args[configIndex + 1])
    expect(mcpConfig.mcpServers['oksskolten'].command).toBe(process.execPath)
    expect(mcpConfig.mcpServers['oksskolten'].args[0]).toContain('node_modules/tsx/dist/cli.mjs')
    expect(mcpConfig.mcpServers['oksskolten'].args[1]).toContain('server/chat/mcp-server.ts')

    proc.stdout.emitData('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n')
    proc.stdout.emitData('{"type":"result","usage":{"input_tokens":10,"output_tokens":5}}\n')
    proc.emit('close', 0)

    const result = await promise
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
    expect(events).toContainEqual({ type: 'text_delta', text: 'Hello' })
    expect(events).toContainEqual({ type: 'done', usage: { input_tokens: 10, output_tokens: 5 } })
  })

  it('kills the process and rejects on timeout', async () => {
    vi.useFakeTimers()
    const proc = new MockProcess()
    spawnMock.mockReturnValueOnce(proc)

    const promise = runClaudeCodeTurn({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      system: 'test system',
      model: 'claude-haiku-4-5-20251001',
      onEvent: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(90_000)
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')

    proc.emit('close', null)
    await expect(promise).rejects.toThrow('Claude Code timed out after 90s')
  })
})
