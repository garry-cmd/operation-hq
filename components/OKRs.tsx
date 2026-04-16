'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import Modal from './Modal'

type HealthStatus = 'not_started' | 'on_track' | 'off_track' | 'blocked' | 'done'

const HEALTH_CYCLE: HealthStatus[] = ['not_started', 'on_track', 'off_track', 'blocked', 'done']

const HEALTH_STYLE: Record<HealthStatus, { bg: string; color: string; label: string }> = {
  not_started: { bg: 'var(--navy-600)',  color: 'var(--navy-300)', label: 'Not started' },
  on_track:    { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'On track' },
  off_track:   { bg: 'var(--red-bg)',    color: 'var(--red-text)',  label: 'Off track' },
  blocked:     { bg: 'var(--amber-bg)',  color: 'var(--amber-text)', label: 'Blocked' },
  done:        { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'Done' },
}

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  krs: QuarterlyKR[]
  setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  toast: (m: string) => void
}

export default function OKRs({ objectives, roadmapItems, setRoadmapItems, krs, setKrs, toast }: Props) {
  const [addMilestoneModal, setAddMilestoneModal] = useState<null | { roadmapItemId: string }>(null)

  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned' && !i.is_parked)
  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const onTrack  = activeItems.filter(i => i.health_status === 'on_track').length
  const offTrack = activeItems.filter(i => i.health_status === 'off_track').length

  async function cycleStatus(item: RoadmapItem) {
    const idx = HEALTH_CYCLE.indexOf(item.health_status)
    const next = HEALTH_CYCLE[(idx + 1) % HEALTH_CYCLE.length]
    await supabase.from('roadmap_items').update({ health_status: next }).eq('id', item.id)
    setRoadmapItems(prev => prev.map(i => i.id === item.id ? { ...i, health_status: next } : i))
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>
        {ACTIVE_Q} — Objectives &amp; Key Results
      </h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Apr 1 – Jun 30</p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 20 }}>
        {[
          ['Key Results',     activeItems.length,             'var(--accent)'],
          ['Milestones done', `${allKrs.filter(k=>k.status==='done').length}/${allKrs.length}`, 'var(--teal-text)'],
          ['On track',        onTrack,                        'var(--teal-text)'],
          ['Off track',       offTrack,                       'var(--red-text)'],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>{l}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          No active key results for {ACTIVE_Q}.<br />
          <span style={{ fontSize: 13 }}>Add key results on the Roadmap screen.</span>
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const milestones = krs.filter(k => k.roadmap_item_id === item.id)
        const doneMilestones = milestones.filter(k => k.status === 'done').length
        const pct = milestones.length ? Math.round(doneMilestones / milestones.length * 100) : 0
        const hs = item.health_status ?? 'not_started'
        const style = HEALTH_STYLE[hs]

        return (
          <div key={item.id} style={{ marginBottom: 14 }}>
            {/* Objective label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj?.color ?? 'var(--accent)', flexShrink: 0 }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.6px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {obj?.name}
              </div>
              <div style={{ height: 1, background: 'var(--navy-600)', width: 28, flexShrink: 0 }} />
            </div>

            {/* Key Result card */}
            <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden', borderLeft: `4px solid ${obj?.color ?? 'var(--accent)'}` }}>

              {/* KR header: title + progress + status pill */}
              <div style={{ padding: '13px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: milestones.length > 0 ? '1px solid var(--navy-600)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)', lineHeight: 1.35, marginBottom: 8 }}>
                    {item.title}
                  </div>
                  {/* Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 3, background: 'var(--navy-600)', borderRadius: 2 }}>
                      <div style={{ height: 3, borderRadius: 2, background: obj?.color ?? 'var(--accent)', width: `${pct}%`, transition: 'width .3s' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--navy-400)', fontWeight: 600, flexShrink: 0 }}>{pct}%</span>
                  </div>
                </div>

                {/* Status pill — tap to cycle */}
                <button
                  onClick={() => cycleStatus(item)}
                  style={{ flexShrink: 0, marginTop: 2, fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', background: style.bg, color: style.color, transition: 'all .12s', whiteSpace: 'nowrap' }}>
                  {style.label}
                </button>
              </div>

              {/* Milestone rows — plain bullets, no checkboxes */}
              {milestones.map((ms, i) => (
                <div key={ms.id} style={{ padding: '10px 16px 10px 20px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: i < milestones.length - 1 ? '1px solid var(--navy-600)' : 'none', minHeight: 40 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--navy-500)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--navy-200)', flex: 1, lineHeight: 1.4 }}>{ms.title}</span>
                  {ms.tag && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: 'var(--navy-700)', color: 'var(--navy-400)', flexShrink: 0 }}>{ms.tag}</span>}
                </div>
              ))}

              {/* Add milestone */}
              <button className="add-row-btn" onClick={() => setAddMilestoneModal({ roadmapItemId: item.id })}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                Add milestone
              </button>
            </div>
          </div>
        )
      })}

      {/* Add milestone modal */}
      {addMilestoneModal && (
        <Modal title="Add milestone" onClose={() => setAddMilestoneModal(null)}
          footer={<>
            <button className="btn" onClick={() => setAddMilestoneModal(null)}>Cancel</button>
            <button className="btn-primary" onClick={async () => {
              const titleEl = document.getElementById('ms-title') as HTMLTextAreaElement
              const tagEl   = document.getElementById('ms-tag') as HTMLInputElement
              if (!titleEl?.value.trim()) return
              const count = krs.filter(k => k.roadmap_item_id === addMilestoneModal.roadmapItemId).length
              const { data } = await supabase.from('quarterly_krs')
                .insert({ roadmap_item_id: addMilestoneModal.roadmapItemId, title: titleEl.value.trim(), tag: tagEl?.value || null, sort_order: count })
                .select().single()
              if (data) { setKrs(prev => [...prev, data]); toast('Milestone added!') }
              setAddMilestoneModal(null)
            }}>Add milestone</button>
          </>}>
          <div className="field">
            <label>Milestone</label>
            <textarea id="ms-title" className="input" rows={3} autoFocus placeholder="e.g. 4 cardio + 2 strength sessions/week" />
          </div>
          <div className="field">
            <label>Tag (optional)</label>
            <input id="ms-tag" className="input" placeholder="e.g. Weekly, Nutrition…" />
          </div>
        </Modal>
      )}
    </div>
  )
}
