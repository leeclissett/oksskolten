import { useState, useEffect, useRef, useMemo } from 'react'
import useSWR from 'swr'
import { fetcher } from '../../lib/fetcher'
import { useI18n, isMessageKey } from '../../lib/i18n'

const ROTATION_INTERVAL = 3000

interface ChatPromptSuggestionProps {
  context?: 'home'
  onSelect: (prompt: string, suggestionKey?: string) => void
}

export function ChatPromptSuggestion({ context, onSelect }: ChatPromptSuggestionProps) {
  const { t } = useI18n()

  // Static fallback suggestions
  const fallback = useMemo(() => context === 'home' ? [
    { text: t('chat.suggestion.home.recommend'), key: 'recommend' },
    { text: t('chat.suggestion.home.unread'), key: 'unread' },
    { text: t('chat.suggestion.home.trending'), key: 'trending' },
    { text: t('chat.suggestion.home.surprise'), key: 'surprise' },
    { text: t('chat.suggestion.home.digest'), key: 'digest' },
  ] : [
    { text: t('chat.suggestion.summarize'), key: 'summarize' },
    { text: t('chat.suggestion.keyPoints'), key: 'keyPoints' },
    { text: t('chat.suggestion.explain'), key: 'explain' },
    { text: t('chat.suggestion.opinion'), key: 'opinion' },
    { text: t('chat.suggestion.related'), key: 'related' },
  ], [t, context])

  // Dynamic suggestions from API (home context only)
  const { data } = useSWR<{ suggestions: Array<{ key: string; params?: Record<string, string | number> }> }>(
    context === 'home' ? '/api/chat/suggestions' : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 },
  )

  const prompts = useMemo(
    () => data?.suggestions?.map(s => {
      const params = s.params ? Object.fromEntries(Object.entries(s.params).map(([k, v]) => [k, String(v)])) : undefined
      return { text: isMessageKey(s.key) ? t(s.key, params) : s.key, key: s.key }
    }) ?? fallback,
    [data, fallback, t],
  )

  const [promptIndex, setPromptIndex] = useState(0)
  const hovered = useRef(false)

  useEffect(() => {
    setPromptIndex(0)
  }, [prompts])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!hovered.current) {
        setPromptIndex(i => (i + 1) % prompts.length)
      }
    }, ROTATION_INTERVAL)
    return () => clearInterval(timer)
  }, [prompts.length])

  return (
    <div className="flex flex-col items-end justify-end h-full pt-10 pb-2 select-none">
      <p className="text-xs text-muted mb-2 mr-1">{t('chat.trySaying')}</p>
      <button
        key={promptIndex}
        onClick={() => onSelect(prompts[promptIndex].text, prompts[promptIndex].key)}
        onMouseEnter={() => { hovered.current = true }}
        onMouseLeave={() => { hovered.current = false }}
        className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2 border border-accent text-accent text-sm animate-[slide-up_300ms_ease-out] hover:bg-accent hover:text-accent-text transition-colors cursor-pointer"
      >
        {prompts[promptIndex].text}
      </button>
    </div>
  )
}
