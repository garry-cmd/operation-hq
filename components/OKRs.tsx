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

const STATUS_OPTS: { value: KRStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'on_track',    label: 'On track' },
  { value: 'off_track',   label: 'Off track' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'done',        label: 'Done' },
]

const STATUS_COLORS: Record<KRStatus, string> = {
  not_started: 'var(--navy-400)',
  on_track:    'var(--teal-text)',
  off_track:   'var(--red-text)',
  blocked:     'var(--amber-text)',
  done:        'var(--teal-text)',
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
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>{ACTIVE_Q} — Objectives &amp; Key Results</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Apr 1 – Jun 30</p>

      {/* Summary grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 20 }}>
        {[
          ['Objectives',   activeItems.length,                  'var(--accent)'],
          ['Milestones done', `${doneCount}/${allKrs.length}`,     'var(--teal-text)'],
          ['On track',     onTrack,                             'var(--teal-text)'],
          ['Off track',    offTrack,                            'var(--red-text)'],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          No active objectives for {ACTIVE_Q}.<br />Add key results on the Roadmap screen.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        const done = itemKrs.filter(k => k.status === 'done').length
        const pct = itemKrs.length ? Math.round(done / itemKrs.length * 100) : 0

        return (
          <div key={item.id} style={{ marginBottom: 14 }}>
            {/* Annual objective label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: obj?.color ?? 'var(--accent)', flexShrink: 0 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.5px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj?.name}</div>
              <div style={{ height: 1, background: 'var(--navy-600)', width: 32, flexShrink: 0 }} />
            </div>

            {/* Card */}
            <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden', borderLeft: `4px solid ${obj?.color ?? 'var(--accent)'}` }}>
              {/* Objective header */}
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--navy-600)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)', flex: 1, lineHeight: 1.35 }}>{item.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ width: 56, height: 4, borderRadius: 2, background: 'var(--navy-600)' }}>
                    <div style={{ height: 4, borderRadius: 2, background: obj?.color ?? 'var(--accent)', width: `${pct}%`, transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--navy-300)', fontWeight: 600, minWidth: 28 }}>{pct}%</span>
                </div>
              </div>

              {/* KR rows */}
              {itemKrs.map(kr => (
                <div key={kr.id} style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid var(--navy-600)', minHeight: 56 }}>
                  {/* Checkbox */}
                  <button onClick={() => setKRStatus(kr, kr.status === 'done' ? 'not_started' : 'done')}
                    style={{ width: 22, height: 22, borderRadius: 5, border: `2px solid ${kr.status === 'done' ? 'var(--teal)' : 'var(--navy-400)'}`, background: kr.status === 'done' ? 'var(--teal)' : 'transparent', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .12s', padding: 0 }}>
                    {kr.status === 'done' && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, lineHeight: 1.4, color: kr.status === 'done' ? 'var(--navy-400)' : 'var(--navy-100)', textDecoration: kr.status === 'done' ? 'line-through' : 'none', marginBottom: 8 }}>
                      {kr.title}
                      {kr.tag && <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--navy-600)', color: 'var(--navy-300)' }}>{kr.tag}</span>}
                    </div>
                    {/* Status selector — full width on its own row for easy tapping */}
                    <select value={kr.status} onChange={e => setKRStatus(kr, e.target.value as KRStatus)}
                      style={{ fontSize: 12, fontWeight: 600, border: `1px solid var(--navy-500)`, borderRadius: 8, padding: '6px 10px', background: 'var(--navy-800)', color: STATUS_COLORS[kr.status], cursor: 'pointer', minHeight: 36, width: '100%', maxWidth: 160 }}>
                      {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}

              {/* Add KR */}
              <button className="add-row-btn" onClick={() => setAddKRModal({ roadmapItemId: item.id })}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                Add milestone
              </button>
            </div>
          </div>
        )
      })}

      {addKRModal && (
        <Modal title="Add milestone" onClose={() => setAddKRModal(null)}
          footer={<>
            <button className="btn" onClick={() => setAddKRModal(null)}>Cancel</button>
            <button className="btn-primary" onClick={async () => {
              const el = document.getElementById('new-kr-title') as HTMLTextAreaElement
              const tagEl = document.getElementById('new-kr-tag') as HTMLInputElement
              if (!el?.value.trim()) return
              const count = krs.filter(k => k.roadmap_item_id === addKRModal.roadmapItemId).length
              const { data } = await supabase.from('quarterly_krs').insert({ roadmap_item_id: addKRModal.roadmapItemId, title: el.value, tag: tagEl?.value || null, sort_order: count }).select().single()
              if (data) { setKrs(prev => [...prev, data]); toast('Milestone added!') }
              setAddKRModal(null)
            }}>Add milestone</button>
          </>}>
          <div className="field">
            <label>Milestone</label>
            <textarea id="new-kr-title" className="input" rows={3} autoFocus placeholder="e.g. Maintain 500–750 kcal deficit, logged 6 days/week" />
          </div>
          <div className="field">
            <label>Tag (optional)</label>
            <input id="new-kr-tag" className="input" placeholder="e.g. Nutrition, Weekly…" />
          </div>
        </Modal>
      )}
    </div>
  )
}
