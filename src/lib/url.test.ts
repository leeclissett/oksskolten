import { describe, it, expect } from 'vitest'
import { articlePathToUrl, articleUrlToPath, extractDomain } from './url'

describe('extractDomain', () => {
  it('extracts hostname from a standard URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com')
  })

  it('extracts hostname with subdomain', () => {
    expect(extractDomain('https://blog.example.com/post/1')).toBe('blog.example.com')
  })

  it('extracts hostname from http URL', () => {
    expect(extractDomain('http://example.org')).toBe('example.org')
  })

  it('returns null for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractDomain('')).toBeNull()
  })
})

describe('article URL routing', () => {
  it('round-trips a LetterFeed synthetic URL through the article route', () => {
    const articleUrl = 'http://192.168.1.109:3100/feeds/newsletter#urn:letterfeed:entry:123'
    const routePath = articleUrlToPath(articleUrl)

    expect(articlePathToUrl(routePath.slice(1))).toBe(articleUrl)
  })
})
