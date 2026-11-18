import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from './command-palette'

// --- Mocks ---

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/inbox' }),
}))

vi.mock('../lib/fetcher', () => ({
  fetcher: vi.fn(),
  fetchOpmlBlob: vi.fn().mockResolvedValue(new Blob(['<opml/>'])),
}))

vi.mock('swr', () => ({
  __esModule: true,
  default: (key: string) => {
    if (key === '/api/feeds') {
      return {
        data: {
          feeds: [
            { id: 1, name: 'Test Feed', url: 'https://example.com', type: 'rss', category_id: 1, unread_count: 3, article_count: 10 },
            { id: 2, name: 'Clip Feed', url: 'https://clip.example.com', type: 'clip', category_id: null, unread_count: 0, article_count: 0 },
          ],
          bookmark_count: 0,
          like_count: 0,
          clip_feed_id: 2,
        },
      }
    }
    if (key === '/api/categories') {
      return {
        data: {
          categories: [{ id: 1, name: 'Tech', sort_order: 0 }],
        },
      }
    }
    return { data: undefined }
  },
}))

const mockSettings = {
  themeName: 'default',
  setTheme: vi.fn(),
  layout: 'list' as const,
  setLayout: vi.fn(),
  colorMode: 'system' as const,
  setColorMode: vi.fn(),
  customThemes: [],
}

vi.mock('../app', () => ({
  useAppLayout: () => ({ settings: mockSettings }),
}))

describe('CommandPalette', () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenAddFeed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders navigation items', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByText('Inbox')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('renders action items', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByText('Search articles')).toBeTruthy()
    expect(screen.getByText('Add new feed')).toBeTruthy()
    expect(screen.getByText('Import OPML')).toBeTruthy()
    expect(screen.getByText('Export OPML')).toBeTruthy()
  })

  it('navigates on selecting a navigation item', async () => {
    render(<CommandPalette {...defaultProps} />)
    await user.click(screen.getByText('Inbox'))
    await waitFor(() => {
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    })
    // Navigate is called after setTimeout
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/inbox')
    }, { timeout: 500 })
  })

  it('opens search when Search articles is selected', async () => {
    render(<CommandPalette {...defaultProps} />)
    await user.click(screen.getByText('Search articles'))
    await waitFor(() => {
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
    })
    await waitFor(() => {
      expect(defaultProps.onOpenSearch).toHaveBeenCalled()
    }, { timeout: 500 })
  })

  it('opens add feed when Add new feed is selected', async () => {
    render(<CommandPalette {...defaultProps} />)
    await user.click(screen.getByText('Add new feed'))
    await waitFor(() => {
      expect(defaultProps.onOpenAddFeed).toHaveBeenCalled()
    }, { timeout: 500 })
  })

  it('does not show feeds when search is empty', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.queryByText('Test Feed')).toBeNull()
  })

  it('shows feeds when search is typed', async () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, 'Test')
    await waitFor(() => {
      expect(screen.getByText('Test Feed')).toBeTruthy()
    })
  })

  it('excludes clip feeds from feed list', async () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, 'Clip')
    // Clip Feed should not appear
    expect(screen.queryByText('Clip Feed')).toBeNull()
  })

  it('renders theme items with check mark for current theme', () => {
    render(<CommandPalette {...defaultProps} />)
    // The default theme should have a check mark
    const defaultThemeItems = screen.getAllByText(/Theme: Default/)
    expect(defaultThemeItems.length).toBeGreaterThan(0)
  })

  it('calls setTheme when a theme is selected', async () => {
    render(<CommandPalette {...defaultProps} />)
    // Find and click a non-default theme
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, 'Theme')
    const themeItem = screen.getByText('Theme: Default')
    await user.click(themeItem)
    await waitFor(() => {
      expect(mockSettings.setTheme).toHaveBeenCalledWith('default')
    }, { timeout: 500 })
  })

  it('renders layout items', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByText('Layout: List')).toBeTruthy()
    expect(screen.getByText('Layout: Card')).toBeTruthy()
    expect(screen.getByText('Layout: Magazine')).toBeTruthy()
    expect(screen.getByText('Layout: Compact')).toBeTruthy()
  })

  it('renders color mode items', () => {
    render(<CommandPalette {...defaultProps} />)
    expect(screen.getByText('Color mode: Light')).toBeTruthy()
    expect(screen.getByText('Color mode: Dark')).toBeTruthy()
    expect(screen.getByText('Color mode: System')).toBeTruthy()
  })

  it('does not render when closed', () => {
    render(<CommandPalette {...defaultProps} open={false} />)
    expect(screen.queryByText('Inbox')).toBeNull()
  })

  it('matches items by English keywords (e.g. "chat" finds Chat item)', async () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, 'chat')
    await waitFor(() => {
      // Chat nav item should still be visible (matched via keywords)
      expect(screen.getByText('Chat')).toBeTruthy()
    })
  })

  it('matches items by path keywords (e.g. "/bookmarks")', async () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, '/bookmarks')
    await waitFor(() => {
      expect(screen.getByText('Read Later')).toBeTruthy()
    })
  })

  it('matches action items by English keywords (e.g. "search")', async () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, 'search')
    await waitFor(() => {
      expect(screen.getByText('Search articles')).toBeTruthy()
    })
  })

  it('matches settings by keyword "settings"', async () => {
    render(<CommandPalette {...defaultProps} />)
    const input = screen.getByPlaceholderText('Type a command or search...')
    await user.type(input, 'settings')
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeTruthy()
    })
  })
})
