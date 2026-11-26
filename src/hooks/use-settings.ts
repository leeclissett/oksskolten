import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { useDarkMode } from './use-dark-mode'
import { useDateMode } from './use-date-mode'
import { useAutoMarkRead } from './use-auto-mark-read'
import { useUnreadIndicator } from './use-unread-indicator'
import { useInternalLinks } from './use-internal-links'
import { useShowThumbnails } from './use-show-thumbnails'
import { useShowFeedActivity } from './use-show-feed-activity'
import { useArticleOpenMode, type ArticleOpenMode } from './use-article-open-mode'
import { useCategoryUnreadOnly } from './use-category-unread-only'
import { useHighlightTheme } from './use-highlight-theme'
import { useLayout } from './use-layout'
import { fetcher, apiPatch, authHeaders } from '../lib/fetcher'

/** Debounce delay (ms) before syncing settings to backend */
const SETTINGS_SYNC_DEBOUNCE_MS = 500

interface Prefs {
  'reading.date_mode': string | null
  'reading.auto_mark_read': string | null
  'reading.unread_indicator': string | null
  'reading.internal_links': string | null
  'reading.show_thumbnails': string | null
  'reading.show_feed_activity': string | null
  'reading.article_open_mode': string | null
  'reading.category_unread_only': string | null
  'appearance.list_layout': string | null
  'translate.provider': string | null
  'translate.model': string | null
  'translate.max_tokens': string | null
  'translate.target_lang': string | null
}

export function useSettings() {
  const { isDark } = useDarkMode()
  useHighlightTheme(isDark)
  const { dateMode, setDateMode } = useDateMode()
  const { autoMarkRead, setAutoMarkRead } = useAutoMarkRead()
  const { showUnreadIndicator, setShowUnreadIndicator } = useUnreadIndicator()
  const { internalLinks, setInternalLinks } = useInternalLinks()
  // Unread marker style. Themes used to choose between a dot and a line; the single built-in look uses the dot.
  const indicatorStyle = 'dot' as 'dot' | 'line'
  const { showThumbnails, setShowThumbnails } = useShowThumbnails()
  const { showFeedActivity, setShowFeedActivity } = useShowFeedActivity()
  const { articleOpenMode, setArticleOpenMode } = useArticleOpenMode()
  const { categoryUnreadOnly, setCategoryUnreadOnly } = useCategoryUnreadOnly()
  const { layout, setLayout } = useLayout()
  const [translateProvider, setTranslateProviderState] = useState<string | null>(null)
  const [translateModel, setTranslateModelState] = useState<string | null>(null)
  const [translateTargetLang, setTranslateTargetLangState] = useState<string | null>(null)
  const [translateMaxTokens, setTranslateMaxTokensState] = useState<string | null>(null)

  // --- DB sync ---
  const { data: prefs, mutate: mutatePrefs } = useSWR<Prefs>(
    '/api/settings/preferences',
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false },
  )

  const dirtyKeysRef = useRef<Set<string>>(new Set())
  const pendingRef = useRef<Partial<Prefs>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlightRef = useRef<Promise<unknown> | null>(null)
  const fireSaveRef = useRef<() => void>(() => {})

  // Stable refs for backfill values (only needed for keys that backfill to DB)
  const dateModeRef = useRef(dateMode)
  dateModeRef.current = dateMode
  const autoMarkReadRef = useRef(autoMarkRead)
  autoMarkReadRef.current = autoMarkRead
  const showUnreadIndicatorRef = useRef(showUnreadIndicator)
  showUnreadIndicatorRef.current = showUnreadIndicator
  const internalLinksRef = useRef(internalLinks)
  internalLinksRef.current = internalLinks
  const showThumbnailsRef = useRef(showThumbnails)
  showThumbnailsRef.current = showThumbnails
  const showFeedActivityRef = useRef(showFeedActivity)
  showFeedActivityRef.current = showFeedActivity
  const articleOpenModeRef = useRef(articleOpenMode)
  articleOpenModeRef.current = articleOpenMode
  const categoryUnreadOnlyRef = useRef(categoryUnreadOnly)
  categoryUnreadOnlyRef.current = categoryUnreadOnly
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // DB → local hydration (data-driven)
  useEffect(() => {
    if (!prefs) return
    const dirty = dirtyKeysRef.current
    const backfill: Partial<Prefs> = {}

    const hydrationMap: Array<{
      key: keyof Prefs
      setter: (v: any) => void
      backfillRef?: React.MutableRefObject<string>
      validate?: (v: string) => boolean
    }> = [
      { key: 'reading.date_mode', setter: setDateMode, backfillRef: dateModeRef,
        validate: v => v === 'relative' || v === 'absolute' },
      { key: 'reading.auto_mark_read', setter: setAutoMarkRead, backfillRef: autoMarkReadRef,
        validate: v => v === 'on' || v === 'off' },
      { key: 'reading.unread_indicator', setter: setShowUnreadIndicator, backfillRef: showUnreadIndicatorRef,
        validate: v => v === 'on' || v === 'off' },
      { key: 'reading.internal_links', setter: setInternalLinks, backfillRef: internalLinksRef,
        validate: v => v === 'on' || v === 'off' },
      { key: 'reading.show_thumbnails', setter: setShowThumbnails, backfillRef: showThumbnailsRef,
        validate: v => v === 'on' || v === 'off' },
      { key: 'reading.show_feed_activity', setter: setShowFeedActivity, backfillRef: showFeedActivityRef,
        validate: v => v === 'on' || v === 'off' },
      { key: 'reading.article_open_mode', setter: setArticleOpenMode, backfillRef: articleOpenModeRef,
        validate: v => v === 'page' || v === 'overlay' },
      { key: 'reading.category_unread_only', setter: setCategoryUnreadOnly, backfillRef: categoryUnreadOnlyRef,
        validate: v => v === 'on' || v === 'off' },
      { key: 'appearance.list_layout', setter: setLayout, backfillRef: layoutRef,
        validate: v => v === 'list' || v === 'card' || v === 'magazine' || v === 'compact' },
      { key: 'translate.provider', setter: setTranslateProviderState },
      { key: 'translate.model', setter: setTranslateModelState },
      { key: 'translate.target_lang', setter: setTranslateTargetLangState },
      { key: 'translate.max_tokens', setter: setTranslateMaxTokensState },
    ]

    for (const { key, setter, backfillRef, validate } of hydrationMap) {
      if (dirty.has(key)) continue
      const value = prefs[key]
      if (value) {
        if (!validate || validate(value)) setter(value)
        else if (backfillRef) backfill[key] = backfillRef.current
      } else if (backfillRef) {
        backfill[key] = backfillRef.current
      }
    }

    if (Object.keys(backfill).length > 0) {
      apiPatch('/api/settings/preferences', backfill).catch(() => {})
    }
  }, [prefs, setDateMode, setAutoMarkRead, setShowUnreadIndicator, setInternalLinks, setShowThumbnails, setShowFeedActivity, setArticleOpenMode, setCategoryUnreadOnly, setLayout])

  // Serialize PATCHes so client send order matches server apply order. A new
  // PATCH is fired only when no other PATCH is in flight; otherwise the new
  // changes accumulate in pendingRef and are picked up after the current
  // request settles. This avoids two PATCHes racing against each other.
  const fireSaveIfIdle = useCallback(() => {
    if (inFlightRef.current) return
    if (Object.keys(pendingRef.current).length === 0) return

    const patch = { ...pendingRef.current }
    pendingRef.current = {}
    const keys = Object.keys(patch) as Array<keyof Prefs>

    const promise = apiPatch('/api/settings/preferences', patch)
      .then(() => {
        for (const key of keys) {
          if (pendingRef.current[key] === undefined) {
            dirtyKeysRef.current.delete(key)
          }
        }
        void mutatePrefs((curr) => {
          if (!curr) return undefined
          const next = { ...curr }
          for (const key of keys) {
            if (pendingRef.current[key] === undefined) {
              const value = patch[key]
              if (value !== undefined) next[key] = value
            }
          }
          return next
        }, false)
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current = null
        if (Object.keys(pendingRef.current).length > 0) {
          fireSaveRef.current()
        }
      })
    inFlightRef.current = promise
  }, [mutatePrefs])

  fireSaveRef.current = fireSaveIfIdle

  // Best-effort flush via fetch keepalive on page unload. Does not coordinate
  // with in-flight requests, so a "rapid edits + immediate reload" sequence
  // can still land out of order on the server. See PR #68 follow-up for full
  // beforeunload serialization (requires server-side revision tracking).
  const flushNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    const patch = { ...pendingRef.current }
    pendingRef.current = {}
    if (Object.keys(patch).length > 0) {
      fetch('/api/settings/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {})
    }
  }, [])

  // Debounced save: 500ms after last change
  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      fireSaveIfIdle()
    }, SETTINGS_SYNC_DEBOUNCE_MS)
  }, [fireSaveIfIdle])

  // Flush on beforeunload + unmount
  useEffect(() => {
    const onBeforeUnload = () => flushNow()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      flushNow()
    }
  }, [flushNow])

  // Stable ref for scheduleSave (avoids recreating factory setters when scheduleSave changes)
  const scheduleSaveRef = useRef(scheduleSave)
  scheduleSaveRef.current = scheduleSave

  // Factory-generated synced setters (all useState setters are referentially stable)
  const {
    syncedSetDateMode,
    syncedSetAutoMarkRead,
    syncedSetShowUnreadIndicator,
    syncedSetInternalLinks,
    syncedSetShowThumbnails,
    syncedSetShowFeedActivity,
    syncedSetArticleOpenMode,
    syncedSetCategoryUnreadOnly,
    syncedSetTranslateProvider,
    syncedSetTranslateModel,
    syncedSetTranslateTargetLang,
    syncedSetTranslateMaxTokens,
  } = useMemo(() => {
    const make = <T extends string>(key: keyof Prefs, setter: (v: T) => void) =>
      (value: T) => {
        dirtyKeysRef.current.add(key)
        setter(value)
        pendingRef.current[key] = value
        scheduleSaveRef.current()
      }
    return {
      syncedSetDateMode: make<'relative' | 'absolute'>('reading.date_mode', setDateMode),
      syncedSetAutoMarkRead: make<'on' | 'off'>('reading.auto_mark_read', setAutoMarkRead),
      syncedSetShowUnreadIndicator: make<'on' | 'off'>('reading.unread_indicator', setShowUnreadIndicator),
      syncedSetInternalLinks: make<'on' | 'off'>('reading.internal_links', setInternalLinks),
      syncedSetShowThumbnails: make<'on' | 'off'>('reading.show_thumbnails', setShowThumbnails),
      syncedSetShowFeedActivity: make<'on' | 'off'>('reading.show_feed_activity', setShowFeedActivity),
      syncedSetArticleOpenMode: make<ArticleOpenMode>('reading.article_open_mode', setArticleOpenMode),
      syncedSetCategoryUnreadOnly: make<'on' | 'off'>('reading.category_unread_only', setCategoryUnreadOnly),
      syncedSetTranslateProvider: make<string>('translate.provider', setTranslateProviderState),
      syncedSetTranslateModel: make<string>('translate.model', setTranslateModelState),
      syncedSetTranslateTargetLang: make<string>('translate.target_lang', setTranslateTargetLangState),
      syncedSetTranslateMaxTokens: make<string>('translate.max_tokens', setTranslateMaxTokensState),
    }
    // scheduleSave and dirtyKeysRef are stable refs; remaining setters are useState/useCallback-stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setDateMode, setAutoMarkRead, setShowUnreadIndicator, setInternalLinks, setShowThumbnails, setShowFeedActivity, setArticleOpenMode, setCategoryUnreadOnly])

  return {
    isDark,
    dateMode,
    setDateMode: syncedSetDateMode,
    autoMarkRead,
    setAutoMarkRead: syncedSetAutoMarkRead,
    showUnreadIndicator,
    setShowUnreadIndicator: syncedSetShowUnreadIndicator,
    internalLinks,
    setInternalLinks: syncedSetInternalLinks,
    showThumbnails,
    setShowThumbnails: syncedSetShowThumbnails,
    showFeedActivity,
    setShowFeedActivity: syncedSetShowFeedActivity,
    articleOpenMode,
    setArticleOpenMode: syncedSetArticleOpenMode,
    categoryUnreadOnly,
    setCategoryUnreadOnly: syncedSetCategoryUnreadOnly,
    layout,
    indicatorStyle,
    translateProvider,
    setTranslateProvider: syncedSetTranslateProvider,
    translateModel,
    setTranslateModel: syncedSetTranslateModel,
    translateTargetLang,
    setTranslateTargetLang: syncedSetTranslateTargetLang,
    translateMaxTokens,
    setTranslateMaxTokens: syncedSetTranslateMaxTokens,
  }
}

export type Settings = ReturnType<typeof useSettings>
