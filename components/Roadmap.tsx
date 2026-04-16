'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { ACTIVE_Q, COLORS, getRollingQuarters, formatQ } from '@/lib/utils'
import Modal from './Modal'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  toast: (m: string) => void
}

type ModalState =
  | { type: 'add_obj' }
  | { type: 'edit_obj'; obj: AnnualObjective }
  | { type: 'add_kr'; objId: string; quarter: string | null }
  | { type: 'edit_kr'; item: RoadmapItem }
  | null

const ROLLING = getRollingQuarters()

// hex → rgba helper
function hex2rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

export default function Roadmap({ objectives, roadmapItems, setObjectives, setRoadmapItems, toast }: Props) {
  const [modal, setModal] = useState<ModalState>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null) // `${objId}::${quarter|null}`

  const activeObjs = objectives.filter(o => o.status !== 'abandoned')

  // Items that are NOT parked
  const items = roadmapItems.filter(i => !i.is_parked)

  async function moveKR(itemId: string, quarter: string | null) {
    const newStatus = quarter === ACTIVE_Q ? 'active' : quarter ? 'planned' : 'planned'
    await supabase.from('roadmap_items').update({ quarter, status: newStatus }).eq('id', itemId)
    setRoadmapItems(prev => prev.map(i => i.id === itemId ? { ...i, quarter, status: newStatus } : i))
    toast(quarter ? `Moved to ${formatQ(quarter)}` : 'Moved to Unscheduled')
  }

  async function parkKR(item: RoadmapItem) {
    await supabase.from('roadmap_items').update({ is_parked: true, quarter: null, status: 'planned' }).eq('id', item.id)
    setRoadmapItems(prev => prev.map(i => i.id === item.id ? { ...i, is_parked: true, quarter: null, status: 'planned' } : i))
    toast('Moved to Parking Lot')
  }

  async function deleteKR(id: string) {
    await supabase.from('roadmap_items').delete().eq('id', id)
    setRoadmapItems(prev => prev.filter(i => i.id !== id))
    setModal(null)
    toast('Key result deleted.')
  }

  function cellKey(objId: string, q: string | null) { return `${objId}::${q ?? 'null'}` }

  function onDragStart(e: React.DragEvent, itemId: string) {
    e.dataTransfer.setData('itemId', itemId)
    setDraggingId(itemId)
  }

  function onDragOver(e: React.DragEvent, key: string) {
    e.preventDefault()
    setDragOver(key)
  }

  function onDrop(e: React.DragEvent, objId: string, quarter: string | null) {
    e.preventDefault()
    const itemId = e.dataTransfer.getData('itemId')
    setDragOver(null); setDraggingId(null)
    if (!itemId) return
    const item = items.find(i => i.id === itemId)
    if (!item || item.annual_objective_id !== objId) {
      toast('Can only move key results within the same objective')
      return
    }
    moveKR(itemId, quarter)
  }

  // Column widths: Unscheduled + 4 quarters
  const COLS = '120px repeat(4, 1fr)'
  const MIN_W = 560

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Roadmap</h1>
          <p style={{ fontSize: 12, color: 'var(--navy-400)' }}>Plan your key results by quarter — drag to schedule</p>
        </div>
        <button onClick={() => setModal({ type: 'add_obj' })} className="btn-primary"
          style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          Add Objective
        </button>
      </div>

      {activeObjs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🗺</div>
          No objectives yet.<br />
          <span style={{ fontSize: 13 }}>Tap "Add Objective" to get started.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <div style={{ minWidth: MIN_W }}>

            {/* Quarter headers */}
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, marginBottom: 8, paddingLeft: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', padding: '7px 6px', borderRadius: 8, background: 'var(--navy-700)', color: 'var(--navy-400)', border: '1px dashed var(--navy-500)' }}>
                📥 Unscheduled
              </div>
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

                  {/* Lane header — full width */}
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

                  {/* KR chips row — 5 columns */}
                  <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, padding: '8px 8px 10px' }}>
                    {/* Unscheduled cell */}
                    <DropsCell
                      cellKey={cellKey(obj.id, null)}
                      dragOver={dragOver}
                      isActive={false}
                      objColor={obj.color}
                      onDragOver={e => onDragOver(e, cellKey(obj.id, null))}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={e => onDrop(e, obj.id, null)}
                    >
                      {objItems.filter(i => !i.quarter).map(item => (
                        <KRChip key={item.id} item={item} objColor={obj.color} quarter={null}
                          dragging={draggingId === item.id}
                          onDragStart={e => onDragStart(e, item.id)}
                          onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                          onClick={() => setModal({ type: 'edit_kr', item })} />
                      ))}
                      <AddKRBtn onClick={() => setModal({ type: 'add_kr', objId: obj.id, quarter: null })} color={obj.color} />
                    </DropsCell>

                    {/* Quarter cells */}
                    {ROLLING.map(q => (
                      <DropsCell key={q}
                        cellKey={cellKey(obj.id, q)}
                        dragOver={dragOver}
                        isActive={q === ACTIVE_Q}
                        objColor={obj.color}
                        onDragOver={e => onDragOver(e, cellKey(obj.id, q))}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={e => onDrop(e, obj.id, q)}
                      >
                        {objItems.filter(i => i.quarter === q).map(item => (
                          <KRChip key={item.id} item={item} objColor={obj.color} quarter={q}
                            dragging={draggingId === item.id}
                            onDragStart={e => onDragStart(e, item.id)}
                            onDragEnd={() => { setDraggingId(null); setDragOver(null) }}
                            onClick={() => setModal({ type: 'edit_kr', item })} />
                        ))}
                        <AddKRBtn onClick={() => setModal({ type: 'add_kr', objId: obj.id, quarter: q })} color={obj.color} />
                      </DropsCell>
                    ))}
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
          onClose={() => setModal(null)}
          onSave={o => {
            setObjectives(prev => modal.type === 'edit_obj' ? prev.map(x => x.id === o.id ? o : x) : [...prev, o])
            setModal(null)
            toast(modal.type === 'edit_obj' ? 'Objective updated.' : 'Objective added!')
          }}
          onAbandon={modal.type === 'edit_obj' ? async (obj) => {
            const next = obj.status === 'abandoned' ? 'active' : 'abandoned'
            await supabase.from('annual_objectives').update({ status: next }).eq('id', obj.id)
            setObjectives(prev => prev.map(o => o.id === obj.id ? { ...o, status: next } : o))
            setModal(null)
            toast(next === 'abandoned' ? 'Objective abandoned.' : 'Objective restored.')
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

      {modal?.type === 'edit_kr' && (
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

/* ── Drop cell ── */
function DropsCell({ cellKey, dragOver, isActive, objColor, onDragOver, onDragLeave, onDrop, children }: {
  cellKey: string; dragOver: string | null; isActive: boolean; objColor: string
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void
  children: React.ReactNode
}) {
  const isOver = dragOver === cellKey
  return (
    <div
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={{ minHeight: 52, borderRadius: 9, padding: '5px 5px 3px',
        background: isOver ? hex2rgba(objColor, 0.18) : isActive ? hex2rgba(objColor, 0.1) : 'transparent',
        border: isOver ? `1.5px solid ${objColor}` : isActive ? `1px dashed ${hex2rgba(objColor, 0.4)}` : '1px dashed var(--navy-600)',
        transition: 'background .12s, border .12s' }}>
      {children}
    </div>
  )
}

/* ── KR chip ── */
function KRChip({ item, objColor, quarter, dragging, onDragStart, onDragEnd, onClick }: {
  item: RoadmapItem; objColor: string; quarter: string | null
  dragging: boolean; onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void; onClick: () => void
}) {
  const isActive = quarter === ACTIVE_Q
  const isUnscheduled = !quarter
  return (
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}
      style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, padding: '5px 8px', borderRadius: 7, marginBottom: 4,
        cursor: 'grab', userSelect: 'none', lineHeight: 1.35, opacity: dragging ? 0.3 : 1, transition: 'opacity .12s',
        background: isUnscheduled ? 'var(--navy-700)' : isActive ? hex2rgba(objColor, 0.22) : 'var(--navy-700)',
        border: isUnscheduled ? '1.5px dashed var(--navy-500)' : isActive ? `1.5px solid ${hex2rgba(objColor, 0.6)}` : `1px solid var(--navy-500)`,
        color: isUnscheduled ? 'var(--navy-400)' : isActive ? 'var(--navy-50)' : 'var(--navy-200)' }}>
      {isActive && <span style={{ marginRight: 4 }}>⚡</span>}{item.title}
    </div>
  )
}

/* ── Add KR button ── */
function AddKRBtn({ onClick, color }: { onClick: () => void; color: string }) {
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
function ObjModal({ obj, objectives, onClose, onSave, onAbandon }: {
  obj?: AnnualObjective; objectives: AnnualObjective[]
  onClose: () => void; onSave: (o: AnnualObjective) => void
  onAbandon?: (obj: AnnualObjective) => void
}) {
  const [name, setName] = useState(obj?.name ?? '')
  const [color, setColor] = useState(obj?.color ?? COLORS[objectives.length % COLORS.length])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    if (obj) {
      await supabase.from('annual_objectives').update({ name, color }).eq('id', obj.id)
      onSave({ ...obj, name, color })
    } else {
      const { data } = await supabase.from('annual_objectives')
        .insert({ name, color, sort_order: objectives.length, status: 'active' }).select().single()
      if (data) onSave(data)
    }
    setSaving(false)
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
    if (item) {
      await supabase.from('roadmap_items').update({ title, quarter, status }).eq('id', item.id)
      onSave({ ...item, title, quarter, status })
    } else {
      const count = (await supabase.from('roadmap_items').select('id').eq('annual_objective_id', objId)).data?.length ?? 0
      const { data } = await supabase.from('roadmap_items')
        .insert({ annual_objective_id: objId, title, quarter, status, sort_order: count, health_status: 'not_started', progress: 0 })
        .select().single()
      if (data) onSave(data)
    }
    setSaving(false)
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

