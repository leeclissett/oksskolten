import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { isLayoutTable, prepareEmailDocument, protectHeadings, unwrapLayoutTables } from './email.js'

function docOf(html: string): Document {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window.document
}

function firstTable(html: string): HTMLTableElement {
  return docOf(html).querySelector('table') as HTMLTableElement
}

describe('isLayoutTable', () => {
  it('treats role="presentation" as layout', () => {
    expect(isLayoutTable(firstTable('<table role="presentation"><tr><td>A</td><td>B</td></tr></table>'))).toBe(true)
  })

  it('treats a table that wraps another table as layout', () => {
    expect(isLayoutTable(firstTable(
      '<table><tr><td>A</td><td><table><tr><td>1</td><td>2</td></tr></table></td></tr></table>',
    ))).toBe(true)
  })

  it('treats a spacer / image / spacer row as layout', () => {
    expect(isLayoutTable(firstTable(
      '<table><tr><td></td><td><a href="/x"><img src="/x.png"></a></td><td>&nbsp;</td></tr></table>',
    ))).toBe(true)
  })

  it('treats a single-column table as layout', () => {
    expect(isLayoutTable(firstTable('<table><tr><td>One</td></tr><tr><td>Two</td></tr></table>'))).toBe(true)
  })

  it('treats a single-row table (icon beside a label) as layout', () => {
    expect(isLayoutTable(firstTable('<table><tr><td><img src="/icon.png"></td><td><a href="/x">Label</a></td></tr></table>'))).toBe(true)
  })

  it('ignores invisible preheader padding when counting cells with content', () => {
    expect(isLayoutTable(firstTable(
      '<table><tr><td>\u034F \u00A0\u2007\u00AD</td><td>One</td></tr><tr><td>\u034F</td><td>Two</td></tr></table>',
    ))).toBe(true)
  })

  it('treats a multi-column table as data', () => {
    expect(isLayoutTable(firstTable('<table><tr><td>Plan</td><td>Price</td></tr><tr><td>Pro</td><td>$10</td></tr></table>'))).toBe(false)
  })

  it('treats any table with header cells as data', () => {
    expect(isLayoutTable(firstTable('<table><tr><th>Plan</th></tr><tr><td>Pro</td></tr></table>'))).toBe(false)
  })
})

describe('unwrapLayoutTables', () => {
  it('replaces nested layout tables with their content, in document order', () => {
    const doc = docOf(`
      <table role="presentation"><tr><td>
        <table><tr><td><p>First paragraph.</p></td></tr></table>
        <table class="image-wrapper"><tr><td></td><td><a href="https://example.com/p"><img src="https://example.com/a.png"></a></td><td></td></tr></table>
        <table><tr><td><p>Second paragraph.</p></td></tr></table>
      </td></tr></table>`)

    expect(unwrapLayoutTables(doc)).toBe(4)
    expect(doc.querySelector('table, tr, td')).toBeNull()
    expect(doc.querySelectorAll('img')).toHaveLength(1)
    expect(doc.querySelector('a')!.getAttribute('href')).toBe('https://example.com/p')
    expect(doc.body.textContent!.replace(/\s+/g, ' ').trim()).toBe('First paragraph. Second paragraph.')
  })

  it('keeps a data table that sits inside a layout table', () => {
    const doc = docOf(`
      <table role="presentation"><tr><td>
        <p>Intro</p>
        <table id="data"><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$10</td></tr></table>
      </td></tr></table>`)

    expect(unwrapLayoutTables(doc)).toBe(1)
    expect(doc.querySelectorAll('table')).toHaveLength(1)
    expect(doc.querySelector('#data')!.querySelectorAll('td, th')).toHaveLength(4)
    expect(doc.body.textContent).toContain('Intro')
  })

  it('leaves a document without layout tables untouched', () => {
    const doc = docOf('<p>Text</p><table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>')
    const before = doc.body.innerHTML
    expect(unwrapLayoutTables(doc)).toBe(0)
    expect(doc.body.innerHTML).toBe(before)
  })
})

describe('protectHeadings', () => {
  const para = '<p>' + 'A sentence of ordinary article prose that gives the extractor something to score. '.repeat(4) + '</p>'
  const html = `<!DOCTYPE html><html><body><div class="post"><div class="body">
    ${para}<h2 class="header-anchor-post" id="s1"><span>First section</span></h2>${para}
    <h3 class="header-anchor-post"><span>A subsection</span></h3>${para}
  </div></div></body></html>`

  function extractedHeadings(prepare: boolean): string[] {
    const dom = new JSDOM(html, { url: 'https://example.com/' })
    if (prepare) protectHeadings(dom.window.document)
    const article = new Readability(dom.window.document).parse()!
    const out = new JSDOM(article.content!).window.document
    return Array.from(out.querySelectorAll('h2, h3')).map(h => h.textContent!.trim())
  }

  it('documents the problem: Readability drops headings classed "header-anchor-post"', () => {
    expect(extractedHeadings(false)).toEqual([])
  })

  it('keeps section headings through extraction once their class is removed', () => {
    expect(extractedHeadings(true)).toEqual(['First section', 'A subsection'])
  })

  it('keeps the first <h1> as the title and moves other headings down a level when <h1> is used for sections', () => {
    const doc = docOf(`
      <h1 class="post-title">Issue title</h1>
      <h2 class="header-anchor-post">Intro section</h2>
      <h1 class="header-anchor-post">Top threads</h1>
      <h2 class="header-anchor-post">1. A thread</h2>
      <h5>Deep</h5><h6>Deepest</h6>`)
    protectHeadings(doc)
    const outline = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => `${h.tagName} ${h.textContent}`)
    expect(outline).toEqual(['H1 Issue title', 'H3 Intro section', 'H2 Top threads', 'H3 1. A thread', 'H6 Deep', 'H6 Deepest'])
    expect(doc.querySelector('h2')!.hasAttribute('class')).toBe(false)
  })

  it('leaves <h1> and non-heading elements untouched', () => {
    const doc = docOf('<h1 class="post-title" id="t">Title</h1><p class="lead" id="p">Text</p><h4 class="x" id="y">Sub</h4>')
    protectHeadings(doc)
    expect(doc.querySelector('h1')!.getAttribute('class')).toBe('post-title')
    expect(doc.querySelector('p')!.getAttribute('id')).toBe('p')
    expect(doc.querySelector('h4')!.attributes).toHaveLength(0)
  })
})

describe('prepareEmailDocument', () => {
  it('unwraps layout tables and protects headings in one pass', () => {
    const doc = docOf('<table role="presentation"><tr><td><h2 class="header-anchor-post">Section</h2><p>Text</p></td></tr></table>')
    prepareEmailDocument(doc)
    expect(doc.querySelector('table')).toBeNull()
    expect(doc.querySelector('h2')!.hasAttribute('class')).toBe(false)
  })
})
