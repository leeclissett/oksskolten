import { type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ChatMessageBubble } from './chat-message-bubble'
import { useI18n } from '../../lib/i18n'
import type { ChatMessage } from '../../hooks/use-chat'

interface ToolStatus {
  name: string
  tool_use_id: string
}

interface ChatMessagesProps {
  messages: ChatMessage[]
  streaming: boolean
  thinking: boolean
  activeTool: ToolStatus | null
  error: string | null
  endRef?: RefObject<HTMLDivElement | null>
  showEndMarker?: boolean
}

export function ChatMessages({ messages, streaming, thinking, activeTool, error, endRef, showEndMarker }: ChatMessagesProps) {
  const { t, tError, isKeyNotSetError } = useI18n()

  return (
    <>
      {messages.map((msg, i) => (
        <ChatMessageBubble
          key={i}
          message={msg}
          streaming={streaming && i === messages.length - 1 && msg.role === 'assistant'}
        />
      ))}

      {activeTool && (
        <div className="flex items-center gap-2 text-muted text-xs py-1 select-none">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('chat.toolRunning', { name: activeTool.name })}
        </div>
      )}

      {thinking && !activeTool && (
        <div className="flex items-center gap-2 text-muted text-xs py-1 select-none">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('chat.thinking')}
        </div>
      )}

      {error && (
        <div className="text-error text-xs py-1">
          {tError(error)}
          {isKeyNotSetError(error) && (
            <>
              <Link to="/settings/integration" className="underline text-accent">{t('error.goToSettings')}</Link>
              {t('error.setApiKeyFromSettings')}
            </>
          )}
        </div>
      )}

      {showEndMarker && <div ref={endRef} />}
    </>
  )
}
