'use client'
import { useState } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { ACTIVE_Q, COLORS, getRollingQuarters, formatQ } from '@/lib/utils'
import Modal from './Modal'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  activeSpaceId: string
  toast: (m: string) => void
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

export default function Roadmap({ objectives, roadmapItems, setObjectives, setRoadmapItems, activeSpaceId, toast }: Props) {
  const [modal, setModal] = useState<ModalState>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)   // drag-and-drop
  const [dragOverCell, setDragOverCell] = useState<string | null>(null) // "objId:quarter"

  const activeObjs = objectives.filter(o => o.status !== 'abandoned')
  const items = roadmapItems.filter(i => !i.is_parked)

  async function moveKR(itemId: string, quarter: string) {
    const newStatus = quarter === ACTIVE_Q ? 'active' : 'planned'
    try {
      const updated = await krsDb.update(itemId, { quarter, status: newStatus })
      setRoadmapItems(prev => prev.map(i => i.id === itemId ? updated : i))
      toast(`Moved to ${formatQ(quarter)}`)
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

  // Validate-and-move on drop. KRs are constrained to their parent objective —
  // moving across objectives would require re-deriving lineage, which we don't.
  function attemptMove(itemId: string, objId: string, quarter: string) {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    if (item.annual_objective_id !== objId) {
      toast('KRs can only move within the same objective'); return
    }
    if (item.quarter === quarter) return
    moveKR(itemId, quarter)
  }

  // minmax(0, 1fr) — not just '1fr' — so a long KR title cannot expand its
  // column past its 1/4 share. Without the minmax, grid uses content's
  // min-width as the lower bound and column 1 (which holds the chip stack)
  // pushes the others narrower. Chips already handle overflow with ellipsis.
  const COLS = 'repeat(4, minmax(0, 1fr))'
  const MIN_W = 480

  function cellAcceptsDrag(objId: string, quarter: string): boolean {
    if (!draggingId) return false
    const item = items.find(i => i.id === draggingId)
    return !!item && item.annual_objective_id === objId && item.quarter !== quarter
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Roadmap</h1>
        <p style={{ fontSize: 12, color: 'var(--navy-400)' }}>
          {draggingId
            ? '⊕ Drop in a quarter cell — same objective only'
            : 'Drag a key result between quarters · ✎ to edit'}
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

            {/* Quarter headers — padding matches the inner KR cells grid (1px obj-card border + 8px inner padding) so columns line up vertically. */}
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, marginBottom: 8, padding: '0 9px' }}>
              {ROLLING.map(q => (
                <div key={q} style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '7px 6px', borderRadius: 8, lineHeight: 1.3,
                  background: q === ACTIVE_Q ? 'var(--accent-dim)' : 'var(--navy-700)',
                  color: q === ACTIVE_Q ? 'var(--accent)' : 'var(--navy-300)',
                  border: q === ACTIVE_Q ? '1px solid var(--accent)' : '1px solid var(--navy-500)' }}>
                  {formatQ(q)}{q === ACTIVE_Q ? <><br/><span style={{ fontWeight: 400, fontSize: 9 }}>⚡ Active</span></> : ''}
                </div>
              ))}
            </div>

            {/* Swim lanes */}
            {activeObjs.map(obj => {
              const objItems = items.filter(i => i.annual_objective_id === obj.id)
              return (
                <div key={obj.id} style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 10, background: hex2rgba(obj.color, 0.07), border: `1px solid ${hex2rgba(obj.color, 0.25)}` }}>

                  {/* Lane header */}
                  <div style={{ padding: '9px 14px', background: hex2rgba(obj.color, 0.14), display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-50)', flex: 1, textTransform: 'uppercase', letterSpacing: '.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {obj.name}
                    </div>
                    <button onClick={() => setModal({ type: 'edit_obj', obj })}
                      style={{ fontSize: 11, color: hex2rgba(obj.color, 0.7), background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}>
                      Edit
                    </button>
                  </div>

                  {/* Quarter cells */}
                  <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, padding: '8px 8px 10px' }}>
                    {ROLLING.map(q => {
                      const cellKey = `${obj.id}:${q}`
                      const acceptsDrag = cellAcceptsDrag(obj.id, q)
                      const isDragOver = dragOverCell === cellKey && acceptsDrag
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
                            if (id) attemptMove(id, obj.id, q)
                            setDragOverCell(null)
                            setDraggingId(null)
                          }}
                          style={{ minHeight: 64, borderRadius: 9, padding: '5px 5px 3px',
                            background: isDragOver
                              ? hex2rgba(obj.color, 0.28)
                              : q === ACTIVE_Q ? hex2rgba(obj.color, 0.1) : 'transparent',
                            border: isDragOver
                              ? `2px solid ${obj.color}`
                              : q === ACTIVE_Q ? `1px dashed ${hex2rgba(obj.color, 0.4)}` : '1px dashed var(--navy-600)',
                            cursor: isDragOver ? 'pointer' : 'default',
                            WebkitTapHighlightColor: 'transparent',
                            transition: 'background .12s, border .12s' }}>
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
                              onDragEnd={() => {
                                setDraggingId(null)
                                setDragOverCell(null)
                              }}
                              onEdit={e => { e.stopPropagation(); setModal({ type: 'edit_kr', item }) }} />
                          ))}
                          <AddKRBtn onClick={e => { e.stopPropagation(); setModal({ type: 'add_kr', objId: obj.id, quarter: q }) }} color={obj.color} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modals */}
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
            } catch (err) {
              console.error('abandon/restore failed:', err)
            }
          } : undefined}
        />
      )}

      {modal?.type === 'add_kr' && (
        <KRModal
          objId={modal.objId}
          defaultQuarter={modal.quarter}
          objectives={objectives}
          quarters={ROLLING}
          onClose={() => setModal(null)}
          onSave={item => {
            setRoadmapItems(prev => [...prev, item])
            setModal(null)
            toast('Key result added!')
          }}
        />
      )}

      {modal?.type === 'edit_kr' && modal.item.annual_objective_id && (
        <KRModal
          item={modal.item}
          objId={modal.item.annual_objective_id}
          defaultQuarter={modal.item.quarter}
          objectives={objectives}
          quarters={ROLLING}
          onClose={() => setModal(null)}
          onSave={item => {
            setRoadmapItems(prev => prev.map(x => x.id === item.id ? item : x))
            setModal(null)
            toast('Key result updated.')
          }}
          onDelete={() => deleteKR(modal.item.id)}
          onPark={() => { parkKR(modal.item); setModal(null) }}
        />
      )}
    </div>
  )
}

/* ── KR chip — drag with mouse, ✎ to edit ── */
function KRChip({ item, objColor, quarter, dragging, onEdit, onDragStart, onDragEnd }: {
  item: RoadmapItem; objColor: string; quarter: string
  dragging: boolean
  onEdit: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}) {
  const isActive = quarter === ACTIVE_Q
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={e => { e.stopPropagation(); onEdit(e) }}
      style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, padding: '6px 8px', borderRadius: 7, marginBottom: 4,
        cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', lineHeight: 1.35, transition: 'transform .12s, opacity .12s, background .12s',
        background: isActive ? hex2rgba(objColor, 0.22) : 'var(--navy-700)',
        border: isActive ? `1.5px solid ${hex2rgba(objColor, 0.6)}` : `1px solid var(--navy-500)`,
        color: isActive ? 'var(--navy-50)' : 'var(--navy-200)',
        opacity: dragging ? 0.4 : 1,
        WebkitTapHighlightColor: 'transparent',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
      {isActive && <span style={{ marginRight: 2, flexShrink: 0 }}>⚡</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
      <button
        onClick={onEdit}
        onMouseDown={e => e.stopPropagation()}
        draggable={false}
        aria-label="Edit"
        style={{
          flexShrink: 0, width: 22, height: 22, padding: 0, borderRadius: 4,
          background: 'transparent',
          border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isActive ? 'var(--navy-200)' : 'var(--navy-300)',
          opacity: 0.55,
          WebkitTapHighlightColor: 'transparent',
        }}>
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
      style={{ width: '100%', padding: '4px 0', fontSize: 10, fontWeight: 600, color: hex2rgba(color, 0.6),
        background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 3, opacity: .7, marginTop: 2 }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      add KR
    </button>
  )
}

/* ── Objective modal ── */
function ObjModal({ obj, objectives, activeSpaceId, onClose, onSave, onAbandon }: {
  obj?: AnnualObjective; objectives: AnnualObjective[]
  activeSpaceId: string
  onClose: () => void; onSave: (o: AnnualObjective) => void
  onAbandon?: (obj: AnnualObjective) => void
}) {
  const [name, setName] = useState(obj?.name ?? '')
  const [color, setColor] = useState(obj?.color ?? COLORS[objectives.length % COLORS.length])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (obj) {
        const updated = await objectivesDb.update(obj.id, { name, color })
        onSave(updated)
      } else {
        const created = await objectivesDb.create({
          name,
          color,
          sort_order: objectives.length,
          status: 'active',
          space_id: activeSpaceId,
        })
        onSave(created)
      }
    } catch (err) {
      console.error('objective save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={obj ? 'Edit Objective' : 'New Objective'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {obj && onAbandon && (
          <button className="btn" onClick={() => onAbandon(obj)}
            style={{ color: 'var(--red-text)', background: 'var(--red-bg)' }}>
            {obj.status === 'abandoned' ? 'Restore' : 'Abandon'}
          </button>
        )}
        <button className="btn-primary" onClick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </>}>
      <div className="field">
        <label>Objective</label>
        <textarea className="input" rows={3} value={name} onChange={e => setName(e.target.value)} autoFocus
          placeholder="e.g. Greek God — peak conditioning" />
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
    </Modal>
  )
}

/* ── KR modal (add or edit) ── */
function KRModal({ item, objId, defaultQuarter, objectives, quarters, onClose, onSave, onDelete, onPark }: {
  item?: RoadmapItem; objId: string; defaultQuarter: string | null
  objectives: AnnualObjective[]; quarters: string[]
  onClose: () => void; onSave: (i: RoadmapItem) => void
  onDelete?: () => void; onPark?: () => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [quarter, setQuarter] = useState<string | null>(defaultQuarter)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const status = quarter === ACTIVE_Q ? 'active' : 'planned'
    try {
      if (item) {
        const updated = await krsDb.update(item.id, { title, quarter, status })
        onSave(updated)
      } else {
        const parent = objectives.find(o => o.id === objId)
        if (!parent) { setSaving(false); return }
        const count = await krsDb.countByObjective(objId)
        const created = await krsDb.create({
          space_id: parent.space_id,
          annual_objective_id: objId,
          title,
          quarter,
          status,
          sort_order: count,
          health_status: 'not_started',
          progress: 0,
        })
        onSave(created)
      }
    } catch (err) {
      console.error('KR save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const obj = objectives.find(o => o.id === objId)

  return (
    <Modal title={item ? 'Edit Key Result' : 'Add Key Result'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        {item && onPark && <button className="btn" onClick={onPark}>Park it</button>}
        {item && onDelete && (
          <button className="btn" onClick={onDelete} style={{ color: 'var(--red-text)', background: 'var(--red-bg)' }}>Delete</button>
        )}
        <button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </>}>
      {obj && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: 'var(--navy-700)', borderRadius: 10, marginBottom: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color }} />
          <span style={{ fontSize: 12, color: 'var(--navy-200)', fontWeight: 600 }}>{obj.name}</span>
        </div>
      )}
      <div className="field">
        <label>Key Result</label>
        <textarea className="input" rows={3} value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder="e.g. Lose 40 lbs by end of quarter" />
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
