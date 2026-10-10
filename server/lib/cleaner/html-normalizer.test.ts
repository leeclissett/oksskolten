import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  normalizeHtml,
  standardizeSpaces,
  removeHtmlComments,
  flattenWrapperElements,
  stripUnwantedAttributes,
  removeEmptyElements,
  stripExtraBrElements,
} from './html-normalizer.js'
import { ALLOWED_ATTRIBUTES, ALLOWED_EMPTY_ELEMENTS } from './selectors.js'

function dom(html: string) {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`)
}

function bodyEl(html: string) {
  const d = dom(html)
  return { doc: d.window.document, body: d.window.document.body }
}

// ---------------------------------------------------------------------------
// standardizeSpaces
// ---------------------------------------------------------------------------
describe('standardizeSpaces', () => {
  it('replaces nbsp with regular space', () => {
    const { body } = bodyEl('<p>Hello\u00A0world</p>')
    standardizeSpaces(body)
    expect(body.textContent).toBe('Hello world')
  })

  it('replaces multiple nbsp', () => {
    const { body } = bodyEl('<p>A\u00A0\u00A0B</p>')
    standardizeSpaces(body)
    expect(body.textContent).toBe('A  B')
  })

  it('preserves nbsp inside <pre>', () => {
    const { body } = bodyEl('<pre>code\u00A0here</pre>')
    standardizeSpaces(body)
    expect(body.textContent).toContain('\u00A0')
  })

  it('preserves nbsp inside <code>', () => {
    const { body } = bodyEl('<code>x\u00A0=\u00A01</code>')
    standardizeSpaces(body)
    expect(body.textContent).toContain('\u00A0')
  })

  it('handles nested pre/code', () => {
    const { body } = bodyEl('<pre><code>keep\u00A0this</code></pre><p>fix\u00A0this</p>')
    standardizeSpaces(body)
    expect(body.querySelector('code')!.textContent).toContain('\u00A0')
    expect(body.querySelector('p')!.textContent).toBe('fix this')
  })

  it('handles elements without nbsp', () => {
    const { body } = bodyEl('<p>Normal text</p>')
    standardizeSpaces(body)
    expect(body.textContent).toBe('Normal text')
  })
})

// ---------------------------------------------------------------------------
// removeHtmlComments
// ---------------------------------------------------------------------------
describe('removeHtmlComments', () => {
  it('removes HTML comments', () => {
    const { body } = bodyEl('<p>text</p><!-- comment -->')
    removeHtmlComments(body)
    expect(body.innerHTML).not.toContain('comment')
    expect(body.textContent).toContain('text')
  })

  it('removes multiple comments', () => {
    const { body } = bodyEl('<!-- first --><p>text</p><!-- second -->')
    removeHtmlComments(body)
    const html = body.innerHTML
    expect(html).not.toContain('first')
    expect(html).not.toContain('second')
  })

  it('handles no comments', () => {
    const { body } = bodyEl('<p>no comments</p>')
    removeHtmlComments(body)
    expect(body.textContent).toBe('no comments')
  })
})

// ---------------------------------------------------------------------------
// flattenWrapperElements
// ---------------------------------------------------------------------------
describe('flattenWrapperElements', () => {
  it('unwraps div with single child element', () => {
    const { doc, body } = bodyEl('<div><p>content</p></div>')
    flattenWrapperElements(body, doc)
    // The div should be replaced with the <p> directly
    expect(body.querySelector('div')).toBeNull()
    expect(body.querySelector('p')!.textContent).toBe('content')
  })

  it('unwraps div with only block children', () => {
    const { doc, body } = bodyEl('<div><p>one</p><p>two</p></div>')
    flattenWrapperElements(body, doc)
    const ps = body.querySelectorAll('p')
    expect(ps.length).toBe(2)
  })

  it('does not unwrap div with mixed inline + block content', () => {
    const { doc, body } = bodyEl('<div>inline text<p>block</p></div>')
    flattenWrapperElements(body, doc)
    // Should keep the div since it has non-empty text nodes + block elements
    expect(body.querySelector('div')).not.toBeNull()
  })

  it('handles nested wrappers', () => {
    const { doc, body } = bodyEl('<div><div><p>deep</p></div></div>')
    flattenWrapperElements(body, doc)
    expect(body.querySelector('p')!.textContent).toBe('deep')
  })

  it('preserves divs with meaningful content', () => {
    const { doc, body } = bodyEl('<div>This is actual content text.</div>')
    flattenWrapperElements(body, doc)
    expect(body.textContent).toContain('This is actual content text.')
  })
})

// ---------------------------------------------------------------------------
// stripUnwantedAttributes
// ---------------------------------------------------------------------------
describe('stripUnwantedAttributes', () => {
  it('removes non-allowed attributes', () => {
    const { body } = bodyEl('<p class="foo" data-tracking="bar" id="baz">text</p>')
    stripUnwantedAttributes(body, ALLOWED_ATTRIBUTES)
    const p = body.querySelector('p')!
    expect(p.hasAttribute('class')).toBe(false)
    expect(p.hasAttribute('data-tracking')).toBe(false)
    expect(p.hasAttribute('id')).toBe(false)
  })

  it('keeps allowed attributes', () => {
    const { body } = bodyEl('<a href="https://example.com" title="Link">text</a>')
    stripUnwantedAttributes(body, ALLOWED_ATTRIBUTES)
    const a = body.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com')
    expect(a.getAttribute('title')).toBe('Link')
  })

  it('keeps src and alt on images', () => {
    const { body } = bodyEl('<img src="/photo.jpg" alt="Photo" class="hero" data-x="1">')
    stripUnwantedAttributes(body, ALLOWED_ATTRIBUTES)
    const img = body.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/photo.jpg')
    expect(img.getAttribute('alt')).toBe('Photo')
    expect(img.hasAttribute('class')).toBe(false)
    expect(img.hasAttribute('data-x')).toBe(false)
  })

  it('skips SVG elements entirely', () => {
    const { body } = bodyEl('<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="red"/></svg>')
    stripUnwantedAttributes(body, ALLOWED_ATTRIBUTES)
    const svg = body.querySelector('svg')!
    expect(svg.hasAttribute('viewBox')).toBe(true)
  })

  it('processes nested elements', () => {
    const { body } = bodyEl('<div class="wrapper"><p onclick="alert(1)" data-foo="x">text</p></div>')
    stripUnwantedAttributes(body, ALLOWED_ATTRIBUTES)
    const p = body.querySelector('p')!
    expect(p.hasAttribute('onclick')).toBe(false)
    expect(p.hasAttribute('data-foo')).toBe(false)
  })

  it('keeps width and height on media', () => {
    const { body } = bodyEl('<iframe src="/embed" width="640" height="360" data-extra="x"></iframe>')
    stripUnwantedAttributes(body, ALLOWED_ATTRIBUTES)
    const iframe = body.querySelector('iframe')!
    expect(iframe.getAttribute('width')).toBe('640')
    expect(iframe.getAttribute('height')).toBe('360')
    expect(iframe.hasAttribute('data-extra')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// removeEmptyElements
// ---------------------------------------------------------------------------
describe('removeEmptyElements', () => {
  it('removes empty divs', () => {
    const { body } = bodyEl('<div></div><p>content</p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('div')).toHaveLength(0)
    expect(body.textContent).toContain('content')
  })

  it('removes whitespace-only elements', () => {
    const { body } = bodyEl('<div>   \n  </div><p>text</p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('div')).toHaveLength(0)
  })

  it('keeps the word break when a whitespace-only inline element separates two runs', () => {
    const { body } = bodyEl('<p><strong>Title</strong><span> </span><em>(Author)</em></p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('span')).toHaveLength(0)
    expect(body.querySelector('p')!.textContent).toBe('Title (Author)')
  })

  it('does not add whitespace for an empty inline element or one at the edge of its parent', () => {
    const { body } = bodyEl('<p><span> </span>Start<span></span>End<span> </span></p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelector('p')!.textContent).toBe('StartEnd')
  })

  it('removes recursively (parent becomes empty after child removal)', () => {
    const { body } = bodyEl('<div><span></span></div><p>text</p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('div')).toHaveLength(0)
    expect(body.querySelectorAll('span')).toHaveLength(0)
  })

  it('preserves allowed empty elements (br, hr, img)', () => {
    const { body } = bodyEl('<br><hr><img src="/x.jpg"><p>text</p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('br')).toHaveLength(1)
    expect(body.querySelectorAll('hr')).toHaveLength(1)
    expect(body.querySelectorAll('img')).toHaveLength(1)
  })

  it('preserves elements containing allowed empty children', () => {
    const { body } = bodyEl('<div><img src="/x.jpg"></div><p>text</p>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('div')).toHaveLength(1)
  })

  it('preserves elements with text', () => {
    const { body } = bodyEl('<div>has text</div>')
    removeEmptyElements(body, ALLOWED_EMPTY_ELEMENTS)
    expect(body.querySelectorAll('div')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// stripExtraBrElements
// ---------------------------------------------------------------------------
describe('stripExtraBrElements', () => {
  it('allows up to 2 consecutive br elements', () => {
    const { body } = bodyEl('<p>text</p><br><br>')
    stripExtraBrElements(body)
    expect(body.querySelectorAll('br')).toHaveLength(2)
  })

  it('removes br beyond 2 consecutive', () => {
    const { body } = bodyEl('<p>text</p><br><br><br><br><br>')
    stripExtraBrElements(body)
    expect(body.querySelectorAll('br')).toHaveLength(2)
  })

  it('resets count for non-consecutive br', () => {
    const { body } = bodyEl('<br><br><p>text</p><br><br>')
    stripExtraBrElements(body)
    expect(body.querySelectorAll('br')).toHaveLength(4)
  })

  it('handles single br', () => {
    const { body } = bodyEl('<p>text</p><br>')
    stripExtraBrElements(body)
    expect(body.querySelectorAll('br')).toHaveLength(1)
  })

  it('handles no br', () => {
    const { body } = bodyEl('<p>text</p>')
    stripExtraBrElements(body)
    expect(body.querySelectorAll('br')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// normalizeHtml (integration)
// ---------------------------------------------------------------------------
describe('normalizeHtml', () => {
  it('runs all normalization steps', () => {
    const { doc, body } = bodyEl(
      '<!-- comment -->' +
      '<div class="wrapper" onclick="alert(1)">' +
      '  <p>Hello\u00A0world</p>' +
      '  <div></div>' +
      '  <br><br><br><br>' +
      '</div>',
    )
    normalizeHtml(doc, body, {
      allowedAttributes: ALLOWED_ATTRIBUTES,
      allowedEmptyElements: ALLOWED_EMPTY_ELEMENTS,
    })

    const html = body.innerHTML
    expect(html).not.toContain('comment')      // comments removed
    expect(html).not.toContain('\u00A0')        // nbsp normalized
    expect(html).not.toContain('onclick')       // unwanted attrs removed
    expect(html).not.toContain('class')         // wrapper class removed
    expect(body.textContent).toContain('Hello world')  // content preserved
  })

  it('preserves article structure', () => {
    const { doc, body } = bodyEl(
      '<h2>Title</h2>' +
      '<p>First paragraph with content.</p>' +
      '<pre><code>const x = 1;</code></pre>' +
      '<p>Second paragraph.</p>' +
      '<img src="/photo.jpg" alt="Photo">' +
      '<table><tr><td>Cell</td></tr></table>',
    )
    normalizeHtml(doc, body, {
      allowedAttributes: ALLOWED_ATTRIBUTES,
      allowedEmptyElements: ALLOWED_EMPTY_ELEMENTS,
    })

    expect(body.querySelector('h2')).not.toBeNull()
    expect(body.querySelectorAll('p').length).toBe(2)
    expect(body.querySelector('pre')).not.toBeNull()
    expect(body.querySelector('img')).not.toBeNull()
    expect(body.querySelector('table')).not.toBeNull()
  })

  it('handles empty body gracefully', () => {
    const { doc, body } = bodyEl('')
    expect(() =>
      normalizeHtml(doc, body, {
        allowedAttributes: ALLOWED_ATTRIBUTES,
        allowedEmptyElements: ALLOWED_EMPTY_ELEMENTS,
      }),
    ).not.toThrow()
  })
})
