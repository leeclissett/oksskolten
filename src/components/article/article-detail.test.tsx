import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { LocaleContext } from '../../lib/i18n'
import { TooltipProvider } from '../ui/tooltip'
import { KeyboardNavigationProvider } from '../../contexts/keyboard-navigation-context'

const { mockApiPatch, mockApiPost, mockTrackRead, mockQueueSeenIds } = vi.hoisted(() => ({
  mockApiPatch: vi.fn(),
  mockApiPost: vi.fn(() => Promise.resolve()),
  mockTrackRead: vi.fn(),
  mockQueueSeenIds: vi.fn((_ids: number[]) => Promise.resolve()),
}))

vi.mock('../../lib/fetcher', async () => {
  const actual = await vi.importActual<typeof import('../../lib/fetcher')>('../../lib/fetcher')
  return {
    ...actual,
    apiPatch: mockApiPatch,
    apiPost: mockApiPost,
  }
})

vi.mock('../../lib/readTracker', () => ({
  trackRead: (...args: unknown[]) => mockTrackRead(...args),
}))

vi.mock('../../lib/offlineQueue', () => ({
  queueSeenIds: (ids: number[]) => mockQueueSeenIds(ids),
}))

vi.mock('../../hooks/use-rewrite-internal-links', () => ({
  useRewriteInternalLinks: (html: string) => ({ rewrittenHtml: html }),
}))

vi.mock('../ui/ImageLightbox', () => ({
  ImageLightbox: () => null,
}))

import { ArticleDetail } from './article-detail'

const mockSettings = {
  internalLinks: 'on' as const,
  colorMode: 'system' as const,
  setColorMode: vi.fn(),
  themeName: 'default',
  setTheme: vi.fn(),
  themes: [{ name: 'default', label: 'Default' }],
  dateMode: 'relative' as const,
  setDateMode: vi.fn(),
  autoMarkRead: 'off' as const,
  setAutoMarkRead: vi.fn(),
  showUnreadIndicator: 'on' as const,
  setShowUnreadIndicator: vi.fn(),
  indicatorStyle: 'dot' as const,
  showThumbnails: 'on' as const,
  setShowThumbnails: vi.fn(),
  showFeedActivity: 'on' as const,
  setShowFeedActivity: vi.fn(),
  highlightTheme: 'github-dark' as const,
  setHighlightTheme: vi.fn(),
  articleFont: 'sans' as const,
  setArticleFont: vi.fn(),
  save: vi.fn(),
}

function OutletWrapper() {
  return (
    <KeyboardNavigationProvider>
      <Outlet context={{ settings: mockSettings, sidebarOpen: false, setSidebarOpen: vi.fn() }} />
    </KeyboardNavigationProvider>
  )
}

describe('ArticleDetail bookmark', () => {
  const articleUrl = 'https://example.com/posts/1'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const article = {
    id: 1,
    feed_id: 2,
    feed_name: 'Example Feed',
    title: 'Example Article',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    full_text: 'Body',
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPatch.mockResolvedValue({ bookmarked_at: '2026-03-05T00:00:00.000Z' })
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
  })

  it('updates the bookmark button immediately after click', async () => {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'ja', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    const buttons = screen.getAllByRole('button', { pressed: false })
    // First aria-pressed button is bookmark, second is like
    const bookmarkBtn = buttons[0]
    const icon = bookmarkBtn.querySelector('svg')
    expect(icon?.getAttribute('fill')).toBe('none')

    fireEvent.click(bookmarkBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
    })
    expect(bookmarkBtn.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
    expect(mockApiPatch).toHaveBeenCalledWith('/api/articles/1/bookmark', { bookmarked: true })
  })
})

describe('ArticleDetail like', () => {
  const articleUrl = 'https://example.com/posts/1'
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const article = {
    id: 1,
    feed_id: 2,
    feed_name: 'Example Feed',
    title: 'Example Article',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    full_text: 'Body',
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  beforeEach(() => {
    mockApiPatch.mockReset()
    mockApiPatch.mockResolvedValue({ liked_at: '2026-03-05T00:00:00.000Z' })
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue(undefined)
    mockTrackRead.mockReset()
    mockQueueSeenIds.mockClear()
  })

  it('updates the like button immediately after click', async () => {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'ja', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: article } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    const buttons = screen.getAllByRole('button', { pressed: false })
    // First aria-pressed button is bookmark, second is like
    const likeBtn = buttons[1]
    const icon = likeBtn.querySelector('svg')
    expect(icon?.getAttribute('fill')).toBe('none')

    fireEvent.click(likeBtn)

    await waitFor(() => {
      const pressedButtons = screen.getAllByRole('button', { pressed: true })
      expect(pressedButtons).toHaveLength(1)
    })
    expect(likeBtn.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
    expect(mockApiPatch).toHaveBeenCalledWith('/api/articles/1/like', { liked: true })
  })

})

describe('ArticleDetail source link', () => {
  const feedUrl = 'http://192.168.1.50:3100/api/feeds/newsletter'
  const articleUrl = `${feedUrl}#urn:letterfeed:entry:123`
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const baseArticle = {
    id: 1,
    feed_id: 2,
    feed_name: 'Newsletter',
    title: 'Issue',
    url: articleUrl,
    published_at: '2026-03-04T00:00:00.000Z',
    lang: 'en',
    full_text: 'Body',
    seen_at: '2026-03-04T00:00:00.000Z',
    read_at: '2026-03-04T00:00:00.000Z',
    bookmarked_at: null,
    liked_at: null,
  }

  function renderArticle(sourceUrl: string | null) {
    render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: vi.fn() }}>
          <TooltipProvider>
            <SWRConfig value={{ provider: () => new Map(), fallback: { [articleKey]: { ...baseArticle, source_url: sourceUrl } } }}>
              <Routes>
                <Route element={<OutletWrapper />}>
                  <Route path="*" element={<ArticleDetail articleUrl={articleUrl} />} />
                </Route>
              </Routes>
            </SWRConfig>
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )
  }

  it('links to the original post, not to the in-app article key', () => {
    renderArticle('https://open.substack.com/pub/example/p/the-issue')

    const link = screen.getByRole('link', { name: /Source Article/ })
    expect(link.getAttribute('href')).toBe('https://open.substack.com/pub/example/p/the-issue')
  })

  it('shows no source link when the article has no page on the web', () => {
    renderArticle(null)

    expect(screen.getByText('Newsletter')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Source Article/ })).toBeNull()
  })
})
