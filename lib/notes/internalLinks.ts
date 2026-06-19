import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Internal links — `[[Note title]]` becomes a clickable link, resolved by
 * title at click time. The body stores the literal text verbatim (so search,
 * export and copy all just see `[[Title]]`); the link styling is a pure
 * render-time decoration. Renaming a target breaks the literal string — an
 * accepted trade-off for a solo-use, no-extra-schema design.
 */

// One bracketed title per match; no nested brackets or newlines inside.
const LINK_RE = /\[\[([^[\]\n]+)\]\]/g

export interface InternalLinkRef {
  current: (title: string) => void
}

export function createInternalLinks(onOpen: InternalLinkRef) {
  return Extension.create({
    name: 'internalLinks',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('internalLinks'),
          props: {
            decorations(state) {
              const decos: Decoration[] = []
              state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return
                const text = node.text
                LINK_RE.lastIndex = 0
                let m: RegExpExecArray | null
                while ((m = LINK_RE.exec(text)) !== null) {
                  const from = pos + m.index
                  const to = from + m[0].length
                  decos.push(
                    Decoration.inline(from, to, {
                      class: 'note-link',
                      'data-note-title': m[1].trim(),
                    }),
                  )
                }
              })
              return DecorationSet.create(state.doc, decos)
            },
            handleClick(_view, _pos, event) {
              const el = event.target as HTMLElement | null
              const link = el?.closest?.('.note-link') as HTMLElement | null
              if (link) {
                const title = link.getAttribute('data-note-title')
                if (title) {
                  onOpen.current(title)
                  return true
                }
              }
              return false
            },
          },
        }),
      ]
    },
  })
}
