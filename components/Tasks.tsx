'use client'
/**
 * Tasks — placeholder. The real module lands in Phase 2: free-floating
 * tasks per space with priorities, recurrence, tags, optional KR link,
 * and smart views (Today / Upcoming / Inbox). See mock from May 14.
 */
export default function Tasks() {
  return (
    <div style={{ padding: '40px 24px', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 6 }}>Tasks</h1>
      <p style={{ fontSize: 13, color: 'var(--navy-300)', marginBottom: 28 }}>
        A robust to-do list for each space — priorities, recurrence, tags, and dates.
      </p>
      <div style={{
        padding: '36px 28px',
        background: 'var(--navy-800)',
        border: '1px dashed var(--navy-500)',
        borderRadius: 14,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.4 }}>☑</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-100)', marginBottom: 4 }}>
          Coming soon
        </div>
        <div style={{ fontSize: 12, color: 'var(--navy-300)', lineHeight: 1.5 }}>
          Quick capture with natural language, smart views (Today / Upcoming),<br />
          recurrence rules, tags, and optional links to KRs.
        </div>
      </div>
    </div>
  )
}
