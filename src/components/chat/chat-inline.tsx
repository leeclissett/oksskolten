import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { MessagesSquare } from 'lucide-react'
import { ChatPanel } from './chat-panel'
import { ActionChip } from '../ui/action-chip'
import { fetcher } from '../../lib/fetcher'
import { useI18n } from '../../lib/i18n'

interface ChatInlineProps {
  articleId: number
}

export function useChatInline(articleId: number) {
  const [open, setOpen] = useState(false)

  const { data: existingConv } = useSWR<{ conversations: { id: string }[] }>(
    articleId ? `/api/chat/conversations?article_id=${articleId}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  // Auto-open if article already has conversations
  useEffect(() => {
    if (existingConv?.conversations?.length) {
      setOpen(true)
    }
  }, [existingConv])

  return { open, toggle: () => setOpen(prev => !prev), close: () => setOpen(false) }
}

export function ChatInlineTrigger({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <ActionChip active={active} onClick={onToggle}>
      <MessagesSquare className="w-3.5 h-3.5" />
      {t('article.askQuestion')}
    </ActionChip>
  )
}

export function ChatInlinePanel({ articleId, onClose }: { articleId: number; onClose: () => void }) {
  return (
    <div className="mt-2 mb-6">
      <ChatPanel variant="inline" articleId={articleId} onClose={onClose} />
    </div>
  )
}

/** @deprecated Use useChatInline + ChatInlineTrigger + ChatInlinePanel instead */
export function ChatInline({ articleId }: ChatInlineProps) {
  const chat = useChatInline(articleId)

  return (
    <>
      <ChatInlineTrigger active={chat.open} onToggle={chat.toggle} />
      {chat.open && (
        <div className="basis-full mt-2">
          <ChatPanel variant="inline" articleId={articleId} onClose={chat.close} />
        </div>
      )}
    </>
  )
}
