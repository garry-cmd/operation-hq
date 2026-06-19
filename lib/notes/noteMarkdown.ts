import type { NoteBody } from '@/lib/types'

/**
 * Convert a TipTap / ProseMirror JSON document to Markdown for export.
 * Covers everything the editor can produce: headings, lists, task lists,
 * blockquotes, code blocks, rules, tables, images and attachments. Inline
 * marks (bold/italic/strike/code/link) are rendered too. Internal `[[ ]]`
 * links are literal text already, so they pass through untouched.
 *
 * Images and attachments reference the private storage path (not a public
 * URL), so they export as `![](path)` / `[name](path)` placeholders — enough
 * to identify them, but not to render outside the app.
 */

type Node = Record<string, unknown>

function isNode(n: unknown): n is Node {
  return !!n && typeof n === 'object'
}

function children(n: Node): Node[] {
  return Array.isArray(n.content) ? (n.content as unknown[]).filter(isNode) : []
}

function inlineText(nodes: Node[]): string {
  return nodes.map(inlineNode).join('')
}

function inlineNode(n: Node): string {
  if (n.type === 'hardBreak') return '  \n'
  if (n.type === 'image') {
    const path = (n.attrs as Node | undefined)?.path
    return `![](${typeof path === 'string' ? path : ''})`
  }
  if (typeof n.text === 'string') {
    let t = n.text
    const marks = Array.isArray(n.marks) ? (n.marks as Node[]) : []
    // Innermost first: code wraps tightest, link outermost.
    for (const mark of marks) {
      if (mark.type === 'code') t = '`' + t + '`'
    }
    for (const mark of marks) {
      if (mark.type === 'bold') t = '**' + t + '**'
      else if (mark.type === 'italic') t = '_' + t + '_'
      else if (mark.type === 'strike') t = '~~' + t + '~~'
    }
    for (const mark of marks) {
      if (mark.type === 'link') {
        const href = (mark.attrs as Node | undefined)?.href
        if (typeof href === 'string') t = `[${t}](${href})`
      }
    }
    return t
  }
  // Unknown inline → recurse into any content.
  return inlineText(children(n))
}

function cellText(cell: Node): string {
  // A table cell holds blocks; flatten to single-line inline text.
  return children(cell)
    .map(b => inlineText(children(b)))
    .join(' ')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim()
}

function listBlock(n: Node, ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  children(n).forEach((item, i) => {
    const isTask = item.type === 'taskItem'
    const checked = (item.attrs as Node | undefined)?.checked === true
    const marker = isTask ? `- [${checked ? 'x' : ' '}] ` : ordered ? `${i + 1}. ` : '- '
    const blocks = children(item)
    // First block on the marker line; subsequent blocks/nested lists indented.
    blocks.forEach((b, bi) => {
      if (b.type === 'bulletList' || b.type === 'orderedList' || b.type === 'taskList') {
        lines.push(listBlock(b, b.type === 'orderedList', depth + 1))
      } else if (bi === 0) {
        lines.push(indent + marker + inlineText(children(b)))
      } else {
        lines.push(indent + '  ' + inlineText(children(b)))
      }
    })
    if (blocks.length === 0) lines.push(indent + marker)
  })
  return lines.join('\n')
}

function blockToMd(n: Node): string {
  switch (n.type) {
    case 'paragraph':
      return inlineText(children(n))
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number((n.attrs as Node | undefined)?.level ?? 1)))
      return '#'.repeat(level) + ' ' + inlineText(children(n))
    }
    case 'bulletList':
      return listBlock(n, false, 0)
    case 'orderedList':
      return listBlock(n, true, 0)
    case 'taskList':
      return listBlock(n, false, 0)
    case 'blockquote':
      return children(n)
        .map(blockToMd)
        .join('\n\n')
        .split('\n')
        .map(l => '> ' + l)
        .join('\n')
    case 'codeBlock': {
      const lang = (n.attrs as Node | undefined)?.language
      const code = children(n)
        .map(c => (typeof c.text === 'string' ? c.text : ''))
        .join('')
      return '```' + (typeof lang === 'string' ? lang : '') + '\n' + code + '\n```'
    }
    case 'horizontalRule':
      return '---'
    case 'image': {
      const path = (n.attrs as Node | undefined)?.path
      return `![](${typeof path === 'string' ? path : ''})`
    }
    case 'fileAttachment': {
      const a = (n.attrs as Node | undefined) ?? {}
      const name = typeof a.name === 'string' ? a.name : 'attachment'
      const path = typeof a.path === 'string' ? a.path : ''
      return `[${name}](${path})`
    }
    case 'table': {
      const rows = children(n)
      if (rows.length === 0) return ''
      const matrix = rows.map(r => children(r).map(cellText))
      const cols = Math.max(...matrix.map(r => r.length))
      const pad = (r: string[]) => {
        const c = [...r]
        while (c.length < cols) c.push('')
        return c
      }
      const head = pad(matrix[0])
      const out = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`]
      for (let i = 1; i < matrix.length; i++) out.push(`| ${pad(matrix[i]).join(' | ')} |`)
      return out.join('\n')
    }
    default:
      // Unknown block: try inline projection.
      return inlineText(children(n))
  }
}

export function noteToMarkdown(title: string, body: NoteBody | null): string {
  const blocks = isNode(body) ? children(body) : []
  const parts: string[] = []
  const t = (title || '').trim()
  if (t) parts.push(`# ${t}`)
  for (const b of blocks) {
    const md = blockToMd(b).replace(/\s+$/g, '')
    parts.push(md) // keep blank blocks as spacing
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
