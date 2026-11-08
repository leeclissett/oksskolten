import { SanitizedHTML } from '../ui/sanitized-html'

interface ArticleContentBodyProps {
  displayContent: string
}

export function ArticleContentBody({
  displayContent,
}: ArticleContentBodyProps) {
  return <SanitizedHTML html={displayContent} className="prose transition-opacity duration-150" />
}
