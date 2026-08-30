import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertSafeUrl, safeFetch } from './ssrf.js'

// Mock dns lookup
const mockLookup = vi.fn()
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => mockLookup(...args) }))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  vi.clearAllMocks()
  mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 })
})

// ---------------------------------------------------------------------------
// assertSafeUrl
// ---------------------------------------------------------------------------
describe('assertSafeUrl', () => {
  describe('protocol checks', () => {
    it('allows http', async () => {
      await expect(assertSafeUrl('http://example.com')).resolves.toBeUndefined()
    })

    it('allows https', async () => {
      await expect(assertSafeUrl('https://example.com')).resolves.toBeUndefined()
    })

    it('blocks ftp', async () => {
      await expect(assertSafeUrl('ftp://example.com')).rejects.toThrow('disallowed protocol')
    })

    it('blocks file', async () => {
      await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow('disallowed protocol')
    })
  })

  describe('hostname checks', () => {
    it('blocks localhost', async () => {
      await expect(assertSafeUrl('http://localhost')).rejects.toThrow('private hostname')
    })

    it('blocks .local suffix', async () => {
      await expect(assertSafeUrl('http://myhost.local')).rejects.toThrow('private hostname')
    })

    it('blocks .internal suffix', async () => {
      await expect(assertSafeUrl('http://service.internal')).rejects.toThrow('private hostname')
    })
  })

  describe('IP literal checks', () => {
    it.each([
      ['http://127.0.0.1', '127.0.0.1'],
      ['http://10.0.0.1', '10.0.0.1'],
      ['http://172.16.0.1', '172.16.0.1'],
      ['http://172.31.255.255', '172.31.255.255'],
      ['http://192.168.1.1', '192.168.1.1'],
      ['http://169.254.0.1', '169.254.0.1'],
      ['http://0.0.0.0', '0.0.0.0'],
    ])('blocks private IPv4 %s', async (url) => {
      await expect(assertSafeUrl(url)).rejects.toThrow('private IP')
    })

    it('blocks IPv6 loopback [::1]', async () => {
      await expect(assertSafeUrl('http://[::1]')).rejects.toThrow('private IP')
    })

    it('blocks IPv6 fc00::', async () => {
      await expect(assertSafeUrl('http://[fc00::1]')).rejects.toThrow('private IP')
    })

    it('blocks IPv6 fe80:: link-local', async () => {
      await expect(assertSafeUrl('http://[fe80::1]')).rejects.toThrow('private IP')
    })

    it('allows public IPv4', async () => {
      await expect(assertSafeUrl('http://93.184.216.34')).resolves.toBeUndefined()
    })

    it('does not call DNS for IP literals', async () => {
      await assertSafeUrl('http://93.184.216.34')
      expect(mockLookup).not.toHaveBeenCalled()
    })
  })

  describe('DNS resolution checks', () => {
    it('blocks hostname resolving to private IP', async () => {
      mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 })
      await expect(assertSafeUrl('http://evil.com')).rejects.toThrow(
        'resolves to private IP',
      )
    })

    it('allows hostname resolving to public IP', async () => {
      mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 })
      await expect(assertSafeUrl('http://example.com')).resolves.toBeUndefined()
    })

    it('tolerates DNS failure (lets fetch handle it)', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND'))
      await expect(assertSafeUrl('http://nonexistent.example')).resolves.toBeUndefined()
    })
  })

  describe('edge: 172.x boundary', () => {
    it('allows 172.15.x.x (not private)', async () => {
      await expect(assertSafeUrl('http://172.15.0.1')).resolves.toBeUndefined()
    })

    it('blocks 172.16.0.1', async () => {
      await expect(assertSafeUrl('http://172.16.0.1')).rejects.toThrow('private IP')
    })

    it('allows 172.32.0.1 (not private)', async () => {
      await expect(assertSafeUrl('http://172.32.0.1')).resolves.toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------
describe('safeFetch', () => {
  it('fetches a safe URL', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))
    const res = await safeFetch('http://example.com')
    expect(res.status).toBe(200)
  })

  it('rejects private URL without calling fetch', async () => {
    await expect(safeFetch('http://127.0.0.1')).rejects.toThrow('private IP')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetches an explicitly allowed private-network URL', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))

    const res = await safeFetch(
      'http://192.168.1.109:3100/api/feeds/supra-insider',
      undefined,
      { allowPrivateNetwork: true },
    )

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it.each(['http://127.0.0.1', 'http://169.254.169.254/latest/meta-data'])(
    'does not allow sensitive local target %s through the private-network exception',
    async (url) => {
      await expect(safeFetch(url, undefined, { allowPrivateNetwork: true })).rejects.toThrow('private IP')
      expect(mockFetch).not.toHaveBeenCalled()
    },
  )

  it('follows safe redirects', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://example.com/page' } }),
      )
      .mockResolvedValueOnce(new Response('final', { status: 200 }))

    const res = await safeFetch('http://example.com')
    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('blocks redirect to private IP', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/admin' } }),
    )
    await expect(safeFetch('http://example.com')).rejects.toThrow('private IP')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('blocks redirect to private hostname', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } }),
    )
    await expect(safeFetch('http://example.com')).rejects.toThrow('private hostname')
  })

  it('does not allow a public URL to redirect into the private network when opt-in is set', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://192.168.1.109/feed' } }),
    )

    await expect(
      safeFetch('http://example.com', undefined, { allowPrivateNetwork: true }),
    ).rejects.toThrow('private IP')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('blocks redirects from an allowed private host to a different private host', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://192.168.1.110/feed' } }),
    )

    await expect(
      safeFetch('http://192.168.1.109/feed', undefined, { allowPrivateNetwork: true }),
    ).rejects.toThrow('private IP')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('follows redirects on the same explicitly allowed private host', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/canonical-feed' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const res = await safeFetch(
      'http://192.168.1.109/feed',
      undefined,
      { allowPrivateNetwork: true },
    )

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws on redirect without Location header', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302 }))
    await expect(safeFetch('http://example.com')).rejects.toThrow('Redirect without Location')
  })

  it('throws after too many redirects', async () => {
    mockFetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://example.com/loop' } }),
    )
    await expect(safeFetch('http://example.com')).rejects.toThrow('Too many redirects')
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })

  it('passes init options through to fetch', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))
    const signal = AbortSignal.timeout(5000)
    await safeFetch('http://example.com', { headers: { 'X-Test': '1' }, signal })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com',
      expect.objectContaining({ headers: { 'X-Test': '1' }, signal, redirect: 'manual' }),
    )
  })

  it('passes through 304 Not Modified without treating it as a redirect', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 304 }))
    const res = await safeFetch('http://example.com')
    expect(res.status).toBe(304)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('passes through 300 Multiple Choices without treating it as a redirect', async () => {
    mockFetch.mockResolvedValueOnce(new Response('choices', { status: 300 }))
    const res = await safeFetch('http://example.com')
    expect(res.status).toBe(300)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('validates each hop in a redirect chain', async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://hop2.com' } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://hop3.com' } }),
      )
      .mockResolvedValueOnce(new Response('done', { status: 200 }))

    const res = await safeFetch('http://hop1.com')
    expect(res.status).toBe(200)
    expect(mockLookup).toHaveBeenCalledTimes(3) // hop1, hop2, hop3
  })
})
