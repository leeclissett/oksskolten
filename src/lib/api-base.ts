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
