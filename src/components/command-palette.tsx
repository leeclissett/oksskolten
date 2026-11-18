import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import useSWR from 'swr'
import { fetcher, fetchOpmlBlob } from '@/lib/fetcher'
import { useI18n } from '@/lib/i18n'
import { useAppLayout } from '../app'
import { themes as builtinThemes } from '@/data/themes'
import { layouts } from '@/data/layouts'
import {
  Inbox,
  Bookmark,
  ThumbsUp,
  Clock,
  MessagesSquare,
  Settings,
  Search,
  Plus,
  Upload,
  Download,
  Palette,
  LayoutGrid,
  Sun,
  Moon,
  Monitor,
  Check,
} from 'lucide-react'
import type { FeedWithCounts, Category } from '../../shared/types'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSearch: () => void
  onOpenAddFeed: () => void
}

export function CommandPalette({ open, onOpenChange, onOpenSearch, onOpenAddFeed }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const { settings } = useAppLayout()

  const { data: feedsData } = useSWR<{
    feeds: FeedWithCounts[]
    bookmark_count: number
    like_count: number
    clip_feed_id: number | null
  }>('/api/feeds', fetcher)

  const { data: categoriesData } = useSWR<{
    categories: Category[]
  }>('/api/categories', fetcher)

  const [search, setSearch] = useState('')

  const runAction = useCallback(
    (action: () => void) => {
      onOpenChange(false)
      setTimeout(action, 150)
    },
    [onOpenChange],
  )

  const feeds = useMemo(() => {
    if (!feedsData?.feeds) return []
    return feedsData.feeds.filter((f) => f.type !== 'clip')
  }, [feedsData])

  const categoryMap = useMemo(() => {
    const map = new Map<number, string>()
    categoriesData?.categories.forEach((c) => map.set(c.id, c.name))
    return map
  }, [categoriesData])

  useEffect(() => {
    if (open) setSearch('')
  }, [open])

  function handleExportOpml() {
    runAction(async () => {
      const blob = await fetchOpmlBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'oksskolten.opml'
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  function formatHostname(url: string): string {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }

  const allThemes = useMemo(() => {
    const custom = settings.customThemes ?? []
    return [...builtinThemes, ...custom]
  }, [settings.customThemes])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={t('command.placeholder')}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>{t('command.noResults')}</CommandEmpty>

        {/* Navigation */}
        <CommandGroup heading={t('command.navigation')}>
          <CommandItem keywords={['inbox', '/inbox', 'unread', 'new']} onSelect={() => runAction(() => navigate('/inbox'))}>
            <Inbox className="mr-2 h-4 w-4 text-muted" />
            Inbox
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem keywords={['bookmarks', '/bookmarks', 'saved', 'read later']} onSelect={() => runAction(() => navigate('/bookmarks'))}>
            <Bookmark className="mr-2 h-4 w-4 text-muted" />
            {t('feeds.bookmarks')}
            <CommandShortcut>⌘2</CommandShortcut>
          </CommandItem>
          <CommandItem keywords={['likes', 'liked', '/likes', 'favorites']} onSelect={() => runAction(() => navigate('/likes'))}>
            <ThumbsUp className="mr-2 h-4 w-4 text-muted" />
            {t('feeds.likes')}
            <CommandShortcut>⌘3</CommandShortcut>
          </CommandItem>
          <CommandItem keywords={['history', '/history', 'read', 'archive']} onSelect={() => runAction(() => navigate('/history'))}>
            <Clock className="mr-2 h-4 w-4 text-muted" />
            {t('feeds.history')}
            <CommandShortcut>⌘4</CommandShortcut>
          </CommandItem>
          <CommandItem keywords={['chat', '/chat', 'ai', 'assistant']} onSelect={() => runAction(() => navigate('/chat'))}>
            <MessagesSquare className="mr-2 h-4 w-4 text-muted" />
            {t('chat.title')}
            <CommandShortcut>⌘5</CommandShortcut>
          </CommandItem>
          <CommandItem keywords={['settings', '/settings', 'preferences', 'config']} onSelect={() => runAction(() => navigate('/settings/general'))}>
            <Settings className="mr-2 h-4 w-4 text-muted" />
            {t('settings.title')}
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Actions */}
        <CommandGroup heading={t('command.actions')}>
          <CommandItem
            keywords={['search', 'find', 'query']}
            onSelect={() => {
              onOpenChange(false)
              setTimeout(() => onOpenSearch(), 150)
            }}
          >
            <Search className="mr-2 h-4 w-4 text-muted" />
            {t('command.searchArticles')}
            <CommandShortcut>⌘⇧K</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={['add feed', 'subscribe', 'new', 'rss']}
            onSelect={() => {
              onOpenChange(false)
              setTimeout(() => onOpenAddFeed(), 150)
            }}
          >
            <Plus className="mr-2 h-4 w-4 text-muted" />
            {t('command.addFeed')}
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem
            keywords={['import opml', 'upload']}
            onSelect={() => runAction(() => navigate('/settings/data'))}
          >
            <Upload className="mr-2 h-4 w-4 text-muted" />
            {t('command.importOpml')}
          </CommandItem>
          <CommandItem
            keywords={['export opml', 'download', 'backup']}
            onSelect={handleExportOpml}
          >
            <Download className="mr-2 h-4 w-4 text-muted" />
            {t('command.exportOpml')}
          </CommandItem>
        </CommandGroup>

        {/* Feeds - shown only when searching */}
        {search.length > 0 && feeds.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('command.feeds')}>
              {feeds.map((feed) => (
                <CommandItem
                  key={feed.id}
                  value={`feed-${feed.name}-${feed.url}`}
                  keywords={[formatHostname(feed.url)]}
                  onSelect={() => runAction(() => navigate(`/feeds/${feed.id}`))}
                >
                  <span className="truncate">{feed.name}</span>
                  {feed.category_id && categoryMap.has(feed.category_id) && (
                    <span className="text-muted ml-2 text-xs">
                      {categoryMap.get(feed.category_id)}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />

        {/* Appearance */}
        <CommandGroup heading={t('command.appearance')}>
          {allThemes.map((theme) => (
            <CommandItem
              key={theme.name}
              keywords={['theme', 'color', 'appearance']}
              onSelect={() => runAction(() => settings.setTheme(theme.name))}
            >
              <Palette className="mr-2 h-4 w-4 text-muted" />
              Theme: {theme.label}
              {settings.themeName === theme.name && (
                <Check className="ml-auto h-4 w-4 text-accent" />
              )}
            </CommandItem>
          ))}

          <CommandSeparator />

          {layouts.map((l) => (
            <CommandItem
              key={l.name}
              keywords={['layout', 'view']}
              onSelect={() => runAction(() => settings.setLayout(l.name as 'list' | 'card' | 'magazine' | 'compact'))}
            >
              <LayoutGrid className="mr-2 h-4 w-4 text-muted" />
              Layout: {l.label}
              {settings.layout === l.name && (
                <Check className="ml-auto h-4 w-4 text-accent" />
              )}
            </CommandItem>
          ))}

          <CommandSeparator />

          <CommandItem
            keywords={['color mode']}
            onSelect={() => runAction(() => settings.setColorMode('light'))}
          >
            <Sun className="mr-2 h-4 w-4 text-muted" />
            Color mode: Light
            {settings.colorMode === 'light' && <Check className="ml-auto h-4 w-4 text-accent" />}
          </CommandItem>
          <CommandItem
            keywords={['color mode']}
            onSelect={() => runAction(() => settings.setColorMode('dark'))}
          >
            <Moon className="mr-2 h-4 w-4 text-muted" />
            Color mode: Dark
            {settings.colorMode === 'dark' && <Check className="ml-auto h-4 w-4 text-accent" />}
          </CommandItem>
          <CommandItem
            keywords={['color mode', 'auto']}
            onSelect={() => runAction(() => settings.setColorMode('system'))}
          >
            <Monitor className="mr-2 h-4 w-4 text-muted" />
            Color mode: System
            {settings.colorMode === 'system' && <Check className="ml-auto h-4 w-4 text-accent" />}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
