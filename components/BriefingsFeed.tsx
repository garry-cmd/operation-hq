'use client'
import { useCallback, useEffect, useState } from 'react'
import { listRecentBriefs, type Briefing } from '@/lib/db/briefings'

const nwLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase',
  color: 'var(--nw-label)', margin: '0 0 8px',
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function BriefCard({ b }: { b: Briefing }) {
  return (
    <div style={{ border: '1px solid var(--navy-700, var(--navy-600))', borderRadius: 10, padding: '10px 12px', background: 'var(--navy-800)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))' }}>{b.title}</span>
        <span style={{ fontSize: 10, color: 'var(--navy-400)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {relTime(b.created_at)}{b.source === 'cron' ? ' · auto' : ''}
        </span>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy-200)' }}>{b.body}</p>
    </div>
  )
}

export default function BriefingsFeed() {
  const [briefs, setBriefs] = useState<Briefing[]>([])
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(() => {
    listRecentBriefs(10).then(setBriefs).catch(() => {}).finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
    const onSaved = () => load()
    window.addEventListener('hq:brief-saved', onSaved)
    return () => window.removeEventListener('hq:brief-saved', onSaved)
  }, [load])

  if (!loaded || briefs.length === 0) return null
  const [latest, ...rest] = briefs

  return (
    <div style={{ marginTop: 14 }}>
      <div style={nwLabel}>Briefings</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <BriefCard b={latest} />
        {rest.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ alignSelf: 'flex-start', fontSize: 11, padding: '3px 0', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
            >
              {expanded ? 'Hide earlier' : `${rest.length} earlier ▾`}
            </button>
            {expanded && rest.map(b => <BriefCard key={b.id} b={b} />)}
          </>
        )}
      </div>
    </div>
  )
}
