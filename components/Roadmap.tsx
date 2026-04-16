'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { QUARTERS, ACTIVE_Q, COLORS } from '@/lib/utils'
import Modal from './Modal'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  toast: (m: string) => void
}

// Key for identifying a specific quarter cell during drag
type CellKey = string // `${objId}::${quarter}`

const S = {
  card: { background: 'var(--navy-700)', border: '1px solid var(--navy-600)' },
  cardActive: { background: 'var(--navy-700)', border: '1px solid var(--accent-dim)' },
  chip: { background: 'var(--navy-600)', border: '1px solid var(--navy-500)', color: 'var(--navy-100)' },
  chipActive: { background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)' },
  qHeader: { background: 'var(--navy-700)', color: 'var(--navy-300)' },
  qHeaderActive: { background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)' },
  label: { color: 'var(--navy-400)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.5px' },
  name: { color: 'var(--navy-50)', fontSize: 11, fontWeight: 500, lineHeight: 1.35 },
  nameAbandoned: { color: 'var(--navy-500)', fontSize: 11, fontWeight: 500, textDecoration: 'line-through' },
  muted: { color: 'var(--navy-400)', fontSize: 11 },
}

export default function Roadmap({ objectives, roadmapItems, setObjectives, setRoadmapItems, toast }: Props) {
  const [modal, setModal] = useState<null | { type: string; obj?: AnnualObjective; item?: RoadmapItem; annualObjId?: string; quarter?: string }>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverCell, setDragOverCell] = useState<CellKey | null>(null)
  const [draggingObjId, setDraggingObjId] = useState<string | null>(null)
  const [dragOverObjId, setDragOverObjId] = useState<string | null>(null)

  async function reorderObjective(draggedId: string, targetId: string) {
    if (draggedId === targetId) return
    const list = [...objectives]
    const fromIdx = list.findIndex(o => o.id === draggedId)
    const toIdx = list.findIndex(o => o.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const reordered = [...list]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    const updated = reordered.map((o, i) => ({ ...o, sort_order: i }))
    setObjectives(() => updated)
    await Promise.all(updated.map(o => supabase.from('annual_objectives').update({ sort_order: o.sort_order }).eq('id', o.id)))
  }

  async function moveItem(itemId: string, targetQuarter: string) {
    const item = roadmapItems.find(i => i.id === itemId)
    if (!item || item.quarter === targetQuarter) return
    const newStatus = targetQuarter === ACTIVE_Q ? 'active' : 'planned'
    await supabase.from('roadmap_items').update({ quarter: targetQuarter, status: newStatus }).eq('id', itemId)
    setRoadmapItems(prev => prev.map(i => i.id === itemId ? { ...i, quarter: targetQuarter, status: newStatus } : i))
    toast(`Moved to ${targetQuarter}`)
  }

  async function toggleKRDone(item: RoadmapItem) {
    const next = item.status === 'done' ? 'planned' : 'done'
    await supabase.from('roadmap_items').update({ status: next }).eq('id', item.id)
    setRoadmapItems(prev => prev.map(i => i.id === item.id ? { ...i, status: next } : i))
  }

  async function abandonObjective(obj: AnnualObjective) {
    const next = obj.status === 'abandoned' ? 'active' : 'abandoned'
    await supabase.from('annual_objectives').update({ status: next }).eq('id', obj.id)
    setObjectives(prev => prev.map(o => o.id === obj.id ? { ...o, status: next } : o))
    toast(next === 'abandoned' ? 'Objective abandoned.' : 'Objective restored.')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--navy-50)' }}>Annual Roadmap</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--navy-400)' }}>Set milestones per quarter — active quarter flows into your OKRs</p>
        </div>
        <button className="btn-primary text-xs px-3 py-1.5" onClick={() => setModal({ type: 'add_obj' })}>
          + Add objective
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-3">
        {([
          [S.chipActive, '→Q Active quarter'],
          [S.chip, 'Planned'],
          [{ ...S.chip, opacity: 0.4 }, 'Done'],
        ] as [React.CSSProperties, string][]).map(([style, label]) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--navy-400)' }}>
            <div className="w-3 h-3 rounded-sm" style={style} />
            {label}
          </div>
        ))}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: '176px repeat(4, 1fr)' }}>
        {/* Quarter headers */}
        <div />
        {QUARTERS.map(q => (
          <div key={q} className="text-[11px] font-semibold text-center py-2 px-2 rounded-xl"
            style={q === ACTIVE_Q ? S.qHeaderActive : S.qHeader}>
            {q}{q === ACTIVE_Q ? ' — active' : ''}
          </div>
        ))}

        {objectives.map((obj, idx) => (
          <div key={obj.id} className="contents">
            {/* Annual objective cell — draggable to reorder */}
            <div
              draggable
              onDragStart={e => { e.dataTransfer.setData('objId', obj.id); setDraggingObjId(obj.id) }}
              onDragEnd={() => { setDraggingObjId(null); setDragOverObjId(null) }}
              onDragOver={e => { e.preventDefault(); setDragOverObjId(obj.id) }}
              onDragLeave={() => setDragOverObjId(null)}
              onDrop={e => {
                e.preventDefault()
                const draggedId = e.dataTransfer.getData('objId')
                if (draggedId) reorderObjective(draggedId, obj.id)
                setDraggingObjId(null); setDragOverObjId(null)
              }}
              className="rounded-xl p-3 flex flex-col gap-1.5"
              style={{
                ...S.card,
                opacity: obj.status === 'abandoned' ? .45 : draggingObjId === obj.id ? 0.4 : 1,
                cursor: 'grab',
                outline: dragOverObjId === obj.id && draggingObjId !== obj.id ? '2px solid var(--accent)' : 'none',
                outlineOffset: '-2px',
                transition: 'outline .1s, opacity .1s',
              }}>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: obj.color }} />
                <span style={{ color: 'var(--navy-600)', fontSize: 12, letterSpacing: 1, userSelect: 'none' as const }}>⠿</span>
              </div>
              <div style={S.label}>Annual objective</div>
              <div style={obj.status === 'abandoned' ? S.nameAbandoned : S.name}>{obj.name}</div>
              <div className="flex gap-1 mt-0.5">
                <button onClick={() => setModal({ type: 'edit_obj', obj })}
                  className="text-[10px] px-1.5 py-0.5 rounded-lg" style={{ ...S.chip, fontSize: 10 }}>edit</button>
                <button onClick={() => abandonObjective(obj)}
                  className="text-[10px] px-1.5 py-0.5 rounded-lg" style={{ ...S.chip, fontSize: 10 }}>
                  {obj.status === 'abandoned' ? 'restore' : 'abandon'}
                </button>
              </div>
            </div>

            {QUARTERS.map(q => {
              const items = roadmapItems.filter(i => i.annual_objective_id === obj.id && i.quarter === q)
              const cellKey: CellKey = `${obj.id}::${q}`
              const isOver = dragOverCell === cellKey
              return (
                <div key={q}
                  className="rounded-xl p-2 flex flex-col gap-1.5 min-h-[88px] transition-all"
                  style={{
                    ...(q === ACTIVE_Q ? S.cardActive : S.card),
                    ...(isOver ? { border: '1px solid var(--accent)', background: 'var(--accent-dim)', outline: '2px solid var(--accent)', outlineOffset: '-2px' } : {}),
                  }}
                  onDragOver={e => { e.preventDefault(); setDragOverCell(cellKey) }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCell(null) }}
                  onDrop={e => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('itemId')
                    if (id) moveItem(id, q)
                    setDragOverCell(null)
                    setDraggingId(null)
                  }}
                >
                  {items.map(item => (
                    <div key={item.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.setData('itemId', item.id); setDraggingId(item.id) }}
                      onDragEnd={() => { setDraggingId(null); setDragOverCell(null) }}
                      className="text-[11px] px-2 py-1.5 rounded-lg flex items-start gap-1.5 leading-snug group"
                      style={{
                        cursor: 'grab',
                        opacity: draggingId === item.id ? 0.4 : 1,
                        ...(item.status === 'done' || item.status === 'abandoned'
                          ? { ...S.chip, opacity: 0.4, textDecoration: 'line-through' }
                          : q === ACTIVE_Q ? S.chipActive : S.chip),
                      }}>
                      {q === ACTIVE_Q && item.status !== 'done' && item.status !== 'abandoned' && (
                        <span className="opacity-70 shrink-0 mt-0.5" style={{ fontSize: 9 }}>→Q</span>
                      )}
                      <span className="flex-1">{item.title}</span>
                      <span className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                        <button className="hover:opacity-80" style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                          onClick={() => setModal({ type: 'edit_item', item })}>✎</button>
                        <button className="hover:opacity-80" style={{ fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                          onClick={() => toggleKRDone(item)}>{item.status === 'done' ? '↩' : '✓'}</button>
                      </span>
                    </div>
                  ))}
                  <button className="text-[11px] text-left px-1 transition-colors"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-500)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--navy-500)')}
                    onClick={() => setModal({ type: 'add_item', annualObjId: obj.id, quarter: q })}>+ add</button>
                </div>
              )
            })}

            {idx < objectives.length - 1 && (
              <div className="col-span-5 h-px my-1" style={{ background: 'var(--navy-700)' }} />
            )}
          </div>
        ))}

        {objectives.length === 0 && (
          <div className="col-span-5 text-center py-12 text-sm" style={{ color: 'var(--navy-400)' }}>
            <div className="text-3xl mb-2">🎯</div>
            No objectives yet — add your first annual objective to get started.
          </div>
        )}
      </div>

      {(modal?.type === 'add_obj' || modal?.type === 'edit_obj') && (
        <ObjModal obj={modal.obj} objectives={objectives} onClose={() => setModal(null)}
          onSave={(o) => { setObjectives(prev => modal.obj ? prev.map(x => x.id === o.id ? o : x) : [...prev, o]); setModal(null); toast(modal.obj ? 'Objective updated.' : 'Objective added!') }} />
      )}
      {(modal?.type === 'add_item' || modal?.type === 'edit_item') && (
        <ItemModal item={modal.item} annualObjId={modal.annualObjId} quarter={modal.quarter}
          roadmapItems={roadmapItems} onClose={() => setModal(null)}
          onSave={(i) => { setRoadmapItems(prev => modal.item ? prev.map(x => x.id === i.id ? i : x) : [...prev, i]); setModal(null); toast(modal.item ? 'Milestone updated.' : 'Milestone added!') }}
          onDelete={(id) => { setRoadmapItems(prev => prev.filter(x => x.id !== id)); setModal(null) }} />
      )}
    </div>
  )
}

function ObjModal({ obj, objectives, onClose, onSave }: {
  obj?: AnnualObjective; objectives: AnnualObjective[]
  onClose: () => void; onSave: (o: AnnualObjective) => void
}) {
  const [name, setName] = useState(obj?.name ?? '')
  const [color, setColor] = useState(obj?.color ?? COLORS[0])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    if (obj) {
      await supabase.from('annual_objectives').update({ name, color }).eq('id', obj.id)
      onSave({ ...obj, name, color })
    } else {
      const { data } = await supabase.from('annual_objectives')
        .insert({ name, color, sort_order: objectives.length }).select().single()
      if (data) onSave(data)
    }
    setSaving(false)
  }

  return (
    <Modal title={obj ? 'Edit objective' : 'Add annual objective'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <div className="field">
        <label>Objective name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Greek God — peak health & conditioning" />
      </div>
      <div className="field">
        <label>Colour</label>
        <div className="flex gap-2 flex-wrap mt-1">
          {COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)}
              className="w-6 h-6 rounded-full cursor-pointer transition-transform"
              style={{ background: c, border: color === c ? '2px solid white' : '2px solid transparent', transform: color === c ? 'scale(1.15)' : 'scale(1)' }} />
          ))}
        </div>
      </div>
    </Modal>
  )
}

function ItemModal({ item, annualObjId, quarter, roadmapItems, onClose, onSave, onDelete }: {
  item?: RoadmapItem; annualObjId?: string; quarter?: string
  roadmapItems: RoadmapItem[]
  onClose: () => void; onSave: (i: RoadmapItem) => void; onDelete: (id: string) => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [status, setStatus] = useState(item?.status ?? 'planned')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    if (item) {
      await supabase.from('roadmap_items').update({ title, status }).eq('id', item.id)
      onSave({ ...item, title, status: status as RoadmapItem['status'] })
    } else {
      const count = roadmapItems.filter(i => i.annual_objective_id === annualObjId && i.quarter === quarter).length
      const { data } = await supabase.from('roadmap_items')
        .insert({ annual_objective_id: annualObjId, quarter, title, status: quarter === ACTIVE_Q ? 'active' : 'planned', sort_order: count })
        .select().single()
      if (data) onSave(data)
    }
    setSaving(false)
  }

  async function del() {
    if (!item || !confirm('Delete this milestone?')) return
    await supabase.from('roadmap_items').delete().eq('id', item.id)
    onDelete(item.id)
  }

  return (
    <Modal title={item ? 'Edit milestone' : `Add milestone — ${quarter}`} onClose={onClose}
      footer={<>
        {item && <button className="btn mr-auto" style={{ color: 'var(--red-text)', borderColor: 'var(--red-bg)' }} onClick={del}>Delete</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="field">
        <label>Milestone title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Lose 40 lbs by end of quarter" />
      </div>
      {item && (
        <div className="field">
          <label>Status</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value as RoadmapItem['status'])}>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
            <option value="abandoned">Abandoned</option>
          </select>
        </div>
      )}
    </Modal>
  )
}
