import { Skeleton } from '../ui/skeleton'
import { SanitizedHTML } from '../ui/sanitized-html'

interface ArticleContentBodyProps {
  translating: boolean
  translatingText: string
  translatingHtml: string
  displayContent: string
}

export function ArticleContentBody({
  translating,
  translatingText,
  translatingHtml,
  displayContent,
}: ArticleContentBodyProps) {
  if (translating && translatingText) {
    return <SanitizedHTML html={translatingHtml} className="prose transition-opacity duration-150" />
  }

  if (translating) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  return <SanitizedHTML html={displayContent} className="prose transition-opacity duration-150" />
}
