/**
 * Emphasis cleanup utilities for translated Markdown.
 *
 * Translation APIs can produce CJK punctuation at bold boundaries or
 * orphaned emphasis markers. These helpers fix common issues.
 */

// ---------------------------------------------------------------------------
// Emphasis cleanup
// ---------------------------------------------------------------------------

// CJK punctuation that breaks GFM bold when adjacent to **
const CJK_OPEN_PUNCT = '「『（【〈《〔｛＜'
const CJK_CLOSE_PUNCT = '」』）】〉》〕｝＞'
const CJK_MID_PUNCT = '。、！？・：；〜～…─―ー'
const CJK_PUNCT = `[${CJK_OPEN_PUNCT}${CJK_CLOSE_PUNCT}${CJK_MID_PUNCT}]`

/**
 * Fix CJK punctuation at ** boundaries that prevents GFM bold rendering.
 *
 * CommonMark spec: opening ** followed by Unicode punctuation (without
 * being preceded by punctuation/whitespace) is NOT left-flanking and
 * cannot open emphasis. Similarly for closing ** preceded by punctuation.
 *
 * Fix by moving CJK punctuation from inside bold boundaries to outside.
 */
export function fixBoldBoundaries(text: string): string {
  // Remove bold that wraps only punctuation/whitespace: **。** → 。
  text = text.replace(new RegExp(`\\*\\*(${CJK_PUNCT}+)\\*\\*`, 'g'), '$1')

  // Move trailing CJK punctuation outside closing **:
  // **text。** → **text**。
  text = text.replace(new RegExp(`\\*\\*([^*]+?)(${CJK_PUNCT}+)\\*\\*`, 'g'), '**$1**$2')

  // Move leading CJK opening punctuation outside opening **:
  // **「text** → 「**text**
  text = text.replace(new RegExp(`\\*\\*([${CJK_OPEN_PUNCT}]+)([^*]+?)\\*\\*`, 'g'), '$1**$2**')

  // Remove empty bold markers left over
  text = text.replace(/\*\*\*\*/g, '')

  // marked bug: **[text](url)**rest fails to render bold when ** wraps
  // only a link and more text follows. Fix by moving bold inside the link:
  // **[text](url)** → [**text**](url)
  text = text.replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, '[**$1**]($2)')

  return text
}

/**
 * Remove unpaired ** or * markers that don't form valid bold/italic.
 * Works per-line to avoid cross-line mismatches.
 */
export function fixUnpairedEmphasis(text: string): string {
  return text.split('\n').map(line => {
    // Fix bold: count ** occurrences; if odd, remove the last one
    const boldParts = line.split('**')
    if (boldParts.length % 2 === 0) {
      // Odd number of ** markers — remove trailing unpaired one
      // Find the last ** and remove it
      const lastIdx = line.lastIndexOf('**')
      if (lastIdx >= 0) {
        line = line.substring(0, lastIdx) + line.substring(lastIdx + 2)
      }
    }
    return line
  }).join('\n')
}
