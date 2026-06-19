import type { NoteBody } from '@/lib/types'

/**
 * Walk a TipTap / ProseMirror JSON document tree and collect all text
 * content into a single string. Used for global search matching against
 * note bodies — the body column stores JSON, so we need a plain-text
 * projection to match against.
 */
export function extractNoteText(body: NoteBody | null): string {
  if (!body || typeof body !== 'object') return ''
  const out: string[] = []
  function walk(n: unknown) {
    if (!n || typeof n !== 'object') return
    const node = n as Record<string, unknown>
    if (typeof node.text === 'string') out.push(node.text)
    // Surface attachment filenames so Cmd+K can find "that contract.pdf".
    if (node.type === 'fileAttachment' && node.attrs && typeof node.attrs === 'object') {
      const name = (node.attrs as Record<string, unknown>).name
      if (typeof name === 'string') out.push(name)
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c)
  }
  walk(body)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}
