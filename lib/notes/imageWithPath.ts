import Image from '@tiptap/extension-image'
import { signNoteMedia } from '@/lib/db/noteMedia'

/**
 * Image node that persists only the private storage `path`. The display URL is
 * resolved to a short-lived signed URL at render time via a node view, so note
 * bodies never contain an expiring or public URL. Swapping the privacy model
 * later touches only `signNoteMedia` — never stored content.
 *
 * Keeps the base node name ('image') so paste/commands interop normally; an
 * unexpected node carrying only `src` (e.g. pasted external HTML) still renders
 * via the src fallback.
 */
export const ImageWithPath = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: { default: null as string | null },
    }
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img')
      dom.className = 'note-image'
      dom.setAttribute('data-loading', 'true')
      let destroyed = false

      const path: string | null = node.attrs.path
      if (path) {
        signNoteMedia(path)
          .then(url => {
            if (destroyed || !url) return
            dom.src = url
            dom.removeAttribute('data-loading')
          })
          .catch(() => {})
      } else if (node.attrs.src) {
        dom.src = node.attrs.src as string
        dom.removeAttribute('data-loading')
      }

      return {
        dom,
        destroy() {
          destroyed = true
        },
      }
    }
  },
})
