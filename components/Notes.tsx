'use client'
/**
 * Notes — placeholder. The real module lands in Phase 3: rich-text notes
 * per space with notebooks, tags, internal links, and full-text search.
 * See mock from May 14.
 */
export default function Notes() {
  return (
    <div style={{ padding: '40px 24px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 6 }}>Notes</h1>
      <p style={{ fontSize: 13, color: 'var(--navy-300)', marginBottom: 28 }}>
        A full notes system per space — rich text, tags, internal links, and search.
      </p>
      <div style={{
        padding: '36px 28px',
        background: 'var(--navy-800)',
        border: '1px dashed var(--navy-500)',
        borderRadius: 14,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.4 }}>📓</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-100)', marginBottom: 4 }}>
          Coming soon
        </div>
        <div style={{ fontSize: 12, color: 'var(--navy-300)', lineHeight: 1.5 }}>
          Three-pane layout — notebooks, list, editor.<br />
          Block-style writing with headings, callouts, checklists, and [[ internal links ]].
        </div>
      </div>
    </div>
  )
}
