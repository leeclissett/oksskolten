import { type ReactNode } from 'react'
import { Pencil, CheckCheck, Trash2, FolderInput, RefreshCw, Search } from 'lucide-react'
import { useI18n } from '../../lib/i18n'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuSeparator,
} from '../ui/context-menu'

interface FeedMenuProps {
  children: ReactNode
  feedType?: 'rss' | 'clip'
  categories?: Array<{ id: number; name: string }>
  onRename: () => void
  onMarkAllRead: () => void
  onDelete: () => void
  onMoveToCategory?: (categoryId: number | null) => void
  onFetch?: () => void
  onReDetect?: () => void
}

export function FeedContextMenu({
  children,
  feedType,
  categories = [],
  onRename,
  onMarkAllRead,
  onDelete,
  onMoveToCategory,
  onFetch,
  onReDetect,
}: FeedMenuProps) {
  const { t } = useI18n()
  const isClip = feedType === 'clip'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename}>
          <Pencil size={16} strokeWidth={1.5} />
          {t('feeds.rename')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onMarkAllRead}>
          <CheckCheck size={16} strokeWidth={1.5} />
          {t('feeds.markAllRead')}
        </ContextMenuItem>

        {!isClip && onMoveToCategory && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput size={16} strokeWidth={1.5} />
              {t('category.moveToCategory')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={() => onMoveToCategory(null)}>
                {t('category.uncategorized')}
              </ContextMenuItem>
              {categories.map(cat => (
                <ContextMenuItem key={cat.id} onSelect={() => onMoveToCategory(cat.id)}>
                  {cat.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {onFetch && !isClip && (
          <ContextMenuItem onSelect={onFetch}>
            <RefreshCw size={16} strokeWidth={1.5} />
            {t('feeds.fetch')}
          </ContextMenuItem>
        )}

        {!isClip && onReDetect && (
          <ContextMenuItem onSelect={onReDetect}>
            <Search size={16} strokeWidth={1.5} />
            {t('feeds.reDetect')}
          </ContextMenuItem>
        )}

        {!isClip && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onDelete} className="text-error">
              <Trash2 size={16} strokeWidth={1.5} />
              {t('feeds.delete')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface MultiSelectMenuProps {
  children: ReactNode
  selectedCount: number
  categories: Array<{ id: number; name: string }>
  onMoveToCategory: (categoryId: number | null) => void
  onMarkAllRead: () => void
  onFetch: () => void
  onDelete: () => void
}

export function MultiSelectContextMenu({
  children,
  selectedCount,
  categories,
  onMoveToCategory,
  onMarkAllRead,
  onFetch,
  onDelete,
}: MultiSelectMenuProps) {
  const { t } = useI18n()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <div className="px-2 py-1.5 text-[11px] text-muted">
          {t('feeds.selectedCount', { count: String(selectedCount) })}
        </div>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderInput size={16} strokeWidth={1.5} />
            {t('feeds.bulkMoveToCategory')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => onMoveToCategory(null)}>
              {t('category.uncategorized')}
            </ContextMenuItem>
            {categories.map(cat => (
              <ContextMenuItem key={cat.id} onSelect={() => onMoveToCategory(cat.id)}>
                {cat.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onSelect={onMarkAllRead}>
          <CheckCheck size={16} strokeWidth={1.5} />
          {t('feeds.bulkMarkAllRead')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onFetch}>
          <RefreshCw size={16} strokeWidth={1.5} />
          {t('feeds.bulkFetch')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete} className="text-error">
          <Trash2 size={16} strokeWidth={1.5} />
          {t('feeds.bulkDelete', { count: String(selectedCount) })}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface CategoryMenuProps {
  children: ReactNode
  onRename: () => void
  onMarkAllRead: () => void
  onDelete: () => void
  onFetch?: () => void
}

export function CategoryContextMenu({
  children,
  onRename,
  onMarkAllRead,
  onDelete,
  onFetch,
}: CategoryMenuProps) {
  const { t } = useI18n()

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename}>
          <Pencil size={16} strokeWidth={1.5} />
          {t('category.rename')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onMarkAllRead}>
          <CheckCheck size={16} strokeWidth={1.5} />
          {t('category.markAllRead')}
        </ContextMenuItem>
        {onFetch && (
          <ContextMenuItem onSelect={onFetch}>
            <RefreshCw size={16} strokeWidth={1.5} />
            {t('category.fetchAll')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete} className="text-error">
          <Trash2 size={16} strokeWidth={1.5} />
          {t('category.delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
