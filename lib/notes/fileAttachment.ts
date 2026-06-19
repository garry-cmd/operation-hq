import { Node, mergeAttributes } from '@tiptap/core'
import { signNoteMedia, deleteNoteMedia } from '@/lib/db/noteMedia'

function fmtSize(bytes: number): string {
  if (!bytes || bytes < 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${i > 0 && n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`
}

function extBadge(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return (m ? m[1] : 'file').toUpperCase().slice(0, 4)
}

// Open a private attachment without tripping popup blockers: grab the tab
// synchronously inside the gesture, then point it at the signed URL once signed.
async function openAttachment(path: string) {
  const win = window.open('about:blank', '_blank')
  try {
    const url = await signNoteMedia(path)
    if (url) {
      if (win) win.location.href = url
      else window.open(url, '_blank')
    } else if (win) {
      win.close()
    }
  } catch {
    if (win) win.close()
  }
}

/**
 * Block-level file attachment. Like ImageWithPath it persists only the private
 * storage `path` (plus display metadata: name/size/mime) and never a URL —
 * clicking the download control signs a short-lived URL on demand. Clicking the
 * chip body selects the node so it can be deleted with backspace.
 */
export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      path: { default: null as string | null },
      name: { default: '' },
      size: { default: 0 },
      mime: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-attachment': '' })]
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      const path: string | null = node.attrs.path
      const name: string = node.attrs.name || 'Attachment'
      const size: number = node.attrs.size || 0

      const dom = document.createElement('div')
      dom.className = 'note-file-chip'
      dom.contentEditable = 'false'
      dom.title = `Open ${name}`

      const badge = document.createElement('span')
      badge.className = 'note-file-badge'
      badge.textContent = extBadge(name)

      const label = document.createElement('span')
      label.className = 'note-file-name'
      label.textContent = name

      const meta = document.createElement('span')
      meta.className = 'note-file-size'
      meta.textContent = fmtSize(size)

      const remove = document.createElement('button')
      remove.className = 'note-file-remove'
      remove.type = 'button'
      remove.title = 'Remove attachment'
      remove.setAttribute('aria-label', 'Remove attachment')
      remove.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      remove.addEventListener('mousedown', e => {
        // Remove the node; don't let the click bubble to the chip's open handler.
        e.preventDefault()
        e.stopPropagation()
        if (typeof getPos !== 'function') return
        const pos = getPos()
        if (pos == null) return
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
        // Node-level GC: drop the backing storage object too.
        if (path) void deleteNoteMedia([path])
      })

      dom.appendChild(badge)
      dom.appendChild(label)
      dom.appendChild(meta)
      dom.appendChild(remove)

      // Click anywhere on the chip → open the file. mousedown + preventDefault so
      // ProseMirror doesn't first turn it into a node selection.
      dom.addEventListener('mousedown', e => {
        if (e.button !== 0) return
        e.preventDefault()
        if (path) void openAttachment(path)
      })

      return { dom }
    }
  },
})
