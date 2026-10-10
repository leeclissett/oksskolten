/**
 * Preparation for HTML email delivered inline by a feed (e.g. a newsletter
 * relayed by a mail-to-feed bridge), applied before article extraction.
 *
 * Layout tables: email markup uses <table> for page layout. The whole message
 * is a stack of nested tables, and each image sits in its own three-cell table
 * (spacer, image, spacer). The article pipeline keeps tables as raw HTML so
 * that real data tables survive Markdown conversion, which means layout tables
 * would leak into the article as literal <table> markup.
 *
 * Headings: Readability discards "unlikely candidates" by class name, and
 * Substack marks every section heading `header-anchor-post`, which matches
 * its `header` pattern. It also deletes every <h1>. Without intervention an
 * issue loses all its headings.
 */

const CONTENT_SELECTOR = 'img, picture, video, audio, iframe, svg'

/** Invisible padding characters used by email preheaders and spacer cells. */
const INVISIBLE_RE = /[\s\u00A0\u00AD\u034F\u200B-\u200D\u2007\u2060\uFEFF]/g

function hasContent(cell: Element): boolean {
  if ((cell.textContent || '').replace(INVISIBLE_RE, '').length > 0) return true
  return cell.querySelector(CONTENT_SELECTOR) !== null
}

/** Rows and cells that belong to this table, not to a table nested inside it. */
function ownRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.rows)
}

function ownCells(table: HTMLTableElement): HTMLTableCellElement[] {
  return ownRows(table).flatMap(row => Array.from(row.cells))
}

/**
 * A table is treated as layout when it is explicitly presentational, wraps
 * another table, has a single row (an icon beside a label, a button), or
 * never puts content in more than one cell of a row.
 * A table with header cells is always treated as data.
 */
export function isLayoutTable(table: HTMLTableElement): boolean {
  const role = table.getAttribute('role')
  if (role === 'presentation' || role === 'none') return true
  if (ownCells(table).some(cell => cell.tagName === 'TH')) return false
  if (table.querySelector('table')) return true
  const rows = ownRows(table)
  if (rows.length < 2) return true
  return rows.every(row => Array.from(row.cells).filter(hasContent).length <= 1)
}

/**
 * Replace every layout table in the document with <div> wrappers holding the
 * contents of its non-empty cells. Data tables are left untouched.
 * Returns the number of tables unwrapped.
 */
export function unwrapLayoutTables(doc: Document): number {
  // Classify against the original tree, then unwrap deepest-first so that an
  // outer table's cells already hold their unwrapped inner content.
  const layoutTables = Array.from(doc.querySelectorAll('table')).filter(isLayoutTable).reverse()

  for (const table of layoutTables) {
    const wrapper = doc.createElement('div')
    for (const cell of ownCells(table)) {
      if (!hasContent(cell)) continue
      const block = doc.createElement('div')
      while (cell.firstChild) block.appendChild(cell.firstChild)
      wrapper.appendChild(block)
    }
    table.replaceWith(wrapper)
  }

  return layoutTables.length
}

/**
 * Keep section headings through extraction.
 *
 *  - Strip class and id from <h2>–<h6> so they are judged by position in the
 *    article, not by a class name chosen for styling.
 *  - Readability deletes every <h1>, on the assumption that it repeats the
 *    title. Newsletters also use <h1> for sections inside the body, so when a
 *    message has more than one, keep the first as the title and move every
 *    other heading down a level, which preserves the hierarchy.
 */
export function protectHeadings(doc: Document): void {
  const [, ...sectionH1s] = Array.from(doc.querySelectorAll('h1'))
  if (sectionH1s.length > 0) {
    const sectionH1Set = new Set<Element>(sectionH1s)
    for (const heading of Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5'))) {
      const level = Number(heading.tagName[1])
      if (level === 1 && !sectionH1Set.has(heading)) continue
      const demoted = doc.createElement(`h${level + 1}`)
      while (heading.firstChild) demoted.appendChild(heading.firstChild)
      heading.replaceWith(demoted)
    }
  }

  for (const heading of doc.querySelectorAll('h2, h3, h4, h5, h6')) {
    heading.removeAttribute('class')
    heading.removeAttribute('id')
  }
}

/** Apply every email-specific preparation step to the document. */
export function prepareEmailDocument(doc: Document): void {
  unwrapLayoutTables(doc)
  protectHeadings(doc)
}

// Substack puts the post's public address on the header buttons of every
// email ("Read in app", restack). The query string carries per-recipient
// tracking tokens, so only the path is kept.
const SUBSTACK_POST_RE = /href="(https:\/\/open\.substack\.com\/pub\/[\w-]+\/p\/[\w%-]+)/i

/**
 * Find the web address of the post an email was sent for, if the email
 * carries one in a form that can be recognised reliably. Returns null
 * otherwise: a wrong link is worse than none.
 */
export function extractEmailSourceUrl(html: string): string | null {
  return SUBSTACK_POST_RE.exec(html)?.[1] ?? null
}
