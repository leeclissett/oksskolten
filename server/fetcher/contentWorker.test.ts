import { describe, it, expect } from 'vitest'
import { parseHtml } from './contentWorker.js'

const BASE_URL = 'https://example.com/article'

function makeHtml(body: string, meta = ''): string {
  return `<!DOCTYPE html><html><head>${meta}</head><body>${body}</body></html>`
}

// --- parseHtml ---

describe('parseHtml', () => {
  it('extracts article content as markdown', () => {
    const html = makeHtml(`
      <article>
        <h1>Test Title</h1>
        <p>This is the article body with enough text to be extracted by readability.
        The content needs to be sufficiently long for Readability to pick it up as main content.
        Adding more paragraphs helps with this detection algorithm.</p>
        <p>Second paragraph with additional content to ensure proper extraction.
        Readability needs a reasonable amount of text to identify the main content area.</p>
        <p>Third paragraph. More content is better for article extraction accuracy.</p>
      </article>
    `)

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.fullText).toContain('article body')
    expect(result.excerpt).toBeTruthy()
    expect(result.excerpt!.length).toBeLessThanOrEqual(200)
  })

  it('extracts og:image', () => {
    const html = makeHtml(
      '<article><p>Content paragraph with enough text for readability to extract it properly. More text needed here.</p><p>Another paragraph of content.</p><p>Yet another paragraph.</p></article>',
      '<meta property="og:image" content="/images/hero.jpg">',
    )

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.ogImage).toBe('https://example.com/images/hero.jpg')
  })

  it('extracts og:title', () => {
    const html = makeHtml(
      '<article><p>Content paragraph with enough text for readability. More text needed here to ensure proper extraction by the algorithm.</p><p>Another paragraph.</p><p>Third paragraph.</p></article>',
      '<meta property="og:title" content="OG Title">',
    )

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.title).toBe('OG Title')
  })

  it('falls back to html title when og:title is missing', () => {
    const html = makeHtml(
      '<article><p>Content paragraph with enough text for readability. Needs more text for detection to work properly.</p><p>Another paragraph.</p><p>Third paragraph.</p></article>',
      '<title>HTML Title</title>',
    )

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.title).toBe('HTML Title')
  })

  it('throws when content cannot be extracted', () => {
    const html = makeHtml('<div></div>')
    expect(() => parseHtml({ html, articleUrl: BASE_URL })).toThrow('could not extract article')
  })

  it('returns null ogImage when no og:image meta tag', () => {
    const html = makeHtml(
      '<article><p>Long enough content for extraction. Padding the paragraph with extra text so readability picks it up properly.</p><p>More content.</p><p>Even more content.</p></article>',
    )

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.ogImage).toBeNull()
  })

  it('simplifies picture elements to img', () => {
    const html = makeHtml(`
      <article>
        <p>Article with enough text content to be detected by readability algorithm. This is a long paragraph.</p>
        <picture>
          <source srcset="/images/large.webp" type="image/webp">
          <img src="/images/fallback.jpg" alt="test">
        </picture>
        <p>Another paragraph with additional content to meet the length threshold for extraction.</p>
        <p>Third paragraph with even more text content.</p>
      </article>
    `)

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.fullText).toContain('fallback.jpg')
  })

  it('converts relative og:image URLs to absolute', () => {
    const html = makeHtml(
      '<article><p>Enough content for readability. Adding more text so the algorithm can properly detect this as the main content area of the page.</p><p>More text.</p><p>Even more text.</p></article>',
      '<meta property="og:image" content="relative/image.png">',
    )

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.ogImage).toContain('https://example.com/')
  })

  it('converts bare <pre> without <code> to fenced code blocks', () => {
    const html = makeHtml(`
      <article>
        <p>This article explains SSH commands with enough text for readability extraction.
        Adding more content to ensure proper detection by the algorithm.</p>
        <pre class="code lang-sh" data-lang="sh" data-unlink>ssh mike2</pre>
        <p>The above command logs into mike2. Here is a more complex example with pipes.</p>
        <pre class="code lang-sh" data-lang="sh" data-unlink><span class="synStatement">echo</span><span class="synConstant"> foo </span>| gzip | ssh mike2 sh <span class="synSpecial">-c</span> zcat</pre>
        <p>Third paragraph with additional content to meet the length threshold.</p>
      </article>
    `)

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.fullText).toContain('```sh\nssh mike2\n```')
    expect(result.fullText).toContain('```sh\necho foo | gzip | ssh mike2 sh -c zcat\n```')
  })

  it('generates excerpt under 200 characters', () => {
    const longText = 'word '.repeat(100)
    const html = makeHtml(`<article><p>${longText}</p><p>${longText}</p><p>${longText}</p></article>`)

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.excerpt!.length).toBeLessThanOrEqual(200)
  })

  it('strips markdown image tags from excerpt', () => {
    const html = makeHtml(`
      <article>
        <img src="https://example.com/hero.jpg" alt="hero image">
        <p>This is the actual article text that should appear in the excerpt.
        It contains multiple sentences to ensure Readability picks it up properly.</p>
        <p>Second paragraph with more content for the extraction algorithm.</p>
        <p>Third paragraph with even more text content to satisfy the length requirement.</p>
      </article>
    `)

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.excerpt).not.toContain('![')
    expect(result.excerpt).not.toContain('](')
    expect(result.excerpt).toContain('actual article text')
  })

  it('strips markdown link syntax from excerpt but keeps link text', () => {
    const html = makeHtml(`
      <article>
        <p><a href="https://example.com">Click here</a> to read more about this topic.
        The article continues with enough text for Readability to extract it as main content.</p>
        <p>Second paragraph with additional content to meet the length threshold.</p>
        <p>Third paragraph with even more text content.</p>
      </article>
    `)

    const result = parseHtml({ html, articleUrl: BASE_URL })
    expect(result.excerpt).not.toContain('[Click here]')
    expect(result.excerpt).toContain('Click here')
  })
})

// --- parseHtml with email: true (HTML email delivered inline by a feed) ---

describe('parseHtml email mode', () => {
  const para = '<p>' + 'A sentence of ordinary article prose, with a comma or two, that gives the extractor something to score. '.repeat(4) + '</p>'

  function emailHtml(body: string): string {
    return `<!DOCTYPE html><html><head><title>Issue</title><style>@media (max-width: 600px) { .post { width: 100%; } }</style></head>
      <body><table role="presentation"><tr><td><div class="post"><div class="body">${body}</div></div></td></tr></table></body></html>`
  }

  it('keeps a link-heavy block that default extraction drops', () => {
    const html = emailHtml(`${para}${para}
      <div class="callout-block"><h4>Links from this episode:</h4><p>
        <span>First workflow: </span><a href="https://example.com/a">https://example.com/workflows/the-first-workflow-walkthrough</a><br>
        <span>Second workflow: </span><a href="https://example.com/b">https://example.com/workflows/the-second-workflow-walkthrough</a><br>
        <span>Third workflow: </span><a href="https://example.com/c">https://example.com/workflows/the-third-workflow-walkthrough</a>
      </p></div>${para}`)

    expect(parseHtml({ html, articleUrl: BASE_URL }).fullText).not.toContain('the-first-workflow')

    const result = parseHtml({ html, articleUrl: BASE_URL, email: true })
    expect(result.fullText).toContain('#### Links from this episode:')
    expect(result.fullText).toContain('[https://example.com/workflows/the-third-workflow-walkthrough](https://example.com/c)')
  })

  it('unwraps layout tables, keeps data tables, and preserves section headings', () => {
    const html = emailHtml(`${para}
      <h2 class="header-anchor-post"><span>Pricing</span></h2>${para}
      <table class="image-wrapper"><tr><td></td><td><a href="https://example.com/full"><img src="https://example.com/chart.png" alt="Chart"></a></td><td></td></tr></table>
      <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$10</td></tr></table>${para}`)

    const result = parseHtml({ html, articleUrl: BASE_URL, email: true })

    expect(result.fullText).toContain('## Pricing')
    expect(result.fullText).toContain('[![Chart](https://example.com/chart.png)](https://example.com/full)')
    expect(result.fullText.match(/<table>/g)).toHaveLength(1)
    expect(result.fullText).toContain('<th>Plan</th>')
    expect(result.fullText).not.toContain('@media')
  })
})
