'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, KRStatus } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import StatusPill from './StatusPill'
import Modal from './Modal'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]
  setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  toast: (m: string) => void
}

export default function OKRs({ objectives, roadmapItems, krs, setKrs, toast }: Props) {
  const [modal, setModal] = useState<null | { roadmapItemId: string }>(null)
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned')

  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const doneCount = allKrs.filter(k => k.status === 'done').length
  const onTrack = allKrs.filter(k => k.status === 'on_track').length
  const offTrack = allKrs.filter(k => k.status === 'off_track').length

  async function setKRStatus(kr: QuarterlyKR, status: KRStatus) {
    await supabase.from('quarterly_krs').update({ status }).eq('id', kr.id)
    setKrs(prev => prev.map(k => k.id === kr.id ? { ...k, status } : k))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-base font-semibold text-gray-900">{ACTIVE_Q} Objectives &amp; Key Results</h1>
          <p className="text-xs text-gray-400 mt-0.5">Sourced from your {ACTIVE_Q} roadmap milestones</p>
        </div>
        <span className="text-xs font-medium px-3 py-1 rounded-lg bg-[#E1F5EE] text-[#0F6E56]">Apr 1 – Jun 30</span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2.5 mb-4">
        {[
          ['Objectives', activeItems.length, 'text-gray-900'],
          ['KRs complete', `${doneCount}/${allKrs.length}`, 'text-[#1D9E75]'],
          ['On track', onTrack, 'text-[#1D9E75]'],
          ['Off track', offTrack, 'text-[#D85A30]'],
        ].map(([label, val, cls]) => (
          <div key={label as string} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="text-[11px] text-gray-400 mb-1">{label}</div>
            <div className={`text-2xl font-semibold leading-none ${cls}`}>{val}</div>
          </div>
        ))}
      </div>

      {activeItems.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          <div className="text-3xl mb-2">📋</div>
          No active roadmap items for {ACTIVE_Q}. Add milestones on the Roadmap tab.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        const done = itemKrs.filter(k => k.status === 'done').length
        const pct = itemKrs.length ? Math.round(done / itemKrs.length * 100) : 0

        return (
          <div key={item.id} className="bg-white rounded-xl border border-gray-200 mb-3 overflow-hidden">
            {/* Objective header */}
            <div className="px-4 py-3 flex items-start gap-2.5 border-b border-gray-100">
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: obj?.color ?? '#888' }} />
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                {obj && <div className="text-[10px] text-gray-400 mt-0.5">↑ from Roadmap · {obj.name}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-20 h-1 rounded-full bg-gray-100">
                  <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: obj?.color ?? '#1D9E75' }} />
                </div>
                <span className="text-[11px] text-gray-500 w-7 text-right">{pct}%</span>
              </div>
            </div>

            {/* KR rows */}
            {itemKrs.map(kr => (
              <div key={kr.id} className="px-4 py-2.5 pl-9 flex items-start gap-2.5 border-b border-gray-50 last:border-0">
                <button
                  onClick={() => setKRStatus(kr, kr.status === 'done' ? 'not_started' : 'done')}
                  className={`w-3.5 h-3.5 rounded shrink-0 mt-0.5 border-[1.5px] flex items-center justify-center transition-colors ${
                    kr.status === 'done' ? 'bg-[#1D9E75] border-[#1D9E75]' : 'border-gray-300 bg-white'
                  }`}
                >
                  {kr.status === 'done' && (
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                      <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
                <span className={`text-xs flex-1 leading-relaxed ${kr.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {kr.title}
                </span>
                {kr.tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">{kr.tag}</span>}
                <select
                  value={kr.status}
                  onChange={e => setKRStatus(kr, e.target.value as KRStatus)}
                  className="text-[10px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white text-gray-700 shrink-0"
                >
                  <option value="not_started">Not started</option>
                  <option value="on_track">On track</option>
                  <option value="off_track">Off track</option>
                  <option value="blocked">Blocked</option>
                  <option value="done">Done</option>
                </select>
              </div>
            ))}

            {/* Add KR */}
            <div className="px-4 py-2 border-t border-gray-50">
              <button className="text-[11px] text-gray-400 hover:text-[#1D9E75] transition-colors"
                onClick={() => setModal({ roadmapItemId: item.id })}>
                + Add key result
              </button>
            </div>
          </div>
        )
      })}

      {modal && (
        <AddKRModal
          roadmapItemId={modal.roadmapItemId}
          krs={krs}
          onClose={() => setModal(null)}
          onSave={(kr) => { setKrs(prev => [...prev, kr]); setModal(null); toast('Key result added!') }}
        />
      )}
    </div>
  )
}

function AddKRModal({ roadmapItemId, krs, onClose, onSave }: {
  roadmapItemId: string; krs: QuarterlyKR[]
  onClose: () => void; onSave: (kr: QuarterlyKR) => void
}) {
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const count = krs.filter(k => k.roadmap_item_id === roadmapItemId).length
    const { data } = await supabase.from('quarterly_krs')
      .insert({ roadmap_item_id: roadmapItemId, title, tag: tag || null, sort_order: count })
      .select().single()
    if (data) onSave(data)
    setSaving(false)
  }

  return (
    <Modal title="Add key result" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add KR'}</button>
      </>}>
      <div className="field">
        <label>Key result</label>
        <textarea className="input resize-none" rows={3} value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder="e.g. Maintain 500–750 kcal deficit, logged 6 days/week" />
      </div>
      <div className="field">
        <label>Tag (optional)</label>
        <input className="input" value={tag} onChange={e => setTag(e.target.value)}
          placeholder="e.g. Nutrition, Weekly, Content…" />
      </div>
    </Modal>
  )
}
