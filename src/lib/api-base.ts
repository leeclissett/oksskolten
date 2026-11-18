import { getAuthToken, logoutClient } from './auth'

export class ApiError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message)
    this.status = status
    this.data = data
  }
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Handle 401 and non-ok responses consistently. Throws ApiError. */
export async function handleResponseError(res: Response, url: string): Promise<never> {
  if (res.status === 401 && !url.includes('/api/login')) {
    logoutClient()
    throw new ApiError('Unauthorized', 401, {})
  }
  const data = await res.json().catch(() => ({}))
  throw new ApiError(data.error || res.statusText, res.status, data)
}

/** Parse an SSE stream, calling onLine for each parsed JSON payload. */
export async function parseSSEStream<T>(
  res: Response,
  onLine: (payload: T) => void,
): Promise<void> {
  if (!res.body) throw new ApiError('Response body is null', 0, {})
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let payload: T
      try {
        payload = JSON.parse(line.slice(6)) as T
      } catch {
        // skip malformed JSON lines
        continue
      }
      onLine(payload)
    }
  }
}

export interface ChatSSEEvent {
  type: 'conversation_id' | 'text_delta' | 'thinking_start' | 'thinking_end' | 'tool_use_start' | 'tool_use_end' | 'done' | 'error'
  conversation_id?: string
  text?: string
  name?: string
  tool_use_id?: string
  usage?: { input_tokens: number; output_tokens: number }
  elapsed_ms?: number
  model?: string
  error?: string
}
