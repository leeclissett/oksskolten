import { Link } from 'react-router-dom'
import { articleUrlToPath, extractDomain } from '../../lib/url'

interface ChatLinkedArticleProps {
  title: string
  url: string
  ogImage: string | null
}

export function ChatLinkedArticle({ title, url, ogImage }: ChatLinkedArticleProps) {
  const domain = extractDomain(url)

  return (
    <Link
      to={articleUrlToPath(url)}
      className="block rounded-xl overflow-hidden border border-border bg-bg-card hover:border-accent/40 transition-all no-underline text-inherit select-none group"
    >
      <div className="relative w-full aspect-[2/1] overflow-hidden bg-bg-subtle">
        {ogImage ? (
          <img
            src={ogImage}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {domain && (
              <img
                src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
                alt=""
                width={32}
                height={32}
                className="opacity-40"
              />
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-base font-semibold text-white leading-snug line-clamp-2 drop-shadow-sm">
            {title}
          </h3>
          <div className="flex items-center gap-1.5 mt-1.5">
            {domain && (
              <img
                src={`https://www.google.com/s2/favicons?sz=32&domain=${domain}`}
                alt=""
                width={14}
                height={14}
                className="rounded-sm opacity-80"
              />
            )}
            <span className="text-xs text-white/70">{domain}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
