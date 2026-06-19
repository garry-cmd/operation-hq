import type { NoteBody } from '@/lib/types'

/**
 * Walk a TipTap / ProseMirror JSON document and collect every private
 * storage `path` referenced by an image or file-attachment node. Both node
 * types persist only the bucket path (never a URL), so this is the canonical
 * set of media a given body keeps alive.
 *
 * Used for node-level storage GC: comparing the paths in a freshly-saved body
 * against the previously-saved set tells us which objects a body dropped, so
 * orphaned uploads can be reclaimed without a bucket-listing sweep (which would
 * race in-flight uploads). Image nodes carrying only `src` (pasted external
 * HTML, no bucket object) contribute nothing — there's no path to reclaim.
 */
export function collectMediaPaths(body: NoteBody | null): Set<string> {
  const out = new Set<string>()
  if (!body || typeof body !== 'object') return out
  function walk(n: unknown) {
    if (!n || typeof n !== 'object') return
    const node = n as Record<string, unknown>
    if (
      (node.type === 'image' || node.type === 'fileAttachment') &&
      node.attrs &&
      typeof node.attrs === 'object'
    ) {
      const path = (node.attrs as Record<string, unknown>).path
      if (typeof path === 'string' && path) out.add(path)
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c)
  }
  walk(body)
  return out
}
