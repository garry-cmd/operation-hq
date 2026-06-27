'use client'
import { InboxIcon, LayersIcon } from './Icons'
import { useMemo, useState } from 'react'
import type { Space, RoadmapItem, TrackedFile, TrackedFileStatus, FileVersion, FileVersionDirection } from '@/lib/types'
import * as filesDb from '@/lib/db/trackedFiles'
import { trackViaPicker } from '@/lib/trackViaPicker'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  roadmapItems: RoadmapItem[]
  trackedFiles: TrackedFile[]
  setTrackedFiles: React.Dispatch<React.SetStateAction<TrackedFile[]>>
  fileVersions: FileVersion[]
  setFileVersions: React.Dispatch<React.SetStateAction<FileVersion[]>>
  driveGranted: boolean
  onConnectGoogle: () => void
  toast: (m: string) => void
}

type Scope =
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'space'; spaceId: string }

const STATUS: Record<TrackedFileStatus, { label: string; color: string; bg: string }> = {
  new_in:      { label: 'New in',      color: 'var(--accent)',                 bg: 'var(--accent-bg, rgba(74,143,255,.12))' },
  editing:     { label: 'Editing',     color: 'var(--nw-caution-text, #f5b840)', bg: 'var(--amber-bg, rgba(245,184,64,.10))' },
  with_client: { label: 'With client', color: 'var(--nw-standby-text, #8e96a8)', bg: 'var(--slate-bg, rgba(142,150,168,.10))' },
  sent:        { label: 'Sent',        color: 'var(--nw-nominal-text, #7fe27a)', bg: 'var(--teal-bg, rgba(127,226,122,.10))' },
}
const STATUS_ORDER: TrackedFileStatus[] = ['new_in', 'editing', 'with_client', 'sent']

function relTime(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function fileGlyph(mime: string | null): string {
  const m = mime ?? ''
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return '▦'
  if (m.includes('document') || m.includes('word')) return '▤'
  if (m.includes('presentation') || m.includes('powerpoint')) return '◫'
  if (m.includes('pdf')) return '▥'
  if (m.includes('folder')) return '▢'
  return '◻'
}

const card: React.CSSProperties = {
  border: '1px solid var(--navy-600)', borderRadius: 11, padding: 14, background: 'var(--navy-800)',
}
const label: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em',
  textTransform: 'uppercase', color: 'var(--nw-label)',
}
const miniBtn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 500, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--navy-600)', background: 'transparent', color: 'var(--navy-300)',
}
const selectStyle: React.CSSProperties = {
  fontSize: 11.5, padding: '4px 7px', borderRadius: 6, border: '1px solid var(--navy-600)',
  background: 'var(--navy-900, var(--navy-800))', color: 'var(--navy-200)', fontFamily: 'inherit', cursor: 'pointer',
}

export default function Files({
  spaces, activeSpaceId, roadmapItems,
  trackedFiles, setTrackedFiles, fileVersions, setFileVersions,
  driveGranted, onConnectGoogle, toast,
}: Props) {
  const [scope, setScope] = useState<Scope>({ kind: 'inbox' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [snapFor, setSnapFor] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY

  const visible = useMemo(() => trackedFiles.filter(f => !f.archived), [trackedFiles])
  const counts = useMemo(() => {
    const bySpace: Record<string, number> = {}
    let inbox = 0
    for (const f of visible) {
      if (f.space_id) bySpace[f.space_id] = (bySpace[f.space_id] ?? 0) + 1
      else inbox++
    }
    return { inbox, all: visible.length, bySpace }
  }, [visible])

  const scoped = useMemo(() => {
    let list = visible
    if (scope.kind === 'inbox') list = list.filter(f => !f.space_id)
    else if (scope.kind === 'space') list = list.filter(f => f.space_id === scope.spaceId)
    return list
  }, [visible, scope])

  const versionsByFile = useMemo(() => {
    const m: Record<string, FileVersion[]> = {}
    for (const v of fileVersions) (m[v.tracked_file_id] ??= []).push(v)
    return m
  }, [fileVersions])

  const spaceName = (id: string | null) => spaces.find(s => s.id === id)?.name ?? '—'
  const spaceColor = (id: string | null) => spaces.find(s => s.id === id)?.color ?? 'var(--navy-500)'

  // ── Track via Picker ──
  const onTrack = async (spaceForNew: string | null) => {
    if (!driveGranted) { onConnectGoogle(); return }
    if (!apiKey) { toast('Add a Google API key in Vercel to enable file picking'); return }
    setPicking(true)
    try {
      const tracked = await trackViaPicker({ apiKey, spaceId: spaceForNew })
      if (tracked.length === 0) return
      setTrackedFiles(prev => {
        const ids = new Set(tracked.map(f => f.id))
        return [...tracked, ...prev.filter(t => !ids.has(t.id))]
      })
      toast(`Tracked ${tracked.length} file${tracked.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast(e instanceof Error && e.message ? `Could not track: ${e.message}` : 'Could not open the file picker')
    } finally {
      setPicking(false)
    }
  }

  // ── Mutations ──
  const patch = async (id: string, p: Partial<TrackedFile>) => {
    setTrackedFiles(prev => prev.map(f => (f.id === id ? { ...f, ...p } : f)))
    try { await filesDb.update(id, p) } catch { toast('Could not save'); }
  }
  const untrack = async (f: TrackedFile) => {
    if (!confirm(`Stop tracking "${f.name || 'this file'}"? The Drive file itself is not deleted.`)) return
    setTrackedFiles(prev => prev.filter(t => t.id !== f.id))
    setFileVersions(prev => prev.filter(v => v.tracked_file_id !== f.id))
    try { await filesDb.remove(f.id) } catch { toast('Could not untrack') }
  }
  const addSnapshot = async (f: TrackedFile, direction: FileVersionDirection, where: string, note: string) => {
    try {
      const v = await filesDb.addVersion({
        tracked_file_id: f.id, direction, snapshot_name: f.name,
        source: direction === 'received' ? (where || null) : null,
        dest: direction === 'sent' ? (where || null) : null,
        note: note || null,
      })
      setFileVersions(prev => [v, ...prev])
      // a sent snapshot implies the file is now with the client; received → editing
      patch(f.id, { status: direction === 'sent' ? 'with_client' : 'editing' })
      setSnapFor(null)
      toast(direction === 'sent' ? 'Logged as sent' : 'Logged as received')
    } catch { toast('Could not log snapshot') }
  }
  const removeVersion = async (v: FileVersion) => {
    setFileVersions(prev => prev.filter(x => x.id !== v.id))
    try { await filesDb.removeVersion(v.id) } catch { toast('Could not remove') }
  }

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ── Not connected gate ──
  if (!driveGranted) {
    return (
      <main style={{ padding: '24px 28px', maxWidth: 720, width: '100%', margin: '0 auto' }}>
        <div style={{ ...label, marginBottom: 5 }}>Daily · Files</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, margin: '0 0 18px', color: 'var(--navy-50)', letterSpacing: '-.02em' }}>Files</h1>
        <div style={{ ...card, maxWidth: 520 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))', marginBottom: 6 }}>Drive access needed</div>
          <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--navy-300)', margin: '0 0 14px' }}>
            Files links your client documents straight from Google Drive — HQ never copies them in. Grant Drive access (drive.file — per-file only) to start tracking.
          </p>
          <button onClick={onConnectGoogle} style={{ ...miniBtn, fontSize: 12.5, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none' }}>Grant Drive access</button>
        </div>
      </main>
    )
  }

  const scopeTitle = scope.kind === 'inbox' ? 'Inbox' : scope.kind === 'all' ? 'All files' : spaceName(scope.spaceId)
  const newFileSpace = scope.kind === 'space' ? scope.spaceId : null

  return (
    <main style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>
      {/* Scope sidebar */}
      <aside style={{ width: 210, flexShrink: 0, borderRight: '1px solid var(--navy-700, var(--navy-600))', padding: '20px 14px', overflowY: 'auto' }}>
        <div style={{ ...label, marginBottom: 5 }}>Daily · Files</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, margin: '0 0 18px', color: 'var(--navy-50)', letterSpacing: '-.02em' }}>Files</h1>

        <div style={{ ...label, fontSize: 9.5, marginBottom: 8 }}>Smart views</div>
        <ScopeRow active={scope.kind === 'inbox'} onClick={() => setScope({ kind: 'inbox' })} glyph={<InboxIcon size={13}/>} name="Inbox" count={counts.inbox} />
        <ScopeRow active={scope.kind === 'all'} onClick={() => setScope({ kind: 'all' })} glyph={<LayersIcon size={13}/>} name="All files" count={counts.all} />

        <div style={{ ...label, fontSize: 9.5, margin: '16px 0 8px' }}>Spaces</div>
        {spaces.map(s => (
          <ScopeRow
            key={s.id}
            active={scope.kind === 'space' && scope.spaceId === s.id}
            onClick={() => setScope({ kind: 'space', spaceId: s.id })}
            dot={s.color} name={s.name} count={counts.bySpace[s.id] ?? 0}
          />
        ))}
      </aside>

      {/* Main */}
      <section style={{ flex: 1, minWidth: 0, padding: '20px 24px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--navy-50)' }}>{scopeTitle}</div>
            <div style={{ fontSize: 11.5, color: 'var(--navy-400)', marginTop: 2 }}>{scoped.length} file{scoped.length === 1 ? '' : 's'}</div>
          </div>
          <button
            onClick={() => onTrack(newFileSpace)}
            disabled={picking}
            style={{ ...miniBtn, fontSize: 12.5, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', opacity: picking ? 0.6 : 1, whiteSpace: 'nowrap' }}>
            {picking ? 'Opening…' : '+ Track a file'}
          </button>
        </div>

        {!apiKey && (
          <div style={{ ...card, borderColor: 'var(--nw-caution-text, #f5b840)', marginBottom: 14, padding: '10px 14px' }}>
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--navy-300)', margin: 0 }}>
              The file picker needs <strong>NEXT_PUBLIC_GOOGLE_API_KEY</strong> set in Vercel (then redeploy). Tracking is disabled until then.
            </p>
          </div>
        )}

        {scoped.length === 0 ? (
          <div style={{ ...card, padding: '28px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--navy-300)', marginBottom: 4 }}>
              {scope.kind === 'inbox' ? 'Inbox is clear.' : 'No files here yet.'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--navy-500, var(--navy-400))' }}>
              {scope.kind === 'space' ? 'Track a client document to start its version ladder.' : 'Picked files land here, then you file them to a client space.'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {scoped.map(f => {
              const versions = versionsByFile[f.id] ?? []
              const st = STATUS[f.status]
              const open = expanded.has(f.id)
              const krs = roadmapItems.filter(k => k.space_id === f.space_id)
              return (
                <div key={f.id} style={card}>
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <span style={{ fontSize: 18, lineHeight: 1, color: 'var(--navy-300)', marginTop: 1 }}>{fileGlyph(f.mime_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.name || 'Untitled'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, color: st.color, background: st.bg, fontFamily: 'var(--font-mono)', letterSpacing: '.04em' }}>{st.label}</span>
                        {f.space_id && scope.kind !== 'space' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--navy-400)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: spaceColor(f.space_id) }} />
                            {spaceName(f.space_id)}
                          </span>
                        )}
                        {f.drive_modified_time && <span style={{ fontSize: 11, color: 'var(--navy-500, var(--navy-400))' }}>modified {relTime(f.drive_modified_time)}</span>}
                        {versions.length > 0 && (
                          <button onClick={() => toggleExpand(f.id)} style={{ ...miniBtn, padding: '2px 7px', fontSize: 11 }}>
                            {open ? 'Hide' : `Ladder · ${versions.length}`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <a href={`https://drive.google.com/open?id=${f.drive_file_id}`} target="_blank" rel="noreferrer"
                       style={{ ...miniBtn, textDecoration: 'none', color: 'var(--accent)', borderColor: 'var(--navy-600)' }}>Open in Drive ↗</a>

                    <select value={f.status} onChange={e => patch(f.id, { status: e.target.value as TrackedFileStatus })} style={selectStyle} title="Status">
                      {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS[s].label}</option>)}
                    </select>

                    <select value={f.space_id ?? ''} onChange={e => patch(f.id, { space_id: e.target.value || null, roadmap_item_id: e.target.value ? f.roadmap_item_id : null })} style={selectStyle} title="Client space">
                      <option value="">Inbox (no space)</option>
                      {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>

                    {f.space_id && (
                      <select value={f.roadmap_item_id ?? ''} onChange={e => patch(f.id, { roadmap_item_id: e.target.value || null })} style={selectStyle} title="Link to KR">
                        <option value="">No KR</option>
                        {krs.map(k => <option key={k.id} value={k.id}>{k.title}</option>)}
                      </select>
                    )}

                    <button onClick={() => setSnapFor(snapFor === f.id ? null : f.id)} style={miniBtn}>Snapshot ↹</button>
                    <button onClick={() => untrack(f)} style={{ ...miniBtn, color: 'var(--nw-rose, #d66)' }}>Untrack</button>
                  </div>

                  {/* Snapshot form */}
                  {snapFor === f.id && <SnapshotForm onCancel={() => setSnapFor(null)} onSave={(dir, where, note) => addSnapshot(f, dir, where, note)} />}

                  {/* Version ladder */}
                  {open && versions.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: '12px 0 0', borderTop: '1px solid var(--navy-700, var(--navy-600))', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {versions.map(v => (
                        <li key={v.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                          <span style={{ fontSize: 13, color: v.direction === 'sent' ? 'var(--nw-nominal-text, #7fe27a)' : 'var(--accent)', fontWeight: 700, marginTop: 1 }}>{v.direction === 'sent' ? '→' : '←'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: 'var(--nw-cream, var(--navy-100))' }}>
                              {v.direction === 'sent' ? 'Sent' : 'Received'}
                              {(v.dest || v.source) && <span style={{ color: 'var(--navy-400)' }}> · {v.direction === 'sent' ? v.dest : v.source}</span>}
                            </div>
                            {v.note && <div style={{ fontSize: 11.5, color: 'var(--navy-400)', marginTop: 1 }}>{v.note}</div>}
                            <div style={{ fontSize: 10.5, color: 'var(--navy-500, var(--navy-400))', marginTop: 1, fontFamily: 'var(--font-mono)' }}>{relTime(v.created_at)}</div>
                          </div>
                          <button onClick={() => removeVersion(v)} style={{ ...miniBtn, padding: '2px 6px', fontSize: 10.5 }}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

function ScopeRow({ active, onClick, glyph, dot, name, count }: {
  active: boolean; onClick: () => void; glyph?: React.ReactNode; dot?: string; name: string; count: number
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
      padding: '6px 9px', borderRadius: 7, border: 'none', cursor: 'pointer', marginBottom: 2,
      background: active ? 'var(--accent-bg, var(--navy-700, var(--navy-600)))' : 'transparent',
      color: active ? 'var(--nw-cream, var(--navy-100))' : 'var(--navy-300)', fontFamily: 'inherit',
    }}>
      {dot ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} /> : <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{glyph}</span>}
      <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {count > 0 && <span style={{ fontSize: 10.5, color: 'var(--navy-400)', fontFamily: 'var(--font-mono)' }}>{count}</span>}
    </button>
  )
}

function SnapshotForm({ onCancel, onSave }: { onCancel: () => void; onSave: (dir: FileVersionDirection, where: string, note: string) => void }) {
  const [dir, setDir] = useState<FileVersionDirection>('sent')
  const [where, setWhere] = useState('')
  const [note, setNote] = useState('')
  const input: React.CSSProperties = {
    fontSize: 12, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--navy-600)',
    background: 'var(--navy-900, var(--navy-800))', color: 'var(--nw-cream, var(--navy-100))', fontFamily: 'inherit', width: '100%',
  }
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 9, border: '1px solid var(--navy-700, var(--navy-600))', background: 'var(--navy-900, rgba(0,0,0,.12))' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['received', 'sent'] as FileVersionDirection[]).map(d => (
          <button key={d} onClick={() => setDir(d)} style={{
            ...miniBtn, flex: 1,
            background: dir === d ? 'var(--accent-bg, var(--navy-700))' : 'transparent',
            color: dir === d ? 'var(--accent)' : 'var(--navy-300)',
            borderColor: dir === d ? 'var(--accent)' : 'var(--navy-600)',
          }}>{d === 'received' ? '← Received' : '→ Sent'}</button>
        ))}
      </div>
      <input value={where} onChange={e => setWhere(e.target.value)} placeholder={dir === 'sent' ? 'Sent to (e.g. Meridian SharePoint)' : 'Received from (e.g. client email)'} style={{ ...input, marginBottom: 8 }} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="One-line note (optional)" style={{ ...input, marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onSave(dir, where.trim(), note.trim())} style={{ ...miniBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>Log {dir === 'sent' ? 'sent' : 'received'}</button>
        <button onClick={onCancel} style={miniBtn}>Cancel</button>
      </div>
    </div>
  )
}
