import type { NoteBody } from '@/lib/types'

/**
 * Wrap plain text into a minimal TipTap/ProseMirror document so agent- and
 * brief-generated text persists as a valid note body (jsonb). Blank lines split
 * paragraphs; single newlines become hard breaks. Pure — safe server & client.
 */
export function textToTipTapDoc(text: string): NoteBody {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return { type: 'doc', content: [{ type: 'paragraph' }] }
  const paragraphs = normalized.split(/\n{2,}/)
  const content = paragraphs.map((para) => {
    const lines = para.split('\n')
    const inline: Array<Record<string, unknown>> = []
    lines.forEach((line, i) => {
      if (i > 0) inline.push({ type: 'hardBreak' })
      if (line) inline.push({ type: 'text', text: line })
    })
    return inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' }
  })
  return { type: 'doc', content }
}
