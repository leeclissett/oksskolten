import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'node:child_process'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

import { claudeCodeProvider } from './claude-code.js'

/** Minimal mock that uses plain EventEmitters so data events fire synchronously. */
function createMockProcess() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = new EventEmitter() as ChildProcess & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdin = { write: vi.fn(), end: vi.fn() } as any
  proc.stdout = stdout as any
  proc.stderr = stderr as any
  proc.kill = vi.fn() as any
  return proc
}

function pushLine(proc: ReturnType<typeof createMockProcess>, obj: unknown) {
  proc.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
}

function pushRaw(proc: ReturnType<typeof createMockProcess>, text: string) {
  proc.stdout.emit('data', Buffer.from(text))
}

function pushStderr(proc: ReturnType<typeof createMockProcess>, text: string) {
  proc.stderr.emit('data', Buffer.from(text))
}

function closeProc(proc: ReturnType<typeof createMockProcess>, code: number | null = 0) {
  proc.emit('close', code)
}

const defaultParams = {
  model: 'test-model',
  maxTokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

// --- requireKey ---

describe('claudeCodeProvider.requireKey', () => {
  it('does not throw (CLI auth)', () => {
    expect(() => claudeCodeProvider.requireKey()).not.toThrow()
  })
})

// --- createMessage ---

describe('claudeCodeProvider.createMessage', () => {
  it('resolves with text from content_block_delta events', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)

    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi ' } })
    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } })
    pushLine(proc, { type: 'message_delta', usage: { input_tokens: 10, output_tokens: 5 } })
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('Hi there')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
  })

  it('rejects on non-zero exit code', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    closeProc(proc, 1)

    await expect(promise).rejects.toThrow('claude process exited with code 1')
  })

  it('includes stderr in error message', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    pushStderr(proc, 'some error')
    closeProc(proc, 1)

    await expect(promise).rejects.toThrow('some error')
  })

  it('rejects on spawn error', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    proc.emit('error', new Error('spawn ENOENT'))

    await expect(promise).rejects.toThrow('spawn ENOENT')
  })

  it('handles result event with text', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    pushLine(proc, { type: 'result', result: 'Final answer', usage: { input_tokens: 20, output_tokens: 10 } })
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('Final answer')
    expect(result.inputTokens).toBe(20)
    expect(result.outputTokens).toBe(10)
  })

  it('handles assistant event with incremental text', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    pushLine(proc, { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } })
    pushLine(proc, { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] } })
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('Hello world')
  })

  it('handles stream_event wrapper', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    pushLine(proc, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'nested' } },
    })
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('nested')
  })

  it('ignores malformed JSON lines', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    pushRaw(proc, 'not valid json\n')
    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('ok')
  })

  it('passes correct arguments to spawn', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    claudeCodeProvider.createMessage({ ...defaultParams, model: 'my-model' })

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--model', 'my-model', '--output-format', 'stream-json']),
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    )

    closeProc(proc, 0)
  })

  it('ignores system, message_start, message_stop events', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    pushLine(proc, { type: 'system' })
    pushLine(proc, { type: 'message_start' })
    pushLine(proc, { type: 'message_stop' })
    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('ok')
  })

  it('processes remaining buffer on close', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)
    // Push data without trailing newline (stays in buffer until close)
    pushRaw(proc, JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'tail' } }))
    closeProc(proc, 0)

    const result = await promise
    expect(result.text).toBe('tail')
  })

  it('concatenates multiple messages into prompt', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    claudeCodeProvider.createMessage({
      model: 'test-model',
      maxTokens: 1024,
      messages: [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
      ],
    })

    expect(proc.stdin.write).toHaveBeenCalledWith('First\n\nSecond')
    expect(proc.stdin.end).toHaveBeenCalled()

    closeProc(proc, 0)
  })
})

// --- streamMessage ---

describe('claudeCodeProvider.streamMessage', () => {
  it('calls onText callback for each text delta', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const onText = vi.fn()
    const promise = claudeCodeProvider.streamMessage(defaultParams, onText)

    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk1' } })
    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'chunk2' } })
    closeProc(proc, 0)

    await promise
    expect(onText).toHaveBeenCalledWith('chunk1')
    expect(onText).toHaveBeenCalledWith('chunk2')
  })
})

// --- timeout ---

describe('timeout handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects after 90 seconds of inactivity', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)

    vi.advanceTimersByTime(90_000)

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')

    // Simulate process close after kill
    closeProc(proc, null as unknown as number)

    await expect(promise).rejects.toThrow('timed out')
  })

  it('resets timeout on stdout data', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)

    // Advance 80 seconds (not yet timed out)
    vi.advanceTimersByTime(80_000)
    expect(proc.kill).not.toHaveBeenCalled()

    // Send data — resets the 90s timer
    pushLine(proc, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } })

    // Advance another 80 seconds (total 160s, but timer was reset at 80s)
    vi.advanceTimersByTime(80_000)
    expect(proc.kill).not.toHaveBeenCalled()

    closeProc(proc, 0)
    const result = await promise
    expect(result.text).toBe('hi')
  })

  it('resets timeout on stderr data', async () => {
    const proc = createMockProcess()
    mockSpawn.mockReturnValue(proc)

    const promise = claudeCodeProvider.createMessage(defaultParams)

    vi.advanceTimersByTime(80_000)
    pushStderr(proc, 'debug info')
    vi.advanceTimersByTime(80_000)

    expect(proc.kill).not.toHaveBeenCalled()

    closeProc(proc, 0)
    await promise
  })
})
