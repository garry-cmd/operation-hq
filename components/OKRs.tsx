'use client'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction, HealthStatus } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  actions: WeeklyAction[]
  weekStart: string
  toast: (m: string) => void
}

const HEALTH_CYCLE: HealthStatus[] = ['not_started', 'on_track', 'off_track', 'blocked', 'done']
const HEALTH: Record<HealthStatus, { bg: string; color: string; label: string }> = {
  not_started: { bg: 'var(--navy-600)',  color: 'var(--navy-300)', label: 'Not started' },
  on_track:    { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'On track' },
  off_track:   { bg: 'var(--red-bg)',    color: 'var(--red-text)',  label: 'Off track' },
  blocked:     { bg: 'var(--amber-bg)',  color: 'var(--amber-text)', label: 'Blocked' },
  done:        { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'Done ✓' },
}

export default function OKRs({ objectives, roadmapItems, setRoadmapItems, actions, weekStart, toast }: Props) {
  const activeKRs = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned' && !i.is_parked)
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack = activeKRs.filter(i => i.health_status === 'on_track').length
  const offTrack = activeKRs.filter(i => i.health_status === 'off_track').length

  async function cycleStatus(item: RoadmapItem) {
    const idx = HEALTH_CYCLE.indexOf(item.health_status ?? 'not_started')
    const next = HEALTH_CYCLE[(idx + 1) % HEALTH_CYCLE.length]
    await supabase.from('roadmap_items').update({ health_status: next }).eq('id', item.id)
    setRoadmapItems(prev => prev.map(i => i.id === item.id ? { ...i, health_status: next } : i))
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>
        {ACTIVE_Q} OKRs
      </h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Apr 1 – Jun 30</p>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginBottom: 20 }}>
        {[
          ['Key Results',      activeKRs.length,        'var(--accent)'],
          ['On track',         onTrack,                 'var(--teal-text)'],
          ['Off track',        offTrack,                'var(--red-text)'],
          ['Actions this week',weekActions.length,      'var(--navy-50)'],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '11px 13px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {activeKRs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          No active key results yet.<br />
          <span style={{ fontSize: 13 }}>Use the + button to add key results.</span>
        </div>
      )}

      {objectives.map(obj => {
        const objKRs = activeKRs.filter(i => i.annual_objective_id === obj.id)
        if (!objKRs.length) return null
        return (
          <div key={obj.id} style={{ marginBottom: 18 }}>
            {/* Objective header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-50)' }}>{obj.name}</div>
            </div>

            {/* Single card for all KRs under this objective */}
            <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden', borderLeft: `4px solid ${obj.color}` }}>
              {objKRs.map((kr, i) => {
                const actCount = weekActions.filter(a => a.roadmap_item_id === kr.id).length
                const h = kr.health_status ?? 'not_started'
                const hs = HEALTH[h]
                return (
                  <div key={kr.id} style={{ borderTop: i > 0 ? '2px solid var(--navy-600)' : 'none' }}>
                    <div style={{ padding: '13px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* KR title */}
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-100)', lineHeight: 1.4, marginBottom: 8 }}>
                          {kr.title}
                        </div>
                        {/* Progress bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                          <div style={{ flex: 1, height: 4, background: 'var(--navy-600)', borderRadius: 2 }}>
                            <div style={{ height: 4, borderRadius: 2, background: obj.color, width: `${kr.progress ?? 0}%`, transition: 'width .3s' }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--navy-400)', fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{kr.progress ?? 0}%</span>
                        </div>
                        {/* Action count */}
                        <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                          {actCount === 0 ? 'No actions this week' : `${actCount} action${actCount > 1 ? 's' : ''} this week`}
                        </div>
                      </div>
                      {/* Status pill — tap to cycle */}
                      <button onClick={() => cycleStatus(kr)}
                        style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 99, border: 'none', cursor: 'pointer', background: hs.bg, color: hs.color, whiteSpace: 'nowrap', transition: 'all .12s', marginTop: 2 }}>
                        {hs.label}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
