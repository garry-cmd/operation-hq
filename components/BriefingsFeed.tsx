'use client'
import { useCallback, useEffect, useState } from 'react'
import { listRecentBriefs, saveProposals, type Briefing, type BriefProposal } from '@/lib/db/briefings'
import { runProposedAction, describeAction, type ActionContext } from '@/lib/agentActions'

const nwLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase',
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

function ProposalCard({
  p, ctx, busy, failed, onApprove, onDismiss,
}: {
  p: BriefProposal
  ctx: ActionContext
  busy: boolean
  failed: boolean
  onApprove: () => void
  onDismiss: () => void
}) {
  const done = p.status === 'approved'
  const dismissed = p.status === 'dismissed'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8,
      background: 'var(--navy-900, var(--navy-800))',
      border: `1px solid ${done ? 'var(--nw-nominal-text)' : failed ? 'var(--nw-alarm-text)' : 'var(--navy-700, var(--navy-600))'}`,
      opacity: dismissed ? 0.5 : 1,
    }}>
      <span style={{ fontSize: 12, flex: 1, color: 'var(--navy-100)', textDecoration: dismissed ? 'line-through' : 'none' }}>
        {done && <span style={{ color: 'var(--nw-nominal-text)', marginRight: 6 }}>✓</span>}
        {failed && <span style={{ color: 'var(--nw-alarm-text)', marginRight: 6 }}>⚠</span>}
        {describeAction(p, ctx)}
      </span>
      {p.status === 'pending' && !failed && (
        <>
          <button onClick={onApprove} disabled={busy} style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 11px', borderRadius: 7, cursor: busy ? 'default' : 'pointer', background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : 'Approve'}</button>
          <button onClick={onDismiss} disabled={busy} style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--navy-300)' }}>Dismiss</button>
        </>
      )}
      {done && <span style={{ fontSize: 10.5, color: 'var(--nw-nominal-text)' }}>done</span>}
      {dismissed && <span style={{ fontSize: 10.5, color: 'var(--navy-400)' }}>dismissed</span>}
      {failed && <button onClick={onApprove} style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 7, cursor: 'pointer', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--navy-300)' }}>Retry</button>}
    </div>
  )
}

function BriefCard({
  b, ctx, onOpenNote, onProposals, toast,
}: {
  b: Briefing
  ctx: ActionContext
  onOpenNote?: (noteId: string) => void
  onProposals: (briefId: string, next: BriefProposal[]) => void
  toast: (m: string) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const proposals = b.proposals ?? []

  const markFailed = (id: string, on: boolean) =>
    setFailedIds(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n })

  async function approve(p: BriefProposal) {
    setBusyId(p.id)
    try {
      await runProposedAction(p, ctx)
      markFailed(p.id, false)
      const next = proposals.map(x => x.id === p.id ? { ...x, status: 'approved' as const } : x)
      onProposals(b.id, next)
      try { await saveProposals(b.id, next) } catch { /* UI reflects status; persistence best-effort */ }
    } catch (e) {
      markFailed(p.id, true)
      toast(e instanceof Error ? e.message : 'Could not run that')
    } finally {
      setBusyId(null)
    }
  }

  async function dismiss(p: BriefProposal) {
    const next = proposals.map(x => x.id === p.id ? { ...x, status: 'dismissed' as const } : x)
    onProposals(b.id, next)
    try { await saveProposals(b.id, next) } catch { /* best-effort */ }
  }

  return (
    <div style={{ border: '1px solid var(--navy-700, var(--navy-600))', borderRadius: 10, padding: '10px 12px', background: 'var(--navy-800)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))' }}>{b.title}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--navy-400)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {relTime(b.created_at)}{b.source === 'cron' ? ' · auto' : b.source === 'watch' ? ' · scout' : ''}
        </span>
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy-200)' }}>{b.body}</p>

      {proposals.length > 0 && (
        <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {proposals.map(p => (
            <ProposalCard
              key={p.id}
              p={p}
              ctx={ctx}
              busy={busyId === p.id}
              failed={failedIds.has(p.id)}
              onApprove={() => approve(p)}
              onDismiss={() => dismiss(p)}
            />
          ))}
        </div>
      )}

      {b.note_id && onOpenNote && (
        <button
          onClick={() => onOpenNote(b.note_id!)}
          style={{ marginTop: 8, fontSize: 11, padding: '2px 0', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
        >
          Open as note ↗
        </button>
      )}
    </div>
  )
}

export default function BriefingsFeed({
  ctx, onOpenNote, toast,
}: {
  ctx: ActionContext
  onOpenNote?: (noteId: string) => void
  toast: (m: string) => void
}) {
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

  const onProposals = useCallback((briefId: string, next: BriefProposal[]) => {
    setBriefs(prev => prev.map(b => b.id === briefId ? { ...b, proposals: next } : b))
  }, [])

  if (!loaded || briefs.length === 0) return null
  const [latest, ...rest] = briefs

  return (
    <div style={{ marginTop: 14 }}>
      <div style={nwLabel}>Briefings</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <BriefCard b={latest} ctx={ctx} onOpenNote={onOpenNote} onProposals={onProposals} toast={toast} />
        {rest.length > 0 && (
          <>
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ alignSelf: 'flex-start', fontSize: 11, padding: '3px 0', background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
            >
              {expanded ? 'Hide earlier' : `${rest.length} earlier ▾`}
            </button>
            {expanded && rest.map(b => (
              <BriefCard key={b.id} b={b} ctx={ctx} onOpenNote={onOpenNote} onProposals={onProposals} toast={toast} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
