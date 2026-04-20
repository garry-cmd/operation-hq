'use client'
import { use, useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, HealthStatus } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'

const HEALTH: Record<HealthStatus, { bg: string; color: string; label: string }> = {
  not_started: { bg: 'var(--navy-600)',  color: 'var(--navy-300)', label: 'Not started' },
  backlog:     { bg: 'var(--navy-600)',  color: 'var(--navy-200)', label: 'Backlog' },
  on_track:    { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'On track' },
  off_track:   { bg: 'var(--red-bg)',    color: 'var(--red-text)',  label: 'Off track' },
  blocked:     { bg: 'var(--amber-bg)',  color: 'var(--amber-text)', label: 'Blocked' },
  done:        { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'Done ✓' },
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [valid, setValid] = useState<boolean | null>(null)
  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [items, setItems] = useState<RoadmapItem[]>([])

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('share_tokens').select('*').eq('token', token).eq('active', true).single()
      setValid(!!data)
      if (!data) return
      const [o, r] = await Promise.all([
        supabase.from('annual_objectives').select('*').eq('space_id', data.space_id).order('sort_order'),
        supabase.from('roadmap_items').select('*').eq('quarter', ACTIVE_Q).order('sort_order'),
      ])
      setObjectives(o.data ?? [])
      // Filter roadmap items to only those belonging to objectives in this space
      const objectiveIds = o.data?.map(obj => obj.id) ?? []
      setItems((r.data ?? []).filter(item => objectiveIds.includes(item.annual_objective_id)))
    }
    load()
  }, [token])

  if (valid === null) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-900)' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (!valid) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-900)', color: 'var(--navy-400)', fontSize: 14 }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>This link is invalid or has been disabled.</div>
    </div>
  )

  const activeKRs = items.filter(i => i.status !== 'abandoned' && !i.is_parked)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--navy-900)' }}>
      <div style={{ textAlign: 'center', fontSize: 12, padding: '8px 16px', background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>
        👁 Read-only view shared from Operation HQ
      </div>
      <header style={{ padding: '0 20px', height: 54, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--navy-800)', borderBottom: '1px solid var(--navy-600)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--navy-50)' }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>
        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, fontWeight: 600, background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          {ACTIVE_Q} · Read only
        </span>
      </header>
      <main style={{ padding: '20px 16px', maxWidth: 700, margin: '0 auto' }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 20 }}>{ACTIVE_Q} Objectives &amp; Key Results</h1>

        {objectives.map(obj => {
          const objKRs = activeKRs.filter(i => i.annual_objective_id === obj.id)
          if (!objKRs.length) return null
          return (
            <div key={obj.id} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color }} />
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-50)' }}>{obj.name}</div>
              </div>
              <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden', borderLeft: `4px solid ${obj.color}` }}>
                {objKRs.map((kr, i) => {
                  const h = kr.health_status ?? 'not_started'
                  const hs = HEALTH[h]
                  return (
                    <div key={kr.id} style={{ borderTop: i > 0 ? '2px solid var(--navy-600)' : 'none', padding: '13px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-100)', lineHeight: 1.4, marginBottom: 8 }}>{kr.title}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 4, background: 'var(--navy-600)', borderRadius: 2 }}>
                            <div style={{ height: 4, borderRadius: 2, background: obj.color, width: `${kr.progress ?? 0}%` }} />
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--navy-400)', fontWeight: 600, minWidth: 28, textAlign: 'right' }}>{kr.progress ?? 0}%</span>
                        </div>
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 99, background: hs.bg, color: hs.color, whiteSpace: 'nowrap', marginTop: 2 }}>
                        {hs.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </main>
    </div>
  )
}
