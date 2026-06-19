import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'

// Shared background-color attribute for cells + headers. Stored as an rgba
// string so the tint reads on both light and dark themes (a translucent wash
// over whatever the cell sits on, rather than an opaque color).
const bgAttr = {
  backgroundColor: {
    default: null as string | null,
    parseHTML: (el: HTMLElement): string | null =>
      el.style.backgroundColor || el.getAttribute('data-bg') || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.backgroundColor
        ? {
            style: `background-color: ${attrs.backgroundColor}`,
            'data-bg': String(attrs.backgroundColor),
          }
        : {},
  },
}

const TableCellWithBg = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...bgAttr }
  },
})

const TableHeaderWithBg = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...bgAttr }
  },
})

// Cells accept full block content by default ('block+'), so bullet lists and
// checklists work inside cells with no extra config.
export const tableExtensions = [
  Table.configure({ resizable: true }),
  TableRow,
  TableHeaderWithBg,
  TableCellWithBg,
]

// Preset cell fills — translucent so they work on both light and dark.
export const CELL_COLORS: { label: string; value: string | null }[] = [
  { label: 'Clear', value: null },
  { label: 'Amber', value: 'rgba(245,184,64,0.20)' },
  { label: 'Green', value: 'rgba(127,226,122,0.20)' },
  { label: 'Blue', value: 'rgba(74,143,255,0.20)' },
  { label: 'Red', value: 'rgba(255,100,82,0.18)' },
  { label: 'Purple', value: 'rgba(139,92,246,0.20)' },
  { label: 'Grey', value: 'rgba(140,150,168,0.20)' },
]
