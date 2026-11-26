import { useEffect } from 'react'

const LINK_ID = 'hljs-theme-link'

/** Load the code-highlighting stylesheet that matches the colour scheme. */
export function useHighlightTheme(isDark: boolean) {
  useEffect(() => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    link.href = `/hljs-themes/${isDark ? 'github-dark' : 'github'}.min.css`
  }, [isDark])
}
