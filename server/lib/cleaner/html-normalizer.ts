/**
 * HTML normalization module — clean up extracted article HTML structure.
 *
 * Ported from defuddle's standardize.ts with selected functions:
 *   - standardizeSpaces: \xA0 → space (skip pre/code)
 *   - removeHtmlComments: remove all Comment nodes
 *   - flattenWrapperElements: simplified div unwrapping
 *   - stripUnwantedAttributes: whitelist-based attribute removal (SVG protected)
 *   - removeEmptyElements: recursive empty element removal
 *   - stripExtraBrElements: limit consecutive <br> to 2
 */

export interface NormalizerOptions {
  allowedAttributes: Set<string>
  allowedEmptyElements: Set<string>
}

/**
 * Run all normalization steps in order on the given element.
 */
export function normalizeHtml(
  doc: Document,
  element: Element,
  options: NormalizerOptions,
): void {
  standardizeSpaces(element)
  removeHtmlComments(element)
  flattenWrapperElements(element, doc)
  stripUnwantedAttributes(element, options.allowedAttributes)
  removeEmptyElements(element, options.allowedEmptyElements)
  flattenWrapperElements(element, doc) // 2nd pass: re-flatten after empty removal
  stripExtraBrElements(element)
}

/**
 * Replace non-breaking spaces (\xA0) with regular spaces.
 * Skip <pre> and <code> elements where nbsp may be intentional.
 */
export function standardizeSpaces(element: Element): void {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    4, // NodeFilter.SHOW_TEXT
  )

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    if (isInsidePreOrCode(node)) continue
    if (node.textContent && node.textContent.includes('\u00A0')) {
      node.textContent = node.textContent.replace(/\u00A0/g, ' ')
    }
  }
}

/**
 * Remove all HTML comment nodes from the element tree.
 */
export function removeHtmlComments(element: Element): void {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    128, // NodeFilter.SHOW_COMMENT
  )

  const comments: Comment[] = []
  let node: Comment | null
  while ((node = walker.nextNode() as Comment | null)) {
    comments.push(node)
  }
  comments.forEach(c => c.remove())
}

/**
 * Simplified wrapper div flattening.
 * Handles two main cases:
 *   1. div with only block-level children → unwrap children to parent
 *   2. div with a single child element → replace div with child
 */
export function flattenWrapperElements(element: Element, doc: Document): void {
  const BLOCK_TAGS = new Set([
    'div', 'section', 'article', 'main', 'aside', 'header', 'footer',
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'blockquote', 'pre', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr',
    'details', 'summary', 'hr',
  ])

  // Process bottom-up to handle nested wrappers
  const divs = Array.from(element.querySelectorAll('div'))
  // Reverse so we process deepest first
  divs.reverse()

  for (const div of divs) {
    if (!div.parentNode) continue
    if (div === element) continue // Don't unwrap the root element itself

    const children = Array.from(div.childNodes)

    // Case 1: Single child element → replace div with child
    const childElements = children.filter(
      n => n.nodeType === 1, // ELEMENT_NODE
    ) as Element[]
    const textNodes = children.filter(
      n => n.nodeType === 3 && (n.textContent || '').trim() !== '', // Non-empty text
    )

    if (childElements.length === 1 && textNodes.length === 0) {
      div.replaceWith(childElements[0])
      continue
    }

    // Case 2: Only block-level children → unwrap
    if (children.length > 0 && children.every(n => {
      if (n.nodeType === 3) return (n.textContent || '').trim() === '' // whitespace text ok
      if (n.nodeType === 1) return BLOCK_TAGS.has((n as Element).tagName.toLowerCase())
      return true // comments etc.
    })) {
      const parent = div.parentNode
      const frag = doc.createDocumentFragment()
      while (div.firstChild) {
        frag.appendChild(div.firstChild)
      }
      parent.replaceChild(frag, div)
    }
  }
}

/**
 * Remove attributes not in the allowed set.
 * SVG elements and their descendants are skipped entirely.
 */
export function stripUnwantedAttributes(
  element: Element,
  allowedAttributes: Set<string>,
): void {
  const processElement = (el: Element) => {
    // Skip SVG elements
    const tag = el.tagName.toLowerCase()
    if (tag === 'svg' || el.namespaceURI === 'http://www.w3.org/2000/svg') return

    const attrs = Array.from(el.attributes)
    for (const attr of attrs) {
      if (!allowedAttributes.has(attr.name.toLowerCase())) {
        el.removeAttribute(attr.name)
      }
    }
  }

  processElement(element)
  element.querySelectorAll('*').forEach(el => {
    processElement(el)
  })
}

/**
 * Recursively remove empty elements.
 * Keeps elements in the allowed set (br, hr, img, etc.).
 * Re-runs until no more removals happen (parent may become empty after child removal).
 */
export function removeEmptyElements(
  element: Element,
  allowedEmptyElements: Set<string>,
): void {
  let keepRemoving = true
  while (keepRemoving) {
    keepRemoving = false
    const allElements = Array.from(element.querySelectorAll('*'))

    const toRemove = allElements.filter(el => {
      const tag = el.tagName.toLowerCase()
      if (allowedEmptyElements.has(tag)) return false

      // Check if effectively empty
      const hasOnlyWhitespace = (el.textContent || '').trim().length === 0
      const hasAllowedChild = Array.from(el.querySelectorAll('*')).some(
        child => allowedEmptyElements.has(child.tagName.toLowerCase()),
      )

      return hasOnlyWhitespace && !hasAllowedChild
    })

    if (toRemove.length > 0) {
      toRemove.forEach(el => {
        try {
          if (isInlineWordSeparator(el)) {
            // `<strong>A</strong><span> </span><em>B</em>` — the span is the
            // only whitespace between two inline runs. Dropping it outright
            // glues the neighbours together ("**A**_B_").
            el.replaceWith(el.ownerDocument.createTextNode(' '))
          } else {
            el.remove()
          }
        } catch {
          // Already removed as descendant
        }
      })
      keepRemoving = true
    }
  }
}

/**
 * Limit consecutive <br> elements to a maximum of 2.
 */
export function stripExtraBrElements(element: Element): void {
  const brs = Array.from(element.querySelectorAll('br'))

  let consecutiveCount = 0
  let prevBr: Element | null = null

  for (const br of brs) {
    // Check if this br is consecutive with the previous one
    if (prevBr && isConsecutiveBr(prevBr, br)) {
      consecutiveCount++
      if (consecutiveCount > 2) {
        br.remove()
        continue // Don't update prevBr
      }
    } else {
      consecutiveCount = 1
    }
    prevBr = br
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INLINE_TAGS = new Set([
  'span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sub', 'sup',
  'mark', 'font', 'abbr', 'cite', 'q', 'label',
])

/**
 * True for a whitespace-only inline element that sits between two sibling
 * nodes, i.e. one whose whitespace is acting as a word separator.
 */
function isInlineWordSeparator(el: Element): boolean {
  if (!INLINE_TAGS.has(el.tagName.toLowerCase())) return false
  if ((el.textContent || '').length === 0) return false
  return !!el.previousSibling && !!el.nextSibling
}

function isInsidePreOrCode(node: Node): boolean {
  let parent = node.parentNode
  while (parent) {
    if (parent.nodeType === 1) {
      const tag = (parent as Element).tagName.toLowerCase()
      if (tag === 'pre' || tag === 'code') return true
    }
    parent = parent.parentNode
  }
  return false
}

/**
 * Check if two <br> elements are consecutive (only whitespace text between them).
 */
function isConsecutiveBr(br1: Element, br2: Element): boolean {
  let node: Node | null = br1.nextSibling
  while (node && node !== br2) {
    if (node.nodeType === 1) return false // Element between them
    if (node.nodeType === 3 && (node.textContent || '').trim() !== '') return false // Non-empty text
    node = node.nextSibling
  }
  return node === br2
}
