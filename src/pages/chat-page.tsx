import { useState, useCallback } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import useSWR, { mutate as globalMutate } from 'swr'
import { fetcher } from '../lib/fetcher'
import { useI18n } from '../lib/i18n'
import { ChatPanel } from '../components/chat/chat-panel'
import { useDateMode } from '../hooks/use-date-mode'
import { formatDate, formatRelativeDate } from '../lib/dateFormat'
import { articleUrlToPath, extractDomain } from '../lib/url'

interface Conversation {
  id: string
  title: string | null
  article_id: number | null
  article_title: string | null
  article_url: string | null
  article_og_image: string | null
  first_user_message: string | null
  first_assistant_preview: string | null
  created_at: string
  updated_at: string
  message_count: number
}

/** Extract plain text from JSON content blocks stored in chat_messages */
function extractText(raw: string | null): string {
  if (!raw) return ''
  try {
    const blocks = JSON.parse(raw)
    if (Array.isArray(blocks)) {
      return blocks
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')
    }
    return String(raw)
  } catch {
    return String(raw)
  }
}

function Thumbnail({ src, articleUrl }: { src: string | null; articleUrl: string | null }) {
  const [failed, setFailed] = useState(false)

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="w-16 h-16 object-cover rounded shrink-0"
        onError={() => setFailed(true)}
      />
    )
  }

  // Fallback: favicon in a bordered box for article conversations
  const domain = articleUrl ? extractDomain(articleUrl) : null
  if (domain) {
    return (
      <div className="w-16 h-16 rounded shrink-0 border border-border bg-bg-subtle flex items-center justify-center">
        <img
          src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`}
          alt=""
          width={24}
          height={24}
        />
      </div>
    )
  }

  return null
}

export function ChatPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const { conversationId } = useParams<{ conversationId?: string }>()
  const { dateMode } = useDateMode()

  const { data } = useSWR<{ conversations: Conversation[] }>(
    '/api/chat/conversations',
    fetcher,
  )
  const conversations = data?.conversations ?? []

  const handleConversationCreated = useCallback((id: string) => {
    void navigate(`/chat/${id}`, { replace: true })
    void globalMutate('/api/chat/conversations')
  }, [navigate])

  // Conversation detail view
  if (conversationId) {
    return (
      <div className="h-[calc(100dvh-var(--header-height))]">
        <ChatPanel
          key={conversationId}
          variant="full"
          conversationId={conversationId}
          onConversationCreated={handleConversationCreated}
        />
      </div>
    )
  }

  // Conversation list view
  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted select-none">
            <p className="text-sm">{t('chat.noConversations')}</p>
          </div>
        ) : (
          <div>
            {conversations.map(conv => {
              const dateText = dateMode === 'relative'
                ? formatRelativeDate(conv.updated_at, locale, { justNow: t('date.justNow') })
                : formatDate(conv.updated_at, locale)
              const hasArticle = !!conv.article_url

              return (
                <a
                  key={conv.id}
                  href={`/chat/${conv.id}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) return
                    e.preventDefault()
                    void navigate(`/chat/${conv.id}`)
                  }}
                  className="block w-full text-left border-b border-border py-3 px-4 md:px-6 transition-[background-color] duration-100 hover:bg-hover select-none no-underline text-inherit"
                >
                  <div className="flex items-start gap-3">
                    {/* Text — fixed width so truncate position stays consistent */}
                    <div className="min-w-0" style={{ width: 'calc(100% - 76px)' }}>
                      {/* Conversation title (AI-generated or fallback) */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[15px] font-semibold text-text truncate">
                          {conv.title || extractText(conv.first_user_message) || t('chat.newChat')}
                        </span>
                        {conv.message_count > 0 && (
                          <span className="text-[11px] text-accent rounded-full px-1.5 leading-relaxed shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}>
                            {conv.message_count}
                          </span>
                        )}
                      </div>

                      {/* AI response preview */}
                      <p className="text-[13px] text-muted truncate mt-0.5">
                        {extractText(conv.first_assistant_preview) || <span className="italic">{t('chat.noResponse')}</span>}
                      </p>

                      {/* Date + article link */}
                      <div className="flex items-center gap-1 text-[12px] text-muted mt-1">
                        <span className="whitespace-nowrap shrink-0">{dateText}</span>
                        {conv.article_title && conv.article_url && (
                          <>
                            <span className="mx-0.5">·</span>
                            <Link
                              to={articleUrlToPath(conv.article_url)}
                              onClick={(e) => e.stopPropagation()}
                              className="truncate hover:text-accent transition-colors"
                            >
                              {conv.article_title}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Thumbnail slot — always reserves space */}
                    <div className="w-16 h-16 shrink-0 flex items-center justify-center">
                      {hasArticle ? (
                        <Thumbnail src={conv.article_og_image} articleUrl={conv.article_url} />
                      ) : (
                        <>
                          <img src="/icons/favicon-black.png" alt="" className="h-10 w-10 dark:hidden" />
                          <img src="/icons/favicon-white.png" alt="" className="h-10 w-10 hidden dark:block" />
                        </>
                      )}
                    </div>
                  </div>
                </a>
              )
            })}
          </div>
        )}
    </div>
  )
}
