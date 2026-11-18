import { useMemo } from 'react'
import { renderMarkdown, walkLinks } from '../../lib/markdown'
import { sanitizeHtml } from '../../lib/sanitize'
import { SanitizedHTML } from '../ui/sanitized-html'
import type { ChatMessage } from '../../hooks/use-chat'
import { getModelLabel, getModelPricing } from '../../../shared/models'
import { articleUrlToPath } from '../../lib/url'

interface ChatMessageBubbleProps {
  message: ChatMessage
  streaming?: boolean
}

/**
 * Convert external URLs in markdown links to in-app paths.
 * e.g. [title](https://example.com/article) → [title](/example.com/article)
 */
function rewriteLinksToAppPaths(md: string): string {
  return walkLinks(md, (text, url) => {
    if (/^https?:\/\//.test(url)) {
      return `[${text}](${articleUrlToPath(url)})`
    }
    return null
  })
}

function formatChatUsage(usage: NonNullable<ChatMessage['usage']>): string {
  const modelId = usage.model ?? ''
  const modelLabel = getModelLabel(modelId) ?? modelId
  const elapsed = (usage.elapsed_ms / 1000).toFixed(1)
  const [inputRate, outputRate] = getModelPricing(modelId) ?? [1, 5]
  const cost = (usage.input_tokens * inputRate + usage.output_tokens * outputRate) / 1_000_000
  return `${modelLabel} · ${elapsed}s · ${usage.input_tokens.toLocaleString()} in · ${usage.output_tokens.toLocaleString()} out · ~$${cost.toFixed(4)}`
}

export function ChatMessageBubble({ message, streaming }: ChatMessageBubbleProps) {
  const html = useMemo(() => {
    if (!message.text) return ''
    return sanitizeHtml(renderMarkdown(message.text, [rewriteLinksToAppPaths]))
  }, [message.text])

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2 bg-accent text-accent-text text-sm">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="pb-4">
        {html ? (
          <SanitizedHTML html={html} className="prose prose-sm text-sm" />
        ) : streaming ? (
          <div className="flex items-center gap-1.5 text-muted text-sm py-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse [animation-delay:0.2s]" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted animate-pulse [animation-delay:0.4s]" />
          </div>
        ) : null}
        {message.usage && !streaming && (
          <p className="text-[11px] text-muted mt-1 select-none">
            {formatChatUsage(message.usage)}
          </p>
        )}
    </div>
  )
}
