import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth module
vi.mock('./auth', () => ({
  getAuthToken: vi.fn(() => 'test-token'),
  logoutClient: vi.fn(),
}))

import { getAuthToken, logoutClient } from './auth'
import { authHeaders, fetcher, apiPost, apiPatch, apiDelete, streamPost, streamPostChat, ApiError } from './fetcher'

function mockFetchResponse(body: unknown, opts: { status?: number; ok?: boolean; statusText?: string; headers?: Record<string, string> } = {}) {
  const { status = 200, ok = true, statusText = 'OK', headers = { 'Content-Type': 'application/json' } } = opts
  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
    body: null,
  })
}

function mockSSEResponse(lines: string[], opts: { status?: number; ok?: boolean } = {}) {
  const { status = 200, ok = true } = opts
  const encoder = new TextEncoder()
  const chunks = [encoder.encode(lines.join('\n') + '\n')]
  let readIndex = 0

  return vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'OK',
    headers: new Headers({ 'Content-Type': 'text/event-stream' }),
    json: () => Promise.reject(new Error('not JSON')),
    body: {
      getReader: () => ({
        read: () => {
          if (readIndex < chunks.length) {
            return Promise.resolve({ done: false, value: chunks[readIndex++] })
          }
          return Promise.resolve({ done: true, value: undefined })
        },
      }),
    },
  })
}

describe('fetcher module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthToken).mockReturnValue('test-token')
  })

  describe('authHeaders', () => {
    it('returns Authorization header when token exists', () => {
      expect(authHeaders()).toEqual({ Authorization: 'Bearer test-token' })
    })

    it('returns empty object when no token', () => {
      vi.mocked(getAuthToken).mockReturnValue(null)
      expect(authHeaders()).toEqual({})
    })
  })

  describe('ApiError', () => {
    it('has status and data properties', () => {
      const err = new ApiError('Not Found', 404, { error: 'not found' })
      expect(err.message).toBe('Not Found')
      expect(err.status).toBe(404)
      expect(err.data).toEqual({ error: 'not found' })
      expect(err).toBeInstanceOf(Error)
    })
  })

  describe('fetcher', () => {
    it('fetches JSON with auth headers', async () => {
      const data = { items: [1, 2] }
      vi.stubGlobal('fetch', mockFetchResponse(data))
      const result = await fetcher('/api/test')
      expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }))
      expect(result).toEqual(data)
    })

    it('calls logoutClient on 401', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({}, { status: 401, ok: false }))
      await expect(fetcher('/api/test')).rejects.toThrow('Unauthorized')
      expect(logoutClient).toHaveBeenCalled()
    })

    it('throws on non-ok response', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({}, { status: 500, ok: false, statusText: 'Server Error' }))
      await expect(fetcher('/api/test')).rejects.toThrow('Server Error')
    })
  })

  describe('apiPost', () => {
    it('sends POST with JSON body', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ ok: true }))
      await apiPost('/api/items', { name: 'test' })
      expect(fetch).toHaveBeenCalledWith('/api/items', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({ name: 'test' }),
      }))
    })

    it('sends empty body when no body provided', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ ok: true }))
      await apiPost('/api/items')
      expect(fetch).toHaveBeenCalledWith('/api/items', expect.objectContaining({ body: '{}' }))
    })

    it('returns undefined for 204 responses', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.reject(new Error('no body')),
      }))
      const result = await apiPost('/api/items')
      expect(result).toBeUndefined()
    })

    it('throws ApiError on non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable',
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'validation failed' }),
      }))
      await expect(apiPost('/api/items')).rejects.toThrow(ApiError)
    })

    it('calls logoutClient on 401 for non-login URLs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: () => Promise.resolve({}),
      }))
      await expect(apiPost('/api/items')).rejects.toThrow('Unauthorized')
      expect(logoutClient).toHaveBeenCalled()
    })

    it('does not call logoutClient on 401 for /api/login', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'bad password' }),
      }))
      await expect(apiPost('/api/login')).rejects.toThrow(ApiError)
      expect(logoutClient).not.toHaveBeenCalled()
    })
  })

  describe('apiPatch', () => {
    it('sends PATCH request', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ updated: true }))
      await apiPatch('/api/items/1', { name: 'new' })
      expect(fetch).toHaveBeenCalledWith('/api/items/1', expect.objectContaining({ method: 'PATCH' }))
    })
  })

  describe('apiDelete', () => {
    it('sends DELETE request', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ deleted: true }))
      await apiDelete('/api/items/1')
      expect(fetch).toHaveBeenCalledWith('/api/items/1', expect.objectContaining({ method: 'DELETE' }))
    })
  })

  describe('streamPost', () => {
    it('handles cached (non-SSE) JSON response', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({ text: 'cached summary' }))
      const onDelta = vi.fn()
      const result = await streamPost('/api/summarize', onDelta)
      expect(onDelta).toHaveBeenCalledWith('cached summary')
      expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 0 })
    })

    it('handles SSE streaming with delta events', async () => {
      vi.stubGlobal('fetch', mockSSEResponse([
        'data: {"type":"delta","text":"Hello "}',
        'data: {"type":"delta","text":"world"}',
        'data: {"type":"done","usage":{"input_tokens":10,"output_tokens":5}}',
      ]))
      const onDelta = vi.fn()
      const result = await streamPost('/api/summarize', onDelta)
      expect(onDelta).toHaveBeenCalledTimes(2)
      expect(onDelta).toHaveBeenCalledWith('Hello ')
      expect(onDelta).toHaveBeenCalledWith('world')
      expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 })
    })

    it('throws on SSE error event', async () => {
      vi.stubGlobal('fetch', mockSSEResponse([
        'data: {"type":"error","error":"rate limited"}',
      ]))
      await expect(streamPost('/api/summarize', vi.fn())).rejects.toThrow('rate limited')
    })

    it('skips malformed JSON lines', async () => {
      vi.stubGlobal('fetch', mockSSEResponse([
        'data: not-json',
        'data: {"type":"delta","text":"ok"}',
        'data: {"type":"done","usage":{"input_tokens":0,"output_tokens":0}}',
      ]))
      const onDelta = vi.fn()
      await streamPost('/api/summarize', onDelta)
      expect(onDelta).toHaveBeenCalledTimes(1)
      expect(onDelta).toHaveBeenCalledWith('ok')
    })

    it('calls logoutClient on 401', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({}, { status: 401, ok: false }))
      await expect(streamPost('/api/summarize', vi.fn())).rejects.toThrow('Unauthorized')
      expect(logoutClient).toHaveBeenCalled()
    })

    it('throws when response body is null', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        body: null,
      }))
      await expect(streamPost('/api/summarize', vi.fn())).rejects.toThrow('Response body is null')
    })
  })

  describe('streamPostChat', () => {
    it('sends body and processes SSE events', async () => {
      vi.stubGlobal('fetch', mockSSEResponse([
        'data: {"type":"conversation_id","conversation_id":"conv-1"}',
        'data: {"type":"text_delta","text":"Hi"}',
        'data: {"type":"done"}',
      ]))
      const onEvent = vi.fn()
      await streamPostChat('/api/chat', { message: 'hello' }, onEvent)

      expect(fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
      }))
      expect(onEvent).toHaveBeenCalledTimes(3)
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'conversation_id', conversation_id: 'conv-1' }))
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'text_delta', text: 'Hi' }))
    })

    it('skips malformed SSE lines', async () => {
      vi.stubGlobal('fetch', mockSSEResponse([
        'data: {invalid',
        'data: {"type":"text_delta","text":"ok"}',
      ]))
      const onEvent = vi.fn()
      await streamPostChat('/api/chat', { message: 'test' }, onEvent)
      expect(onEvent).toHaveBeenCalledTimes(1)
    })

    it('calls logoutClient on 401', async () => {
      vi.stubGlobal('fetch', mockFetchResponse({}, { status: 401, ok: false }))
      await expect(streamPostChat('/api/chat', { message: 'test' }, vi.fn())).rejects.toThrow('Unauthorized')
      expect(logoutClient).toHaveBeenCalled()
    })
  })
})
