'use client'
import { useState, useEffect } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { ACTIVE_Q, COLORS, getRollingQuarters, formatQ, parseDateLocal } from '@/lib/utils'
import { formatDateRange } from '@/lib/dateBuckets'
import { scrollToAndFlash } from '@/lib/scrollFlash'
import Modal from './Modal'
import EditKRModal from './EditKRModal'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  activeSpaceId: string
  toast: (m: string) => void
  initialKRId?: string | null
  onConsumeInitialKRId?: () => void
}

type ModalState =
  | { type: 'add_obj' }
  | { type: 'edit_obj'; obj: AnnualObjective }
  | { type: 'add_kr'; objId: string; quarter: string | null }
  | { type: 'edit_kr'; item: RoadmapItem }
  | null

const ROLLING = getRollingQuarters()

function hex2rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// Returns the first and last day of a quarter as yyyy-mm-dd strings.
function quarterBounds(q: string): { start: string; end: string } | null {
  const m = /^([1-4])Q(\d{4})$/.exec(q)
  if (!m) return null
  const n = +m[1], y = +m[2]
  return {
    start: ymd(new Date(y, (n - 1) * 3, 1)),
    end:   ymd(new Date(y, n * 3, 0)),
  }
}

// Given an objective's start/end, compute which ROLLING quarters are in-scope.
// Dateless objectives → all quarters in scope.
function scopedQuarters(obj: AnnualObjective): Set<string> {
  if (!obj.start_date && !obj.end_date) return new Set(ROLLING)
  const out = new Set<string>()
  for (const q of ROLLING) {
    const b = quarterBounds(q)
    if (!b) continue
    // Quarter overlaps window if qStart <= obj.end AND qEnd >= obj.start
    if (obj.end_date && b.start > obj.end_date) continue
    if (obj.start_date && b.end < obj.start_date) continue
    out.add(q)
  }
  return out
}

// Given the in-scope set, find the first and last indices in ROLLING.
function scopeSpan(inScope: Set<string>): { first: number; last: number } | null {
  const indices = ROLLING.map((q, i) => inScope.has(q) ? i : -1).filter(i => i >= 0)
  if (!indices.length) return null
  return { first: indices[0], last: indices[indices.length - 1] }
}

export default function Roadmap({
  objectives, roadmapItems, setObjectives, setRoadmapItems,
  activeSpaceId, toast, initialKRId, onConsumeInitialKRId,
}: Props) {
  const [modal, setModal]             = useState<ModalState>(null)
  const [draggingId, setDraggingId]   = useState<string | null>(null)
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)
  const [collapsed, setCollapsed]     = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!initialKRId) return
    scrollToAndFlash(initialKRId, () => onConsumeInitialKRId?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKRId])

  const activeObjs = objectives.filter(o => o.status !== 'abandoned')
  const items = roadmapItems.filter(i => !i.is_parked)

  function toggleCollapse(id: string) {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function moveKR(itemId: string, quarter: string, obj: AnnualObjective) {
    const newStatus = quarter === ACTIVE_Q ? 'active' : 'planned'
    try {
      const updated = await krsDb.update(itemId, { quarter, status: newStatus })
      setRoadmapItems(prev => prev.map(i => i.id === itemId ? updated : i))
      toast(`Moved to ${formatQ(quarter)}`)

      // Auto-expand the objective's window if the target quarter is outside it.
      const b = quarterBounds(quarter)
      if (!b) return
      let newStart = obj.start_date ?? null
      let newEnd   = obj.end_date   ?? null
      let changed  = false
      // Only auto-expand if the objective has a window set (dateless = all quarters, nothing to expand)
      if (newStart || newEnd) {
        if (!newStart || b.start < newStart) { newStart = b.start; changed = true }
        if (!newEnd   || b.end   > newEnd)   { newEnd   = b.end;   changed = true }
        if (changed) {
          const updatedObj = await objectivesDb.update(obj.id, { start_date: newStart, end_date: newEnd })
          setObjectives(prev => prev.map(o => o.id === obj.id ? updatedObj : o))
          toast(`${formatQ(quarter)} — objective window extended`)
        }
      }
    } catch (err) {
      console.error('moveKR failed:', err)
    }
  }

  async function parkKR(item: RoadmapItem) {
    try {
      const updated = await krsDb.update(item.id, { is_parked: true, quarter: null, status: 'planned' })
      setRoadmapItems(prev => prev.map(i => i.id === item.id ? updated : i))
      toast('Moved to Parking Lot')
    } catch (err) {
      console.error('parkKR failed:', err)
    }
  }

  async function deleteKR(id: string) {
    try {
      await krsDb.remove(id)
      setRoadmapItems(prev => prev.filter(i => i.id !== id))
      setModal(null); toast('Key result deleted.')
    } catch (err) {
      console.error('deleteKR failed:', err)
    }
  }

  async function deleteObjective(obj: AnnualObjective) {
    if (!window.confirm(`Delete "${obj.name}"? This will permanently remove all its KRs. This cannot be undone.`)) return
    try {
      await krsDb.removeByObjective(obj.id)
      await objectivesDb.remove(obj.id)
      setRoadmapItems(prev => prev.filter(i => i.annual_objective_id !== obj.id))
      setObjectives(prev => prev.filter(o => o.id !== obj.id))
      setModal(null)
      toast('Objective deleted.')
    } catch (err) {
      console.error('deleteObjective failed:', err)
      toast('Failed to delete objective.')
    }
  }

  function attemptMove(itemId: string, obj: AnnualObjective, quarter: string) {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    if (item.annual_objective_id !== obj.id) {
      toast('KRs can only move within the same objective'); return
    }
    if (item.quarter === quarter) return
    moveKR(itemId, quarter, obj)
  }

  function cellAcceptsDrag(objId: string, quarter: string): boolean {
    if (!draggingId) return false
    const item = items.find(i => i.id === draggingId)
    return !!item && item.annual_objective_id === objId && item.quarter !== quarter
  }

  // ── Grid layout constants ──
  // One shared grid so all objectives' columns align with the quarter headers.
  const COLS = 'repeat(4, minmax(0, 1fr))'
  const MIN_W = 480
  // Column index (1-based) for each quarter in ROLLING
  const qCol: Record<string, number> = Object.fromEntries(ROLLING.map((q, i) => [q, i + 1]))

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', marginBottom: 6 }}>
          Strategic · Roadmap
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--navy-50)', margin: '0 0 4px 0', letterSpacing: '-.02em' }}>Roadmap</h1>
        <p style={{ fontSize: 12, color: 'var(--navy-400)', margin: 0 }}>
          {draggingId ? '⊕ Drop in a quarter cell — same objective only' : 'Drag a KR between quarters · click objective header to collapse'}
        </p>
      </div>

      {activeObjs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🗺</div>
          No objectives yet.<br />
          <span style={{ fontSize: 13 }}>Tap the + button to add your first objective.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <div style={{ minWidth: MIN_W }}>

            {/* ── Quarter column headers ── */}
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, marginBottom: 10 }}>
              {ROLLING.map(q => (
                <div key={q} style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                  letterSpacing: '.08em', textAlign: 'center', padding: '7px 6px',
                  borderRadius: 8, lineHeight: 1.3,
                  background: q === ACTIVE_Q ? 'var(--accent-bg)' : 'var(--surface-2)',
                  color:      q === ACTIVE_Q ? 'var(--accent-2)'  : 'var(--navy-300)',
                  border:     q === ACTIVE_Q ? '1px solid var(--accent-line)' : '1px solid var(--line-2)',
                }}>
                  {formatQ(q)}{q === ACTIVE_Q && <><br/><span style={{ fontWeight: 400, fontSize: 9, letterSpacing: '.04em' }}>⚡ Active</span></>}
                </div>
              ))}
            </div>

            {/* ── Objective rows — all in one shared grid ── */}
            {activeObjs.map((obj, objIdx) => {
              const objItems = items.filter(i => i.annual_objective_id === obj.id)
              const inScope  = scopedQuarters(obj)
              const span     = scopeSpan(inScope)
              const isCol    = !!collapsed[obj.id]

              // grid-column for header: first in-scope col through last in-scope col.
              // Dateless (all 4) or if span is null → full width.
              const hdrStart = span ? span.first + 1 : 1
              const hdrEnd   = span ? span.last  + 2 : 5  // CSS grid end is exclusive

              const today = new Date(); today.setHours(0,0,0,0)
              const overdue = !!(obj.end_date && parseDateLocal(obj.end_date) < today)
              const dateText = formatDateRange(obj.start_date, obj.end_date)

              return (
                <div key={obj.id} style={{ display: 'contents' }}>

                  {/* ── Objective header row ── */}
                  <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, marginBottom: isCol ? 8 : 0 }}>
                    {/* Empty cells before the header */}
                    {Array.from({ length: hdrStart - 1 }).map((_, i) => (
                      <div key={`pre-${i}`} />
                    ))}

                    {/* Header itself — spans in-scope columns */}
                    <div
                      onClick={() => toggleCollapse(obj.id)}
                      style={{
                        gridColumn: `${hdrStart} / ${hdrEnd}`,
                        padding: '9px 13px',
                        background: hex2rgba(obj.color, 0.16),
                        border: `1px solid ${hex2rgba(obj.color, 0.32)}`,
                        borderRadius: isCol ? 10 : '10px 10px 0 0',
                        display: 'flex', alignItems: 'center', gap: 8,
                        cursor: 'pointer',
                        transition: 'background .12s',
                        userSelect: 'none',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = hex2rgba(obj.color, 0.22))}
                      onMouseLeave={e => (e.currentTarget.style.background = hex2rgba(obj.color, 0.16))}
                    >
                      {/* Collapse chevron */}
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                        style={{ flexShrink: 0, transition: 'transform .18s', transform: isCol ? 'rotate(-90deg)' : 'rotate(0deg)', color: hex2rgba(obj.color, 0.7) }}>
                        <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-50)', flex: 1, textTransform: 'uppercase', letterSpacing: '.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {obj.name}
                      </div>
                      {dateText && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, flexShrink: 0, color: overdue ? 'var(--nw-alarm-text)' : hex2rgba(obj.color, 0.8), letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
                          {dateText}{overdue && ' · overdue'}
                        </div>
                      )}
                      {/* KR count when collapsed */}
                      {isCol && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: hex2rgba(obj.color, 0.6), flexShrink: 0 }}>
                          {objItems.length} KR{objItems.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setModal({ type: 'edit_obj', obj }) }}
                        style={{ fontSize: 11, fontWeight: 600, color: hex2rgba(obj.color, 0.7), background: 'none', border: 'none', cursor: 'pointer', padding: '2px 7px', borderRadius: 6, flexShrink: 0, fontFamily: 'inherit' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.1)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        Edit
                      </button>
                    </div>

                    {/* Empty cells after the header */}
                    {Array.from({ length: 4 - (hdrEnd - 1) }).map((_, i) => (
                      <div key={`post-${i}`} />
                    ))}
                  </div>

                  {/* ── KR cells row (hidden when collapsed) ── */}
                  {!isCol && (
                    <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, marginBottom: objIdx < activeObjs.length - 1 ? 12 : 0 }}>
                      {ROLLING.map((q, qi) => {
                        const cellKey = `${obj.id}:${q}`
                        const isInScope = inScope.has(q)
                        const acceptsDrag = cellAcceptsDrag(obj.id, q)
                        const isDragOver  = dragOverCell === cellKey && acceptsDrag

                        // Out-of-scope: transparent spacer — no border, no +KR
                        if (!isInScope) {
                          return <div key={q} />
                        }

                        // Is this cell on the leftmost / rightmost in-scope position?
                        const isFirst = span ? qi === span.first : qi === 0
                        const isLast  = span ? qi === span.last  : qi === 3
                        const borderRadius = isFirst && isLast ? '0 0 10px 10px'
                          : isFirst ? '0 0 0 10px'
                          : isLast  ? '0 0 10px 0'
                          : '0'

                        return (
                          <div key={q}
                            onDragOver={e => {
                              if (acceptsDrag) {
                                e.preventDefault()
                                e.dataTransfer.dropEffect = 'move'
                                if (dragOverCell !== cellKey) setDragOverCell(cellKey)
                              }
                            }}
                            onDragLeave={e => {
                              const related = e.relatedTarget as Node | null
                              if (!related || !e.currentTarget.contains(related)) {
                                if (dragOverCell === cellKey) setDragOverCell(null)
                              }
                            }}
                            onDrop={e => {
                              e.preventDefault()
                              const id = e.dataTransfer.getData('text/plain') || draggingId
                              if (id) attemptMove(id, obj, q)
                              setDragOverCell(null)
                              setDraggingId(null)
                            }}
                            style={{
                              minHeight: 68,
                              borderRadius,
                              padding: '5px 5px 3px',
                              background: isDragOver
                                ? hex2rgba(obj.color, 0.28)
                                : q === ACTIVE_Q ? hex2rgba(obj.color, 0.1) : 'transparent',
                              border: isDragOver
                                ? `2px solid ${obj.color}`
                                : q === ACTIVE_Q
                                  ? `1px solid ${hex2rgba(obj.color, 0.35)}`
                                  : `1px solid ${hex2rgba(obj.color, 0.18)}`,
                              borderTop: 'none',
                              cursor: isDragOver ? 'pointer' : 'default',
                              WebkitTapHighlightColor: 'transparent',
                              transition: 'background .12s, border .12s',
                            }}>
                            {isDragOver && (
                              <div style={{ textAlign: 'center', fontSize: 10, color: obj.color, fontWeight: 700, padding: '4px 0 2px', opacity: .85 }}>
                                Drop here
                              </div>
                            )}
                            {objItems.filter(i => i.quarter === q).map(item => (
                              <KRChip key={item.id} item={item} objColor={obj.color} quarter={q}
                                dragging={draggingId === item.id}
                                onDragStart={e => {
                                  e.dataTransfer.setData('text/plain', item.id)
                                  e.dataTransfer.effectAllowed = 'move'
                                  setDraggingId(item.id)
                                }}
                                onDragEnd={() => { setDraggingId(null); setDragOverCell(null) }}
                                onEdit={e => { e.stopPropagation(); setModal({ type: 'edit_kr', item }) }} />
                            ))}
                            <AddKRBtn onClick={e => { e.stopPropagation(); setModal({ type: 'add_kr', objId: obj.id, quarter: q }) }} color={obj.color} />
                          </div>
                        )
                      })}
                    </div>
                  )}

                </div>
              )
            })}

          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {(modal?.type === 'add_obj' || modal?.type === 'edit_obj') && (
        <ObjModal
          obj={modal.type === 'edit_obj' ? modal.obj : undefined}
          objectives={objectives}
          activeSpaceId={activeSpaceId}
          onClose={() => setModal(null)}
          onSave={o => {
            setObjectives(prev => modal.type === 'edit_obj' ? prev.map(x => x.id === o.id ? o : x) : [...prev, o])
            setModal(null)
            toast(modal.type === 'edit_obj' ? 'Objective updated.' : 'Objective added!')
          }}
          onAbandon={modal.type === 'edit_obj' ? async (obj) => {
            const next = obj.status === 'abandoned' ? 'active' : 'abandoned'
            try {
              const updated = await objectivesDb.update(obj.id, { status: next })
              setObjectives(prev => prev.map(o => o.id === obj.id ? updated : o))
              setModal(null)
              toast(next === 'abandoned' ? 'Objective abandoned.' : 'Objective restored.')
            } catch (err) { console.error('abandon/restore failed:', err) }
          } : undefined}
          onDelete={modal.type === 'edit_obj' ? () => deleteObjective(modal.obj) : undefined}
        />
      )}

      {modal?.type === 'add_kr' && (
        <KRModal
          objId={modal.objId}
          defaultQuarter={modal.quarter}
          objectives={objectives}
          quarters={ROLLING}
          onClose={() => setModal(null)}
          onSave={item => { setRoadmapItems(prev => [...prev, item]); setModal(null); toast('Key result added!') }}
        />
      )}

      {modal?.type === 'edit_kr' && modal.item.annual_objective_id && (
        <EditKRModal
          kr={modal.item}
          quarters={ROLLING}
          onClose={() => setModal(null)}
          onSave={async (patch) => {
            try {
              const updated = await krsDb.update(modal.item.id, patch)
              setRoadmapItems(prev => prev.map(x => x.id === updated.id ? updated : x))
              setModal(null)
              toast('Key result updated.')
            } catch (err) { console.error('updateKR error:', err); toast('Failed to update KR') }
          }}
          onDelete={() => deleteKR(modal.item.id)}
          onPark={() => { parkKR(modal.item); setModal(null) }}
          toast={toast}
        />
      )}
    </div>
  )
}

/* ── KR chip ── */
function KRChip({ item, objColor, quarter, dragging, onEdit, onDragStart, onDragEnd }: {
  item: RoadmapItem; objColor: string; quarter: string
  dragging: boolean
  onEdit: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}) {
  const isActive = quarter === ACTIVE_Q
  const isDone   = item.health_status === 'done'
  const krDateText = formatDateRange(item.start_date, item.end_date)
  return (
    <div
      data-kr-id={item.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={e => { e.stopPropagation(); onEdit(e) }}
      style={{
        fontSize: 11, fontWeight: isActive ? 600 : 400, padding: '6px 8px', borderRadius: 8, marginBottom: 4,
        cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', lineHeight: 1.35,
        transition: 'transform .12s, opacity .12s, background .12s',
        background: isActive ? hex2rgba(objColor, 0.22) : 'var(--surface-2)',
        border:     isActive ? `1.5px solid ${hex2rgba(objColor, 0.6)}` : '1px solid var(--line-2)',
        color:      isActive ? 'var(--navy-50)' : 'var(--navy-200)',
        opacity: dragging ? 0.4 : isDone ? 0.45 : 1,
        WebkitTapHighlightColor: 'transparent',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
      {isActive && <span style={{ marginRight: 2, flexShrink: 0 }}>⚡</span>}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>{item.title}</span>
        {krDateText && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500, color: isActive ? hex2rgba(objColor, 0.9) : 'var(--navy-300)', letterSpacing: '.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {krDateText}
          </span>
        )}
      </div>
      <button onClick={onEdit} onMouseDown={e => e.stopPropagation()} draggable={false}
        style={{ flexShrink: 0, width: 22, height: 22, padding: 0, borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isActive ? 'var(--navy-200)' : 'var(--navy-300)', opacity: 0.55, WebkitTapHighlightColor: 'transparent' }}>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}

/* ── Add KR button ── */
function AddKRBtn({ onClick, color }: { onClick: (e: React.MouseEvent) => void; color: string }) {
  return (
    <button onClick={onClick}
      style={{ width: '100%', padding: '4px 0', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: hex2rgba(color, 0.6), background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, opacity: .7, marginTop: 2 }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      add KR
    </button>
  )
}

/* ── Objective modal (create + edit + delete) ── */
function ObjModal({ obj, objectives, activeSpaceId, onClose, onSave, onAbandon, onDelete }: {
  obj?: AnnualObjective; objectives: AnnualObjective[]
  activeSpaceId: string
  onClose: () => void; onSave: (o: AnnualObjective) => void
  onAbandon?: (obj: AnnualObjective) => void
  onDelete?: () => void
}) {
  const [name,      setName]      = useState(obj?.name ?? '')
  const [color,     setColor]     = useState(obj?.color ?? COLORS[objectives.length % COLORS.length])
  const [startDate, setStartDate] = useState<string>(obj?.start_date ?? '')
  const [endDate,   setEndDate]   = useState<string>(obj?.end_date   ?? '')
  const [saving,    setSaving]    = useState(false)

  const dateError = !!(startDate && endDate && endDate < startDate)

  async function save() {
    if (!name.trim() || dateError) return
    setSaving(true)
    try {
      if (obj) {
        const updated = await objectivesDb.update(obj.id, { name, color, start_date: startDate || null, end_date: endDate || null })
        onSave(updated)
      } else {
        const created = await objectivesDb.create({ name, color, sort_order: objectives.length, status: 'active', space_id: activeSpaceId, start_date: startDate || null, end_date: endDate || null })
        onSave(created)
      }
    } catch (err) { console.error('objective save failed:', err) }
    finally { setSaving(false) }
  }

  return (
    <Modal title={obj ? 'Edit Objective' : 'New Objective'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {obj && onAbandon && (
          <button className="btn" onClick={() => onAbandon(obj)} style={{ color: 'var(--red-text)', background: 'var(--red-bg)' }}>
            {obj.status === 'abandoned' ? 'Restore' : 'Abandon'}
          </button>
        )}
        {obj && onDelete && (
          <button className="btn" onClick={onDelete} style={{ color: 'var(--nw-alarm-text)', background: 'rgba(255,100,82,.1)', border: '1px solid rgba(255,100,82,.22)' }}>
            Delete
          </button>
        )}
        <button className="btn-primary" onClick={save} disabled={saving || !name.trim() || dateError}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </>}>
      <div className="field">
        <label>Objective</label>
        <textarea className="input" rows={3} value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Greek God — peak conditioning" />
      </div>
      <div className="field">
        <label>Color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: color === c ? '3px solid var(--navy-50)' : '2px solid transparent', cursor: 'pointer', outline: color === c ? '2px solid ' + c : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </div>
      <div className="field">
        <label>Time window <span style={{ color: 'var(--nw-label-dim)', fontWeight: 400 }}>(optional — controls which quarter columns are active)</span></label>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--nw-label-dim)' }}>Start</label>
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--nw-label-dim)' }}>End</label>
            <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
        {dateError && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nw-alarm-text)' }}>End date can't be before start date.</div>}
      </div>
    </Modal>
  )
}

/* ── KR modal (add only — edit goes through EditKRModal) ── */
function KRModal({ objId, defaultQuarter, objectives, quarters, onClose, onSave }: {
  objId: string; defaultQuarter: string | null
  objectives: AnnualObjective[]; quarters: string[]
  onClose: () => void; onSave: (i: RoadmapItem) => void
}) {
  const [title,   setTitle]   = useState('')
  const [quarter, setQuarter] = useState<string | null>(defaultQuarter)
  const [saving,  setSaving]  = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const status = quarter === ACTIVE_Q ? 'active' : 'planned'
    try {
      const parent = objectives.find(o => o.id === objId)
      if (!parent) { setSaving(false); return }
      const count = await krsDb.countByObjective(objId)
      const created = await krsDb.create({ space_id: parent.space_id, annual_objective_id: objId, title, quarter, status, sort_order: count, health_status: 'not_started', progress: 0 })
      onSave(created)
    } catch (err) { console.error('KR save failed:', err) }
    finally { setSaving(false) }
  }

  const obj = objectives.find(o => o.id === objId)
  return (
    <Modal title="Add Key Result" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      {obj && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'var(--navy-700)', borderRadius: 10, marginBottom: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color }} />
          <span style={{ fontSize: 12, color: 'var(--navy-200)', fontWeight: 600 }}>{obj.name}</span>
        </div>
      )}
      <div className="field">
        <label>Key Result</label>
        <textarea className="input" rows={3} value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Lose 40 lbs by end of quarter" />
      </div>
      <div className="field">
        <label>Quarter</label>
        <select className="input" value={quarter ?? ''} onChange={e => setQuarter(e.target.value || null)}>
          <option value="">Unscheduled</option>
          {quarters.map(q => <option key={q} value={q}>{formatQ(q)}{q === ACTIVE_Q ? ' ⚡ Active' : ''}</option>)}
        </select>
      </div>
    </Modal>
  )
}
