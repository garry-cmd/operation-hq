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

export default function Roadmap({ objectives, roadmapItems, setObjectives, setRoadmapItems, toast }: Props) {
  const [modal, setModal] = useState<null | { type: string; obj?: AnnualObjective; item?: RoadmapItem; annualObjId?: string; quarter?: string }>(null)

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
          <h1 className="text-base font-semibold text-gray-900">Annual Roadmap</h1>
          <p className="text-xs text-gray-400 mt-0.5">Set milestones per quarter — active quarter flows into your OKRs</p>
        </div>
        <button className="btn-primary text-xs px-3 py-1.5" onClick={() => setModal({ type: 'add_obj' })}>
          + Add objective
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mb-3">
        {[
          ['bg-[#E1F5EE] border border-[#1D9E75]', 'Active quarter — flows to OKRs'],
          ['bg-gray-50 border border-gray-200', 'Planned'],
          ['opacity-40 bg-gray-50 border border-gray-200', 'Done'],
        ].map(([cls, label]) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <div className={`w-3 h-3 rounded-sm ${cls}`} />
            {label}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-2" style={{ gridTemplateColumns: '176px repeat(4, 1fr)' }}>
        {/* Quarter headers */}
        <div />
        {QUARTERS.map(q => (
          <div key={q} className={`text-[11px] font-medium text-center py-2 px-2 rounded-lg ${
            q === ACTIVE_Q
              ? 'bg-[#E1F5EE] text-[#0F6E56] border border-[#1D9E75] font-semibold'
              : 'bg-gray-100 text-gray-500'
          }`}>
            {q}{q === ACTIVE_Q ? ' — active' : ''}
          </div>
        ))}

        {objectives.map((obj, idx) => (
          <div key={obj.id} className="contents">
            {/* Annual objective cell */}
            <div className={`bg-white rounded-lg border border-gray-200 p-2.5 flex flex-col gap-1 ${obj.status === 'abandoned' ? 'opacity-45' : ''}`}>
              <div className="w-2 h-2 rounded-full" style={{ background: obj.color }} />
              <div className="text-[9px] font-medium text-gray-400 uppercase tracking-wide">Annual objective</div>
              <div className={`text-[11px] font-medium text-gray-900 leading-snug ${obj.status === 'abandoned' ? 'line-through text-gray-400' : ''}`}>
                {obj.name}
              </div>
              <div className="flex gap-1 mt-1">
                <button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  onClick={() => setModal({ type: 'edit_obj', obj })}>edit</button>
                <button className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  onClick={() => abandonObjective(obj)}>
                  {obj.status === 'abandoned' ? 'restore' : 'abandon'}
                </button>
              </div>
            </div>

            {/* Quarter cells */}
            {QUARTERS.map(q => {
              const items = roadmapItems.filter(i => i.annual_objective_id === obj.id && i.quarter === q)
              return (
                <div key={q} className={`bg-white rounded-lg border p-2 flex flex-col gap-1.5 min-h-[88px] ${
                  q === ACTIVE_Q ? 'border-[#1D9E7555]' : 'border-gray-200'
                }`}>
                  {items.map(item => (
                    <div key={item.id} className={`text-[11px] px-2 py-1.5 rounded-lg border flex items-start gap-1.5 leading-snug group ${
                      item.status === 'done' ? 'opacity-40 line-through bg-gray-50 border-gray-200' :
                      item.status === 'abandoned' ? 'opacity-40 line-through bg-gray-50 border-gray-200' :
                      q === ACTIVE_Q ? 'bg-[#E1F5EE] border-[#1D9E75] text-[#0F6E56]' :
                      'bg-gray-50 border-gray-200 text-gray-800'
                    }`}>
                      {q === ACTIVE_Q && item.status !== 'done' && item.status !== 'abandoned' && (
                        <span className="text-[9px] opacity-70 mt-0.5 shrink-0">→Q</span>
                      )}
                      <span className="flex-1">{item.title}</span>
                      <span className="opacity-0 group-hover:opacity-100 flex gap-0.5 shrink-0">
                        <button className="text-[10px] hover:opacity-80" onClick={() => setModal({ type: 'edit_item', item })}>✎</button>
                        <button className="text-[10px] hover:opacity-80" onClick={() => toggleKRDone(item)}>
                          {item.status === 'done' ? '↩' : '✓'}
                        </button>
                      </span>
                    </div>
                  ))}
                  <button className="text-[11px] text-gray-400 hover:text-[#1D9E75] text-left px-1"
                    onClick={() => setModal({ type: 'add_item', annualObjId: obj.id, quarter: q })}>
                    + add
                  </button>
                </div>
              )
            })}

            {idx < objectives.length - 1 && (
              <div className="col-span-5 h-px bg-gray-100 my-1" />
            )}
          </div>
        ))}

        {objectives.length === 0 && (
          <div className="col-span-5 text-center py-12 text-gray-400 text-sm">
            <div className="text-3xl mb-2">🎯</div>
            No objectives yet — add your first annual objective to get started.
          </div>
        )}
      </div>

      {/* Modals */}
      {(modal?.type === 'add_obj' || modal?.type === 'edit_obj') && (
        <ObjModal
          obj={modal.obj}
          objectives={objectives}
          onClose={() => setModal(null)}
          onSave={(o) => { setObjectives(prev => modal.obj ? prev.map(x => x.id === o.id ? o : x) : [...prev, o]); setModal(null); toast(modal.obj ? 'Objective updated.' : 'Objective added!') }}
        />
      )}
      {(modal?.type === 'add_item' || modal?.type === 'edit_item') && (
        <ItemModal
          item={modal.item}
          annualObjId={modal.annualObjId}
          quarter={modal.quarter}
          roadmapItems={roadmapItems}
          onClose={() => setModal(null)}
          onSave={(i) => { setRoadmapItems(prev => modal.item ? prev.map(x => x.id === i.id ? i : x) : [...prev, i]); setModal(null); toast(modal.item ? 'Milestone updated.' : 'Milestone added!') }}
          onDelete={(id) => { setRoadmapItems(prev => prev.filter(x => x.id !== id)); setModal(null) }}
        />
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
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="field">
        <label>Objective name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus
          placeholder="e.g. Greek God — peak health & conditioning" />
      </div>
      <div className="field">
        <label>Colour</label>
        <div className="flex gap-2 flex-wrap mt-1">
          {COLORS.map(c => (
            <div key={c} onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full cursor-pointer border-2 transition-transform ${color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
              style={{ background: c }} />
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
        {item && <button className="btn mr-auto text-[#993C1D] border-[#FAECE7]" onClick={del}>Delete</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="field">
        <label>Milestone title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder="e.g. Lose 40 lbs by end of quarter" />
      </div>
      {item && (
        <div className="field">
          <label>Status</label>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
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
