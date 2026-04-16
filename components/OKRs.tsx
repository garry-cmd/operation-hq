'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, KRStatus } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import Modal from './Modal'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]
  setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  toast: (m: string) => void
}

export default function OKRs({ objectives, roadmapItems, krs, setKrs, toast }: Props) {
  const [addKRModal, setAddKRModal] = useState<null | { roadmapItemId: string }>(null)
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned' && !i.is_parked)
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
      <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 4 }}>{ACTIVE_Q} Objectives &amp; Key Results</h1>
      <p style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 16 }}>Apr 1 – Jun 30</p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 18 }}>
        {[['Objectives', activeItems.length, 'var(--accent)'], ['KRs complete', `${doneCount}/${allKrs.length}`, 'var(--teal-text)'], ['On track', onTrack, 'var(--teal-text)'], ['Off track', offTrack, 'var(--red-text)']].map(([l, v, c]) => (
          <div key={l as string} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--navy-400)', marginBottom: 3, fontWeight: 500 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-500)', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
          No active objectives for {ACTIVE_Q}. Add milestones on the Roadmap screen.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        const done = itemKrs.filter(k => k.status === 'done').length
        const pct = itemKrs.length ? Math.round(done / itemKrs.length * 100) : 0
        return (
          <div key={item.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj?.color ?? '#888', flexShrink: 0 }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj?.name}</div>
              <div style={{ height: 1, background: 'var(--navy-600)', width: 40, flexShrink: 0 }} />
            </div>
            <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--navy-600)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-50)', flex: 1 }}>{item.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <div style={{ width: 56, height: 3, borderRadius: 2, background: 'var(--navy-600)' }}>
                    <div style={{ height: 3, borderRadius: 2, background: obj?.color ?? 'var(--teal)', width: `${pct}%` }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>{pct}%</span>
                </div>
              </div>
              {itemKrs.map(kr => (
                <div key={kr.id} style={{ padding: '8px 14px 8px 34px', display: 'flex', alignItems: 'flex-start', gap: 10, borderBottom: '1px solid var(--navy-800)' }}>
                  <button onClick={() => setKRStatus(kr, kr.status === 'done' ? 'not_started' : 'done')}
                    style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${kr.status === 'done' ? 'var(--teal)' : 'var(--navy-500)'}`, background: kr.status === 'done' ? 'var(--teal)' : 'transparent', flexShrink: 0, marginTop: 2, marginLeft: -20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {kr.status === 'done' && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                  <span style={{ fontSize: 12, flex: 1, lineHeight: 1.4, color: kr.status === 'done' ? 'var(--navy-500)' : 'var(--navy-100)', textDecoration: kr.status === 'done' ? 'line-through' : 'none' }}>{kr.title}</span>
                  {kr.tag && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: 'var(--navy-600)', color: 'var(--navy-400)', flexShrink: 0 }}>{kr.tag}</span>}
                  <select value={kr.status} onChange={e => setKRStatus(kr, e.target.value as KRStatus)}
                    style={{ fontSize: 10, border: '1px solid var(--navy-500)', borderRadius: 8, padding: '2px 6px', background: 'var(--navy-800)', color: 'var(--navy-200)', flexShrink: 0 }}>
                    <option value="not_started">Not started</option>
                    <option value="on_track">On track</option>
                    <option value="off_track">Off track</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              ))}
              <div style={{ padding: '7px 14px' }}>
                <button style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-500)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--navy-500)')}
                  onClick={() => setAddKRModal({ roadmapItemId: item.id })}>+ add key result</button>
              </div>
            </div>
          </div>
        )
      })}

      {addKRModal && (
        <Modal title="Add key result" onClose={() => setAddKRModal(null)}
          footer={<><button className="btn" onClick={() => setAddKRModal(null)}>Cancel</button><button className="btn-primary" onClick={async () => {
            const el = document.getElementById('new-kr-title') as HTMLTextAreaElement
            const tagEl = document.getElementById('new-kr-tag') as HTMLInputElement
            if (!el?.value.trim()) return
            const count = krs.filter(k => k.roadmap_item_id === addKRModal.roadmapItemId).length
            const { data } = await supabase.from('quarterly_krs').insert({ roadmap_item_id: addKRModal.roadmapItemId, title: el.value, tag: tagEl?.value || null, sort_order: count }).select().single()
            if (data) { setKrs(prev => [...prev, data]); toast('Key result added!') }
            setAddKRModal(null)
          }}>Add KR</button></>}>
          <div className="field"><label>Key result</label><textarea id="new-kr-title" className="input" rows={3} autoFocus placeholder="e.g. Maintain 500–750 kcal deficit, logged 6 days/week" /></div>
          <div className="field"><label>Tag (optional)</label><input id="new-kr-tag" className="input" placeholder="e.g. Nutrition, Weekly…" /></div>
        </Modal>
      )}
    </div>
  )
}
