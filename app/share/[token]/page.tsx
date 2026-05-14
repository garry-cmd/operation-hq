'use client'
import { use, useState, useEffect, Fragment } from 'react'
import { AnnualObjective, RoadmapItem, HealthStatus, Space } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import * as objectivesDb from '@/lib/db/objectives'
import * as krsDb from '@/lib/db/krs'
import * as shareTokensDb from '@/lib/db/shareTokens'
import * as spacesDb from '@/lib/db/spaces'

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
  // All-spaces mode signalled by share_tokens.space_id IS NULL — the share is
  // scoped to all of the user's spaces rather than one. Existing per-space
  // links still take the single-space branch below.
  const [spaces, setSpaces] = useState<Space[]>([])
  const [allSpaces, setAllSpaces] = useState(false)

  useEffect(() => {
    async function load() {
      const tokenRow = await shareTokensDb.findActiveByToken(token).catch(err => {
        console.error('share_tokens lookup failed:', err)
        return null
      })
      setValid(!!tokenRow)
      if (!tokenRow) return
      const isAll = tokenRow.space_id == null
      setAllSpaces(isAll)

      const [o, r, sp] = await Promise.all([
        isAll
          ? objectivesDb.listAll().catch(() => [] as AnnualObjective[])
          : objectivesDb.listBySpace(tokenRow.space_id!).catch(() => [] as AnnualObjective[]),
        krsDb.listByQuarter(ACTIVE_Q).catch(() => [] as RoadmapItem[]),
        isAll
          ? spacesDb.listAll().catch(() => [] as Space[])
          : Promise.resolve([] as Space[]),
      ])
      setObjectives(o)
      setSpaces(sp)
      // Scope KRs to the objectives we actually loaded. In all-spaces mode the
      // listAll above returns every objective, so this is effectively a no-op
      // there; in single-space mode it strips KRs from other spaces.
      const objectiveIds = new Set(o.map(obj => obj.id))
      setItems(r.filter(item => item.annual_objective_id !== null && objectiveIds.has(item.annual_objective_id)))
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

  // Render groups: in all-spaces mode, one group per space (skipping spaces
  // with no active KRs to surface); in single-space mode, a single headerless
  // group. Per-objective rendering downstream is identical for both.
  type Group = { space: Space | null; objectives: AnnualObjective[] }
  const groups: Group[] = allSpaces
    ? spaces
        .map(s => ({ space: s, objectives: objectives.filter(o => o.space_id === s.id) }))
        .filter(g => {
          const objIds = new Set(g.objectives.map(o => o.id))
          return activeKRs.some(kr => kr.annual_objective_id !== null && objIds.has(kr.annual_objective_id))
        })
    : [{ space: null, objectives }]

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
          {ACTIVE_Q}{allSpaces ? ' · all spaces' : ''} · Read only
        </span>
      </header>
      <main style={{ padding: '20px 16px', maxWidth: 700, margin: '0 auto' }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: allSpaces ? 4 : 20 }}>{ACTIVE_Q} Objectives &amp; Key Results</h1>
        {allSpaces && <p style={{ fontSize: 12, color: 'var(--navy-300)', margin: '0 0 20px' }}>All spaces · read-only snapshot</p>}

        {groups.map((group, gi) => (
          <Fragment key={group.space?.id ?? 'single'}>
            {group.space && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                margin: gi === 0 ? '6px 0 10px' : '22px 0 10px',
                paddingTop: gi === 0 ? 0 : 14,
                borderTop: gi === 0 ? 'none' : '1px solid var(--navy-700)',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: group.space.color }} />
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--navy-300)' }}>
                  {group.space.name}
                </div>
              </div>
            )}
            {group.objectives.map(obj => {
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
          </Fragment>
        ))}
      </main>
    </div>
  )
}
