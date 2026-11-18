import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockGetSetting, mockUpsertSetting, mockFetch } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
  mockUpsertSetting: vi.fn(),
  mockFetch: vi.fn(),
}))

vi.mock('../../db.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  upsertSetting: (...args: unknown[]) => mockUpsertSetting(...args),
}))

// Mock global fetch
vi.stubGlobal('fetch', mockFetch)

import { requireGoogleTranslateKey, googleTranslate, getMonthlyUsage } from './google-translate.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTranslateResponse(translatedText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: { translations: [{ translatedText }] },
    }),
  })
}

function setupApiKey() {
  mockGetSetting.mockImplementation((key: string) => {
    if (key === 'api_key.google_translate') return 'test-key'
    return undefined
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// requireGoogleTranslateKey
// ---------------------------------------------------------------------------

describe('requireGoogleTranslateKey', () => {
  it('returns the key when set', () => {
    mockGetSetting.mockReturnValue('test-key')
    expect(requireGoogleTranslateKey()).toBe('test-key')
  })

  it('throws with code GOOGLE_TRANSLATE_KEY_NOT_SET when not set', () => {
    mockGetSetting.mockReturnValue(undefined)
    try {
      requireGoogleTranslateKey()
      expect.unreachable('should have thrown')
    } catch (err: any) {
      expect(err.code).toBe('GOOGLE_TRANSLATE_KEY_NOT_SET')
    }
  })
})

// ---------------------------------------------------------------------------
// googleTranslate — v2 pipeline (marked → translate HTML → Turndown)
// ---------------------------------------------------------------------------

describe('googleTranslate', () => {
  it('translates plain text', async () => {
    setupApiKey()
    mockTranslateResponse('<p>こんにちは世界</p>')

    const result = await googleTranslate('Hello world', 'ja')

    expect(result.translatedText).toBe('こんにちは世界')
    expect(result.characters).toBeGreaterThan(0)
    expect(mockFetch).toHaveBeenCalledOnce()

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).not.toContain('key=')
    expect(opts.headers['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse(opts.body)
    expect(body.target).toBe('ja')
    expect(body.format).toBe('html')
  })

  it('preserves inline code through translation', async () => {
    setupApiKey()
    // marked converts `console.log` to <code>console.log</code> inside <p>
    // API preserves the <code> tag, Turndown converts back to backticks
    mockTranslateResponse('<p>デバッグには <code>console.log</code> を使う</p>')

    const result = await googleTranslate('Use `console.log` to debug', 'ja')
    expect(result.translatedText).toBe('デバッグには `console.log` を使う')
  })

  it('preserves links through translation', async () => {
    setupApiKey()
    mockTranslateResponse('<p>詳細は <a href="https://example.com">ドキュメント</a> を参照</p>')

    const result = await googleTranslate('Visit [the docs](https://example.com) for details', 'ja')
    expect(result.translatedText).toBe('詳細は [ドキュメント](https://example.com) を参照')
  })

  it('preserves bold/italic through translation', async () => {
    setupApiKey()
    mockTranslateResponse('<p>これは<strong>重要</strong>で<em>強調</em>されている</p>')

    const result = await googleTranslate('This is **important** and *emphasized*', 'ja')
    expect(result.translatedText).toBe('これは**重要**で_強調_されている')
  })

  it('throws on API error', async () => {
    setupApiKey()
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    })

    await expect(googleTranslate('test', 'ja')).rejects.toThrow('Google Translate API error: 403')
  })

  it('splits long text into chunks', async () => {
    setupApiKey()

    const para1 = 'A'.repeat(20_000)
    const para2 = 'B'.repeat(20_000)
    const input = `${para1}\n\n${para2}`

    mockTranslateResponse('<p>翻訳1</p>')
    mockTranslateResponse('<p>翻訳2</p>')

    const result = await googleTranslate(input, 'ja')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result.translatedText).toContain('翻訳1')
    expect(result.translatedText).toContain('翻訳2')
  })
})

// ---------------------------------------------------------------------------
// getMonthlyUsage
// ---------------------------------------------------------------------------

describe('getMonthlyUsage', () => {
  it('returns zero when no usage recorded', () => {
    mockGetSetting.mockReturnValue(undefined)
    const usage = getMonthlyUsage()
    expect(usage.monthlyChars).toBe(0)
    expect(usage.freeTierRemaining).toBe(500_000)
  })

  it('returns stored usage for current month', () => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'google_translate.usage_month') return currentMonth
      if (key === 'google_translate.usage_chars') return '100000'
      return undefined
    })

    const usage = getMonthlyUsage()
    expect(usage.monthlyChars).toBe(100_000)
    expect(usage.freeTierRemaining).toBe(400_000)
  })

  it('returns zero for a different month (usage reset)', () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'google_translate.usage_month') return '2020-01'
      if (key === 'google_translate.usage_chars') return '999999'
      return undefined
    })

    const usage = getMonthlyUsage()
    expect(usage.monthlyChars).toBe(0)
    expect(usage.freeTierRemaining).toBe(500_000)
  })

  it('clamps freeTierRemaining to zero when exceeded', () => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'google_translate.usage_month') return currentMonth
      if (key === 'google_translate.usage_chars') return '600000'
      return undefined
    })

    const usage = getMonthlyUsage()
    expect(usage.monthlyChars).toBe(600_000)
    expect(usage.freeTierRemaining).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Monthly usage tracking (via googleTranslate calls)
// ---------------------------------------------------------------------------

describe('monthly usage tracking', () => {
  it('accumulates usage within the same month', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'api_key.google_translate') return 'test-key'
      if (key === 'google_translate.usage_month') return currentMonth
      if (key === 'google_translate.usage_chars') return '1000'
      return undefined
    })
    mockTranslateResponse('<p>翻訳済み</p>')

    const result = await googleTranslate('Hello', 'ja')

    // Should accumulate: 1000 existing + chars from current call
    expect(result.monthlyChars).toBeGreaterThan(1000)
    expect(mockUpsertSetting).toHaveBeenCalledWith('google_translate.usage_chars', expect.any(String))
  })

  it('resets usage when month changes', async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'api_key.google_translate') return 'test-key'
      if (key === 'google_translate.usage_month') return '2020-01'
      if (key === 'google_translate.usage_chars') return '999999'
      return undefined
    })
    mockTranslateResponse('<p>翻訳済み</p>')

    const result = await googleTranslate('Hi', 'ja')

    // Should reset: only chars from current call
    expect(result.monthlyChars).toBeLessThan(100)
    expect(mockUpsertSetting).toHaveBeenCalledWith('google_translate.usage_month', expect.stringMatching(/^\d{4}-\d{2}$/))
  })
})
