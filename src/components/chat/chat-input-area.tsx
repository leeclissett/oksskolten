import { useRef, type KeyboardEvent } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { useI18n } from '../../lib/i18n'

const MAX_HEIGHT_INLINE = 120
const MAX_HEIGHT_FULL = 150

interface ChatInputAreaProps {
  variant: 'inline' | 'full'
  input: string
  streaming: boolean
  onInputChange: (value: string) => void
  onSend: () => void
}

export function ChatInputArea({ variant, input, streaming, onInputChange, onSend }: ChatInputAreaProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, variant === 'full' ? MAX_HEIGHT_FULL : MAX_HEIGHT_INLINE) + 'px'
  }

  const sendButton = (
    <button
      onClick={onSend}
      disabled={!input.trim() || streaming}
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent text-accent-text disabled:opacity-40 transition-opacity"
      aria-label={t('chat.send')}
    >
      {streaming ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Send className="w-4 h-4" />
      )}
    </button>
  )

  if (variant === 'full') {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-3">
        <div className="border border-border rounded-xl bg-bg-card overflow-hidden">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t('home.placeholder')}
            rows={1}
            disabled={streaming}
            className="w-full resize-none bg-transparent text-text text-[15px] px-4 pt-3 pb-1 outline-none min-h-9 max-h-30 placeholder:text-muted"
          />
          <div className="flex items-center justify-end px-3 pb-3">
            {sendButton}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-border px-3 py-2 select-none">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.placeholder')}
          rows={1}
          disabled={streaming}
          className="flex-1 resize-none bg-bg-input text-text text-sm rounded-lg px-3 py-2 outline-none focus:border-accent border border-border min-h-9 max-h-30"
        />
        {sendButton}
      </div>
    </div>
  )
}
