export { articlePathToUrl, articleUrlToPath } from '../../shared/url'

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
