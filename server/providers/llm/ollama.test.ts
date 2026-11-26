import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({
  getSetting: vi.fn(),
}))

import { getSetting } from '../../db.js'

const mockGetSetting = vi.mocked(getSetting)

async function freshImport() {
  vi.resetModules()
  return import('./ollama.js')
}

function makeCreateMock(text: string, promptTokens: number, completionTokens: number) {
  return vi.fn().mockResolvedValue({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  })
}

function makeStreamMock(deltas: string[], promptTokens: number, completionTokens: number) {
  const chunks = deltas.map(d => ({
    choices: [{ delta: { content: d } }],
    usage: null,
  }))
  // Final chunk with usage
  chunks.push({
    choices: [{ delta: { content: '' } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } as any,
  })

  return vi.fn().mockResolvedValue({
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    },
  })
}

describe('ollamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting.mockReturnValue(null as any)
  })

  it('requireKey does not throw', async () => {
    const { ollamaProvider } = await freshImport()
    expect(() => ollamaProvider.requireKey()).not.toThrow()
  })
})

describe('getOllamaClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses default base URL when setting is absent', async () => {
    mockGetSetting.mockReturnValue(null as any)
    const { getOllamaClient } = await freshImport()
    const client = getOllamaClient()
    expect((client as any).baseURL).toBe('http://localhost:11434/v1')
  })

  it('uses configured base URL from settings', async () => {
    mockGetSetting.mockReturnValue('http://myserver:11434')
    const { getOllamaClient } = await freshImport()
    const client = getOllamaClient()
    expect((client as any).baseURL).toBe('http://myserver:11434/v1')
  })

  it('caches client when base URL has not changed', async () => {
    mockGetSetting.mockReturnValue('http://myserver:11434')
    const { getOllamaClient } = await freshImport()
    const client1 = getOllamaClient()
    const client2 = getOllamaClient()
    expect(client1).toBe(client2)
  })

  it('recreates client when custom headers change', async () => {
    let callCount = 0
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'ollama.base_url') return undefined
      if (key === 'ollama.custom_headers') return callCount === 0 ? '' : '{"X-Auth":"token"}'
      return undefined
    })
    const { getOllamaClient } = await freshImport()
    const client1 = getOllamaClient()
    callCount = 1
    const client2 = getOllamaClient()
    expect(client1).not.toBe(client2)
  })
})

describe('getOllamaCustomHeaders', () => {
  it('returns empty object when no headers configured', async () => {
    mockGetSetting.mockReturnValue(null as any)
    const { getOllamaCustomHeaders } = await freshImport()
    expect(getOllamaCustomHeaders()).toEqual({})
  })

  it('parses JSON headers from settings', async () => {
    mockGetSetting.mockReturnValue('{"CF-Access-Client-Id":"abc","CF-Access-Client-Secret":"xyz"}')
    const { getOllamaCustomHeaders } = await freshImport()
    expect(getOllamaCustomHeaders()).toEqual({
      'CF-Access-Client-Id': 'abc',
      'CF-Access-Client-Secret': 'xyz',
    })
  })

  it('returns empty object on invalid JSON', async () => {
    mockGetSetting.mockReturnValue('not json')
    const { getOllamaCustomHeaders } = await freshImport()
    expect(getOllamaCustomHeaders()).toEqual({})
  })
})

describe('ollamaProvider.createMessage', () => {
  it('returns text and token counts', async () => {
    mockGetSetting.mockReturnValue(null as any)
    const { ollamaProvider, getOllamaClient } = await freshImport()

    const mockCreate = makeCreateMock('Hello from Ollama', 10, 5)
    const client = getOllamaClient()
    ;(client.chat as any) = { completions: { create: mockCreate } }

    const result = await ollamaProvider.createMessage({
      model: 'llama3.2:latest',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result.text).toBe('Hello from Ollama')
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(5)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'llama3.2:latest',
        max_completion_tokens: 1024,
      }),
    )
  })

  it('records zero tokens when usage is missing', async () => {
    mockGetSetting.mockReturnValue(null as any)
    const { ollamaProvider, getOllamaClient } = await freshImport()

    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'response' } }],
      usage: null,
    })
    const client = getOllamaClient()
    ;(client.chat as any) = { completions: { create: mockCreate } }

    const result = await ollamaProvider.createMessage({
      model: 'llama3.2:latest',
      maxTokens: 1024,
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(result.inputTokens).toBe(0)
    expect(result.outputTokens).toBe(0)
  })
})

describe('ollamaProvider.streamMessage', () => {
  it('accumulates streamed deltas and returns full text', async () => {
    mockGetSetting.mockReturnValue(null as any)
    const { ollamaProvider, getOllamaClient } = await freshImport()

    const mockCreate = makeStreamMock(['Hello', ' from', ' Ollama'], 15, 8)
    const client = getOllamaClient()
    ;(client.chat as any) = { completions: { create: mockCreate } }

    const deltas: string[] = []
    const result = await ollamaProvider.streamMessage(
      {
        model: 'llama3.2:latest',
        maxTokens: 1024,
        messages: [{ role: 'user', content: 'Hi' }],
      },
      (delta) => deltas.push(delta),
    )

    expect(result.text).toBe('Hello from Ollama')
    expect(deltas).toEqual(['Hello', ' from', ' Ollama'])
    expect(result.inputTokens).toBe(15)
    expect(result.outputTokens).toBe(8)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
    )
  })
})
