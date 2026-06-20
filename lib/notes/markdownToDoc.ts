import { marked } from 'marked'
import type { NoteBody } from '@/lib/types'

/**
 * Convert Markdown to a TipTap / ProseMirror document so the agent can author
 * rich note bodies — headings, bold/italic/strike/code, bullet & numbered
 * lists, checkboxes (`- [ ]`/`- [x]`), blockquotes, fenced code, dividers, and
 * GitHub-pipe tables. The inverse of `noteMarkdown.ts`.
 *
 * Only node/mark types known to be in the editor schema are emitted (a node or
 * mark the schema doesn't know makes `Node.fromJSON` throw and breaks the whole
 * note), so: marks are limited to bold/italic/strike/code, and Markdown links
 * render as their plain label text (Link is not a registered mark). Inline
 * images are dropped to their alt text (the editor's image node needs a private
 * storage path, not a URL). Pure — safe on server and client.
 */

type Tok = Record<string, unknown>
type PM = Record<string, unknown>
type Mark = { type: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const arr = (v: unknown): Tok[] => (Array.isArray(v) ? (v as Tok[]) : [])
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)

function textNode(text: string, marks: Mark[]): PM {
  return marks.length ? { type: 'text', text, marks: marks.map(m => ({ type: m.type })) } : { type: 'text', text }
}

function inlineToPM(tokens: Tok[], marks: Mark[]): PM[] {
  const out: PM[] = []
  for (const tk of tokens) {
    const type = str(tk.type)
    if (type === 'text' || type === 'escape' || type === 'html') {
      // A "text" inline token may itself carry nested tokens (e.g. inside a link).
      const nested = arr(tk.tokens)
      if (nested.length) { out.push(...inlineToPM(nested, marks)); continue }
      const t = str(tk.text); if (t) out.push(textNode(t, marks))
    } else if (type === 'strong') out.push(...inlineToPM(arr(tk.tokens), [...marks, { type: 'bold' }]))
    else if (type === 'em') out.push(...inlineToPM(arr(tk.tokens), [...marks, { type: 'italic' }]))
    else if (type === 'del') out.push(...inlineToPM(arr(tk.tokens), [...marks, { type: 'strike' }]))
    else if (type === 'codespan') { const t = str(tk.text); if (t) out.push(textNode(t, [...marks, { type: 'code' }])) }
    else if (type === 'link') out.push(...inlineToPM(arr(tk.tokens), marks)) // render label only (no Link mark)
    else if (type === 'br') out.push({ type: 'hardBreak' })
    else if (type === 'image') { const alt = str(tk.text); if (alt) out.push(textNode(alt, marks)) }
    else {
      const nested = arr(tk.tokens)
      if (nested.length) out.push(...inlineToPM(nested, marks))
      else { const t = str(tk.text); if (t) out.push(textNode(t, marks)) }
    }
  }
  return out
}

function inlineOf(tk: Tok): PM[] {
  const toks = arr(tk.tokens)
  if (toks.length) return inlineToPM(toks, [])
  const t = str(tk.text)
  return t ? [textNode(t, [])] : []
}

function paragraph(inline: PM[]): PM {
  return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }
}

function listItemBlocks(item: Tok): PM[] {
  const blocks = blocksToPM(arr(item.tokens))
  return blocks.length ? blocks : [{ type: 'paragraph' }]
}

function listToPM(tk: Tok): PM {
  const items = arr(tk.items)
  const isTask = items.some(it => (it as Tok).task === true)
  if (isTask) {
    return {
      type: 'taskList',
      content: items.map(it => ({ type: 'taskItem', attrs: { checked: (it as Tok).checked === true }, content: listItemBlocks(it as Tok) })),
    }
  }
  const ordered = tk.ordered === true
  return {
    type: ordered ? 'orderedList' : 'bulletList',
    content: items.map(it => ({ type: 'listItem', content: listItemBlocks(it as Tok) })),
  }
}

function cellNode(type: 'tableHeader' | 'tableCell', cell: Tok): PM {
  return { type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [paragraph(inlineOf(cell))] }
}

function tableToPM(tk: Tok): PM | null {
  const header = arr(tk.header)
  if (!header.length) return null
  const cols = header.length
  const headRow = { type: 'tableRow', content: header.map(c => cellNode('tableHeader', c)) }
  const bodyRows = arr(tk.rows).map(r => {
    const cells = arr(r).slice(0, cols).map(c => cellNode('tableCell', c))
    while (cells.length < cols) cells.push(cellNode('tableCell', {}))
    return { type: 'tableRow', content: cells }
  })
  return { type: 'table', content: [headRow, ...bodyRows] }
}

function blocksToPM(tokens: Tok[]): PM[] {
  const out: PM[] = []
  for (const tk of tokens) {
    const type = str(tk.type)
    switch (type) {
      case 'space':
      case 'html':
        break
      case 'heading':
        out.push({ type: 'heading', attrs: { level: Math.min(6, Math.max(1, num(tk.depth) || 1)) }, content: inlineOf(tk) })
        break
      case 'paragraph':
      case 'text':
        out.push(paragraph(inlineOf(tk)))
        break
      case 'hr':
        out.push({ type: 'horizontalRule' })
        break
      case 'blockquote': {
        const inner = blocksToPM(arr(tk.tokens))
        out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] })
        break
      }
      case 'code': {
        const t = str(tk.text)
        out.push({ type: 'codeBlock', attrs: { language: str(tk.lang) || null }, content: t ? [{ type: 'text', text: t }] : [] })
        break
      }
      case 'list':
        out.push(listToPM(tk))
        break
      case 'table': {
        const tbl = tableToPM(tk)
        if (tbl) out.push(tbl)
        break
      }
      default: {
        const inline = inlineOf(tk)
        if (inline.length) out.push(paragraph(inline))
      }
    }
  }
  return out
}

export function markdownToTipTapDoc(md: string): NoteBody {
  const src = String(md ?? '').replace(/\r\n/g, '\n')
  if (!src.trim()) return { type: 'doc', content: [{ type: 'paragraph' }] }
  let blocks: PM[]
  try {
    blocks = blocksToPM(marked.lexer(src) as unknown as Tok[])
  } catch {
    // Fall back to plain paragraphs (blank line = paragraph, single \n = break).
    blocks = src.split(/\n{2,}/).map(p => {
      const lines = p.split('\n')
      const inline: PM[] = []
      lines.forEach((line, i) => { if (i > 0) inline.push({ type: 'hardBreak' }); if (line) inline.push(textNode(line, [])) })
      return paragraph(inline)
    })
  }
  if (!blocks.length) blocks = [{ type: 'paragraph' }]
  return { type: 'doc', content: blocks }
}
