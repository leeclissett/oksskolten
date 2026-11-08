import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { renderMarkdown } from '../../lib/markdown'
import { sanitizeHtml } from '../../lib/sanitize'
import { fetcher, apiPost } from '../../lib/fetcher'
import { queueSeenIds } from '../../lib/offlineQueue'
import { useSWRConfig } from 'swr'
import { trackRead } from '../../lib/readTracker'
import { useArticleActions } from '../../hooks/use-article-actions'
import { useI18n } from '../../lib/i18n'
import { useRewriteInternalLinks } from '../../hooks/use-rewrite-internal-links'
import { ImageLightbox } from '../ui/image-lightbox'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { formatDetailDate } from '../../lib/dateFormat'
import { useAppLayout } from '../../app'
import { Skeleton } from '../ui/skeleton'
import { ArticleZapNavigation } from './article-zap-navigation'
import { ArticleToolbar } from './article-toolbar'
import { ArticleContentBody } from './article-content-body'
import type { ArticleDetail as ArticleDetailData } from '../../../shared/types'

interface ArticleDetailProps {
  articleUrl: string
  enableZapNavigation?: boolean
}

export function ArticleDetail({ articleUrl, enableZapNavigation = false }: ArticleDetailProps) {
  const { settings: { internalLinks } } = useAppLayout()
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const articleKey = `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`
  const { data: article, error } = useSWR<ArticleDetailData>(articleKey, fetcher)
  const { mutate: globalMutate } = useSWRConfig()

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const articleRef = useRef<HTMLElement>(null)

  const {
    isBookmarked, isLiked, archivingImages, deleteConfirmOpen, setDeleteConfirmOpen,
    toggleBookmark, toggleLike, handleArchiveImages, handleDelete,
  } = useArticleActions(article, articleKey)

  // Record article read on mount
  const viewedRef = useRef<number | null>(null)
  useEffect(() => {
    if (article && viewedRef.current !== article.id) {
      viewedRef.current = article.id
      const isFirstSeen = article.seen_at == null
      if (isFirstSeen) {
        trackRead(article.id)
      }
      apiPost(`/api/articles/${article.id}/read`)
        .then(() => globalMutate((key: string) => typeof key === 'string' && key.startsWith('/api/feeds')))
        .catch(async () => {
          if (isFirstSeen) {
            await queueSeenIds([article.id])
          }
        })
    }
  }, [article, globalMutate])

  const content = useMemo(() => {
    if (!article) return ''
    const md = article.full_text || ''
    if (!md) return `<p class="text-muted">${t('article.noContent')}</p>`
    return sanitizeHtml(renderMarkdown(md))
  }, [article, t])

  const { rewrittenHtml: displayContent } = useRewriteInternalLinks(
    content,
    article?.url || articleUrl,
    internalLinks === 'on',
  )

  // Event delegation: single listener on <article> handles all image clicks & errors
  const hasArticle = !!article
  useEffect(() => {
    const container = articleRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const img = (e.target as HTMLElement).closest('.prose img') as HTMLImageElement | null
      if (img) {
        setLightboxSrc(img.currentSrc || img.src)
        return
      }

      const anchor = (e.target as HTMLElement).closest('.prose a') as HTMLAnchorElement | null
      if (anchor) {
        e.preventDefault()
        if (anchor.hasAttribute('data-internal-link')) {
          const path = anchor.getAttribute('href')
          if (path) void navigate(path)
        } else {
          const href = anchor.getAttribute('href')
          if (href) window.open(href, '_blank', 'noopener,noreferrer')
        }
      }
    }

    const handleError = (e: Event) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'IMG' && el.closest('.prose')) {
        el.classList.add('error')
      }
    }

    container.addEventListener('click', handleClick)
    container.addEventListener('error', handleError, true)

    return () => {
      container.removeEventListener('click', handleClick)
      container.removeEventListener('error', handleError, true)
    }
  }, [hasArticle, navigate])

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-12 text-center">
        <p className="text-muted">{t('article.notFound')}</p>
      </div>
    )
  }

  if (!article) {
    return (
      <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 space-y-4">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-4 w-1/6 mt-4" />
        <Skeleton className="h-8 w-1/2 mt-6" />
        <div className="space-y-3 mt-8">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    )
  }

  return (
    <>
      {enableZapNavigation && (
        <ArticleZapNavigation
          currentArticleId={String(article.id)}
          onBookmarkToggle={toggleBookmark}
          onOpenExternal={() => { if (article.source_url) window.open(article.source_url, '_blank') }}
        />
      )}
      <article ref={articleRef} className="article-card max-w-2xl mx-auto px-6 md:px-10 py-8">
      {/* Title */}
      <h1 className="mb-1.5 text-[28px] font-bold leading-[1.3] break-words [overflow-wrap:anywhere]">
        {article.title}
      </h1>

      {/* Date */}
      <p className="text-sm text-muted mb-3">{formatDetailDate(article.published_at, locale)}</p>

      {/* Toolbar */}
      <ArticleToolbar
        article={article}
        isBookmarked={!!isBookmarked}
        isLiked={isLiked}
        archivingImages={archivingImages}
        onToggleBookmark={toggleBookmark}
        onToggleLike={toggleLike}
        onArchiveImages={handleArchiveImages}
        onDelete={() => setDeleteConfirmOpen(true)}
      />

      {/* Content */}
      <ArticleContentBody
        displayContent={displayContent}
      />
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </article>
    {deleteConfirmOpen && (
      <ConfirmDialog
        title={t('article.delete')}
        message={t('article.deleteConfirm')}
        confirmLabel={t('article.delete')}
        danger
        onConfirm={() => { setDeleteConfirmOpen(false); handleDelete() }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    )}
    </>
  )
}
