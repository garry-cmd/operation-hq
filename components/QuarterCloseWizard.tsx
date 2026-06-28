'use client'
/**
 * QuarterCloseWizard — the quarter-end OKR ritual.
 *
 * Step 1 · Score Key Results      — per-KR 0.0–1.0 grade + optional note
 * Step 2 · Grade Objectives       — per-objective summary grade + reflection
 * Step 3 · Quarter Retrospective  — three freeform prompts (proud/didn't go/next Q)
 * Step 4 · Seal & Archive         — scorecard summary + commit button
 *
 * Opened as a fullscreen overlay from Home's header CTA or from Reflect.
 * Uses the same prop / callback pattern as CloseWeekWizard.
 */
import { useState, useMemo, useCallback } from 'react'
import type { AnnualObjective, RoadmapItem, Space, HabitCheckin } from '@/lib/types'
import * as qrDb from '@/lib/db/quarterReviews'
import * as krsDb from '@/lib/db/krs'
import { ACTIVE_Q, parseDateLocal } from '@/lib/utils'
import { parseHabitPattern } from '@/lib/habitUtils'

// ── Score tiers ──────────────────────────────────────────────────────────────
type Tier = 'exceeded' | 'achieved' | 'partial' | 'missed'

function scoreTier(s: number): Tier {
  if (s >= 1.0) return 'exceeded'
  if (s >= 0.7) return 'achieved'
  if (s >= 0.4) return 'partial'
  return 'missed'
}

const TIER_LABEL: Record<Tier, string> = {
  exceeded: 'Exceeded',
  achieved: 'Achieved',
  partial: 'Partial',
  missed: 'Missed',
}

const TIER_COLOR: Record<Tier, string> = {
  exceeded: '#7fe27a',
  achieved: '#7fe27a',
  partial: '#f5b840',
  missed: '#ff6452',
}

const TIER_BG: Record<Tier, string> = {
  exceeded: 'rgba(127,226,122,.12)',
  achieved: 'rgba(127,226,122,.09)',
  partial: 'rgba(245,184,64,.1)',
  missed: 'rgba(255,100,82,.1)',
}

const SCORE_STEPS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

// Objective-level summary grade (manual override over KR aggregate)
type ObjGrade = 'exceeded' | 'achieved' | 'partial' | 'missed' | ''

const OBJ_GRADE_OPTS: { value: ObjGrade; label: string; color: string }[] = [
  { value: 'exceeded', label: 'Exceeded',  color: '#7fe27a' },
  { value: 'achieved', label: 'Achieved',  color: '#7fe27a' },
  { value: 'partial',  label: 'Partial',   color: '#f5b840' },
  { value: 'missed',   label: 'Missed',    color: '#ff6452' },
]

// ── Props ────────────────────────────────────────────────────────────────────
interface Props {
  quarter: string
  space: Space | null                 // null = all-spaces view
  spaces: Space[]
  objectives: AnnualObjective[]       // for this space
  roadmapItems: RoadmapItem[]         // for this space, this quarter
  setRoadmapItems: React.Dispatch<React.SetStateAction<RoadmapItem[]>>
  habitCheckins: HabitCheckin[]       // all habit checkins — for quarter snapshot
  toast: (msg: string) => void
  onClose: () => void
  onSeal?: () => void                  // optional: called after the quarter is sealed
  onPlanNextQuarter?: () => void      // optional: navigate to Roadmap filtered to next Q
}

export default function QuarterCloseWizard({
  quarter,
  space,
  spaces,
  objectives,
  roadmapItems,
  setRoadmapItems,
  habitCheckins,
  toast,
  onClose,
  onSeal,
  onPlanNextQuarter,
}: Props) {
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [sealed, setSealed] = useState(false)

  // Step 1 state: per-KR scores + notes
  const [krScores, setKrScores] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const kr of roadmapItems) {
      // Seed from existing close_score, then from progress, then 0
      if (kr.close_score != null) init[kr.id] = Number(kr.close_score)
      else init[kr.id] = Math.round((kr.progress ?? 0) / 10) / 10
    }
    return init
  })
  const [krNotes, setKrNotes] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const kr of roadmapItems) {
      init[kr.id] = kr.close_note ?? ''
    }
    return init
  })

  // Step 2 state: per-objective grade + reflection
  const [objGrades, setObjGrades] = useState<Record<string, ObjGrade>>({})
  const [objReflections, setObjReflections] = useState<Record<string, string>>({})

  // Step 3 state: KR disposition — what happens to incomplete KRs
  type Disposition = 'done' | 'abandon' | 'carry'
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>(() => {
    const init: Record<string, Disposition> = {}
    for (const kr of roadmapItems) {
      // Pre-fill: already done KRs → done, scored 1.0 → done, else no default
      if (kr.health_status === 'done') init[kr.id] = 'done'
    }
    return init
  })
  // KRs that need disposition = not already closed (done/failed) and not parked
  const krsNeedingDisposition = useMemo(() =>
    roadmapItems.filter(kr => kr.health_status !== 'done' && kr.health_status !== 'failed' && !kr.is_parked),
    [roadmapItems])
  const dispositionComplete = krsNeedingDisposition.every(kr => dispositions[kr.id] != null)

  // Apply dispositions: called when advancing from step 3 → 4
  const applyDispositions = async () => {
    setSaving(true)
    try {
      await Promise.all(krsNeedingDisposition.map(async kr => {
        const d = dispositions[kr.id]
        if (!d) return
        if (d === 'done') {
          await krsDb.update(kr.id, { health_status: 'done' })
        } else if (d === 'abandon') {
          await krsDb.update(kr.id, { is_parked: true, quarter: null, status: 'planned' })
        } else if (d === 'carry') {
          await krsDb.update(kr.id, { quarter: nextQuarterStr, status: 'planned', health_status: 'not_started' })
        }
      }))
      // Update local state to reflect the changes
      setRoadmapItems(prev => prev.map(kr => {
        const d = dispositions[kr.id]
        if (!d || kr.health_status === 'done' || kr.is_parked) return kr
        if (d === 'done') return { ...kr, health_status: 'done' as const }
        if (d === 'abandon') return { ...kr, is_parked: true, quarter: null as string | null, status: 'planned' as const }
        if (d === 'carry') return { ...kr, quarter: nextQuarterStr, status: 'planned' as const, health_status: 'not_started' as const }
        return kr
      }))
      setStep(4)
    } catch {
      toast('Could not apply KR dispositions')
    } finally {
      setSaving(false)
    }
  }

  // Step 4 state: quarter retrospective
  const [proudOf, setProudOf] = useState('')
  const [didntGo, setDidntGo] = useState('')
  const [nextQ, setNextQ] = useState('')

  // Objectives that have at least one KR this quarter
  const activeObjs = useMemo(() =>
    objectives.filter(o => roadmapItems.some(k => k.annual_objective_id === o.id)),
    [objectives, roadmapItems])

  // Per-objective KR aggregate
  const objKRs = useCallback((objId: string) =>
    roadmapItems.filter(k => k.annual_objective_id === objId),
    [roadmapItems])

  const objAvgScore = useCallback((objId: string) => {
    const krs = objKRs(objId)
    if (!krs.length) return 0
    return krs.reduce((s, k) => s + (krScores[k.id] ?? 0), 0) / krs.length
  }, [objKRs, krScores])

  // ── Step 1 save ──────────────────────────────────────────────────────────
  const saveKRScores = async () => {
    setSaving(true)
    try {
      await Promise.all(
        roadmapItems.map(kr =>
          qrDb.closeKR(kr.id, krScores[kr.id] ?? null, krNotes[kr.id] || null)
        )
      )
      // Optimistically update local state
      setRoadmapItems(prev => prev.map(kr => ({
        ...kr,
        close_score: krScores[kr.id] ?? kr.close_score,
        close_note: krNotes[kr.id] !== undefined ? (krNotes[kr.id] || null) : kr.close_note,
      })))
      setStep(2)
    } catch {
      toast('Could not save KR scores')
    } finally {
      setSaving(false)
    }
  }

  // ── Step 3 save ──────────────────────────────────────────────────────────
  const saveRetro = async () => {
    setSaving(true)
    try {
      await qrDb.upsert({
        quarter,
        space_id: space?.id ?? null,
        proud_of: proudOf || null,
        didnt_go: didntGo || null,
        next_quarter: nextQ || null,
      })
      setStep(5)
    } finally {
      setSaving(false)
    }
  }

  // ── Seal ─────────────────────────────────────────────────────────────────
  const seal = async () => {
    setSaving(true)
    try {
      // 1. Snapshot habit performance for this quarter before resetting
      const habitKRs = roadmapItems.filter(k => k.is_habit)
      if (habitKRs.length > 0) {
        // Quarter date bounds for counting checkins
        const qm = quarter.match(/^([1-4])Q(\d{4})$/)
        const snapshots = habitKRs.map(kr => {
          let sessions = 0
          let expected = 0
          if (qm) {
            const qn = +qm[1], y = +qm[2]
            const qStart = new Date(y, (qn - 1) * 3, 1)
            const qEnd   = new Date(y, qn * 3, 0, 23, 59, 59)
            const krCheckins = habitCheckins.filter(c => {
              const d = new Date(c.date)
              return c.roadmap_item_id === kr.id && d >= qStart && d <= qEnd
            })
            sessions = krCheckins.length
            // Weeks in the quarter (~13)
            const weeks = Math.round((qEnd.getTime() - qStart.getTime()) / (7 * 24 * 3600 * 1000))
            const pattern = parseHabitPattern(kr.title)
            switch (pattern.mode) {
              case 'daily':          expected = weeks * 7; break
              case 'weekly_count':   expected = (pattern.target || 1) * weeks; break
              case 'weekly_percentage': expected = Math.round(((pattern.target || 0) / 100) * 7 * weeks); break
              case 'monthly_count':  expected = Math.round(((pattern.target || 0) * weeks) / 4.33); break
            }
          }
          const percent = expected > 0 ? Math.round((sessions / expected) * 100) : 0
          return { kr_id: kr.id, kr_title: kr.title, sessions, expected, percent }
        })
        await qrDb.snapshotHabits(quarter, space?.id ?? null, snapshots)
      }

      // 2. Reset habit KRs: health → not_started, progress → 0
      //    They stay on the same quarter (habits are continuous, not moved)
      if (habitKRs.length > 0) {
        await Promise.all(habitKRs.map(kr =>
          krsDb.update(kr.id, { health_status: 'not_started', progress: 0 })
        ))
        setRoadmapItems(prev => prev.map(kr =>
          kr.is_habit ? { ...kr, health_status: 'not_started' as const, progress: 0 } : kr
        ))
      }

      // 3. Seal the quarter record
      await qrDb.seal(quarter, space?.id ?? null)
      setSealed(true)
      onSeal?.()
    } catch {
      toast('Could not seal the quarter')
    } finally {
      setSaving(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const nextQuarterStr = useMemo(() => {
    const m = quarter.match(/(\d)Q(\d{4})/)
    if (!m) return ''
    let q = parseInt(m[1]), y = parseInt(m[2])
    q++; if (q > 4) { q = 1; y++ }
    return `${q}Q${y}`
  }, [quarter])

  const totalKRs = roadmapItems.length
  const scoredKRs = Object.values(krScores).filter(s => s > 0).length
  const avgScore = totalKRs ? Object.values(krScores).reduce((a, b) => a + b, 0) / totalKRs : 0

  // Tier distribution for step 4 summary
  const tierCounts = useMemo(() => {
    const c: Record<Tier, number> = { exceeded: 0, achieved: 0, partial: 0, missed: 0 }
    for (const s of Object.values(krScores)) c[scoreTier(s)]++
    return c
  }, [krScores])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 28px',
        borderBottom: '1px solid var(--line)',
        flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
              letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)',
            }}>Quarter Close</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
              color: 'var(--nw-label-dim)', letterSpacing: '.08em',
            }}>{quarter}{space ? ` · ${space.name}` : ''}</span>
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700,
            color: 'var(--nw-cream)', marginTop: 2, letterSpacing: '-.01em',
          }}>
            {step === 1 && 'Score Key Results'}
            {step === 2 && 'Grade Objectives'}
            {step === 3 && 'Wrap Up KRs'}
            {step === 4 && 'Retrospective'}
            {step === 5 && (sealed ? 'Quarter Sealed' : 'Review & Seal')}
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {[1,2,3,4,5].map(s => (
            <div key={s} style={{
              width: s < step ? 24 : s === step ? 24 : 18, height: 4, borderRadius: 2,
              background: s < step ? 'var(--nw-nominal-text)' : s === step ? 'var(--accent)' : 'var(--line)',
              transition: 'all .2s',
            }} />
          ))}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--navy-400)',
            marginLeft: 6,
          }}>{step}/5</span>
        </div>

        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--navy-400)', fontSize: 20, lineHeight: 1, padding: '4px 6px',
          marginLeft: 8,
        }} title="Close">×</button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, padding: '32px 28px', maxWidth: 800, width: '100%', margin: '0 auto' }}>

        {/* ── STEP 1: Score KRs ── */}
        {step === 1 && (
          <div>
            <p style={{
              fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--navy-300)',
              marginBottom: 28, lineHeight: 1.6,
            }}>
              Give each Key Result a final score from 0.0 to 1.0. The score is a learning tool,
              not a grade — 0.7 on an ambitious KR is a success. Add a note to capture context
              that the number alone can't tell.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(() => {
                // Group objectives by space when in all-spaces mode
                const spaceById = new Map(spaces.map(s => [s.id, s]))
                const objsBySpace: Map<string | null, AnnualObjective[]> = new Map()
                for (const obj of activeObjs) {
                  const key = obj.space_id ?? null
                  if (!objsBySpace.has(key)) objsBySpace.set(key, [])
                  objsBySpace.get(key)!.push(obj)
                }
                const groups = Array.from(objsBySpace.entries())
                return groups.map(([spaceId, spaceObjs]) => {
                  const sp = spaceId ? spaceById.get(spaceId) : null
                  const hasAnyKRs = spaceObjs.some(obj => objKRs(obj.id).filter(k => !k.is_habit).length > 0)
                  if (!hasAnyKRs) return null
                  return (
                    <div key={spaceId ?? 'global'}>
                      {!space && sp && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0, background: sp.color ?? 'var(--accent)', display: 'inline-block' }} />
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>{sp.name}</span>
                          <div style={{ flex: 1, height: 1, background: 'var(--line-2)', marginLeft: 4 }} />
                        </div>
                      )}
                      {spaceObjs.map(obj => {
                const krs = objKRs(obj.id).filter(k => !k.is_habit)
                if (!krs.length) return null
                return (
                  <div key={obj.id} style={{ marginBottom: 8 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                        background: obj.color,
                        display: 'inline-block',
                      }} />
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
                        letterSpacing: '.12em', textTransform: 'uppercase',
                        color: 'var(--nw-label-dim)',
                      }}>{obj.name}</span>
                    </div>
                    {krs.map(kr => {
                      const score = krScores[kr.id] ?? 0
                      const tier = scoreTier(score)
                      return (
                        <div key={kr.id} style={{
                          background: 'var(--surface)', border: '1px solid var(--line)',
                          borderRadius: 12, padding: '14px 16px', marginBottom: 8,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                            <span style={{
                              fontFamily: 'var(--font-body)', fontSize: 13.5,
                              color: 'var(--nw-cream)', flex: 1, lineHeight: 1.4,
                            }}>{kr.title}</span>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                            }}>
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                                letterSpacing: '.06em', textTransform: 'uppercase',
                                color: TIER_COLOR[tier], background: TIER_BG[tier],
                                padding: '2px 8px', borderRadius: 5,
                              }}>{TIER_LABEL[tier]}</span>
                              <span style={{
                                fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
                                color: TIER_COLOR[tier], letterSpacing: '-.02em', minWidth: 36,
                                textAlign: 'right',
                              }}>{score.toFixed(1)}</span>
                            </div>
                          </div>

                          {/* Progress context line */}
                          <div style={{
                            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--navy-500)',
                            marginBottom: 10,
                          }}>
                            Quarter progress: {kr.progress ?? 0}%
                            {kr.health_status !== 'not_started' && (
                              <span style={{ marginLeft: 8, color: 'var(--navy-600)' }}>
                                · final status: {kr.health_status.replace('_', ' ')}
                              </span>
                            )}
                          </div>

                          {/* Score slider */}
                          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                            {SCORE_STEPS.map(s => (
                              <button
                                key={s}
                                onClick={() => setKrScores(prev => ({ ...prev, [kr.id]: s }))}
                                style={{
                                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                                  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                                  border: score === s ? `1.5px solid ${TIER_COLOR[scoreTier(s)]}` : '1px solid var(--line-2)',
                                  background: score === s ? TIER_BG[scoreTier(s)] : 'var(--surface-2)',
                                  color: score === s ? TIER_COLOR[scoreTier(s)] : 'var(--navy-400)',
                                  transition: '.1s',
                                }}
                              >{s.toFixed(1)}</button>
                            ))}
                          </div>

                          {/* Close note */}
                          <textarea
                            value={krNotes[kr.id] ?? ''}
                            onChange={e => setKrNotes(prev => ({ ...prev, [kr.id]: e.target.value }))}
                            placeholder="What happened? What would you do differently? (optional)"
                            rows={2}
                            style={{
                              width: '100%', boxSizing: 'border-box', resize: 'vertical',
                              fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.5,
                              color: 'var(--navy-200)', background: 'var(--surface-2)',
                              border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 10px',
                              outline: 'none',
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
              </div>
            )
            })
          })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                onClick={saveKRScores} disabled={saving}
                style={{
                  fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5,
                  color: '#fff', background: 'var(--accent)', border: 'none',
                  borderRadius: 10, padding: '10px 28px', cursor: 'pointer',
                  opacity: saving ? .6 : 1,
                }}
              >{saving ? 'Saving…' : 'Save Scores →'}</button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Grade Objectives ── */}
        {step === 2 && (
          <div>
            <p style={{
              fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--navy-300)',
              marginBottom: 28, lineHeight: 1.6,
            }}>
              How did each objective land overall? The KR average gives you a starting point —
              override it if context warrants. Add a brief reflection on what mattered most.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {activeObjs.map(obj => {
                const avg = objAvgScore(obj.id)
                const krs = objKRs(obj.id).filter(k => !k.is_habit)
                const grade = objGrades[obj.id] ?? ''
                const suggestedTier = scoreTier(avg)

                return (
                  <div key={obj.id} style={{
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 14, padding: '18px 20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                      <span style={{
                        width: 10, height: 10, borderRadius: 3, flexShrink: 0, marginTop: 4,
                        background: obj.color, display: 'inline-block',
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600,
                          color: 'var(--nw-cream)', lineHeight: 1.35, marginBottom: 4,
                        }}>{obj.name}</div>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--navy-500)',
                        }}>
                          {krs.length} KR{krs.length !== 1 ? 's' : ''} · KR avg {avg.toFixed(2)} ·{' '}
                          suggested: <span style={{ color: TIER_COLOR[suggestedTier] }}>{TIER_LABEL[suggestedTier]}</span>
                        </div>
                      </div>
                    </div>

                    {/* Grade buttons */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                      {OBJ_GRADE_OPTS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setObjGrades(prev => ({ ...prev, [obj.id]: opt.value }))}
                          style={{
                            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                            letterSpacing: '.06em', textTransform: 'uppercase',
                            padding: '5px 14px', borderRadius: 7, cursor: 'pointer',
                            border: grade === opt.value ? `1.5px solid ${opt.color}` : '1px solid var(--line-2)',
                            background: grade === opt.value ? `${opt.color}18` : 'var(--surface-2)',
                            color: grade === opt.value ? opt.color : 'var(--navy-500)',
                            transition: '.1s',
                          }}
                        >{opt.label}</button>
                      ))}
                      {!grade && (
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--navy-600)',
                          alignSelf: 'center', marginLeft: 4,
                        }}>← pick one</span>
                      )}
                    </div>

                    {/* KR mini-list */}
                    <div style={{
                      borderTop: '1px solid var(--line)', paddingTop: 10, marginBottom: 12,
                    }}>
                      {krs.map(kr => {
                        const s = krScores[kr.id] ?? 0
                        return (
                          <div key={kr.id} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '4px 0',
                          }}>
                            <span style={{
                              fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700,
                              color: TIER_COLOR[scoreTier(s)], minWidth: 30,
                            }}>{s.toFixed(1)}</span>
                            <span style={{
                              fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--navy-300)',
                              flex: 1, lineHeight: 1.35,
                            }}>{kr.title}</span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Reflection note */}
                    <textarea
                      value={objReflections[obj.id] ?? ''}
                      onChange={e => setObjReflections(prev => ({ ...prev, [obj.id]: e.target.value }))}
                      placeholder="What drove this result? What will you carry into next quarter? (optional)"
                      rows={2}
                      style={{
                        width: '100%', boxSizing: 'border-box', resize: 'vertical',
                        fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.5,
                        color: 'var(--navy-200)', background: 'var(--surface-2)',
                        border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 10px',
                        outline: 'none',
                      }}
                    />
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
              <button onClick={() => setStep(1)} style={secondaryBtn}>← Back</button>
              <button onClick={() => setStep(3)} style={primaryBtn}>Next →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: KR Disposition ── */}
        {step === 3 && (
          <div>
            <p style={{
              fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--navy-300)',
              marginBottom: 24, lineHeight: 1.6,
            }}>
              {krsNeedingDisposition.length === 0
                ? `All KRs are already closed. Move on to your retrospective.`
                : `Every open KR needs a decision before you can seal the quarter. For each one: mark it done, abandon it, or carry it into ${nextQuarterStr}.`}
            </p>

            {krsNeedingDisposition.length === 0 ? (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 12, padding: '20px 22px', marginBottom: 24,
                textAlign: 'center', color: 'var(--nw-nominal-text)',
                fontFamily: 'var(--font-mono)', fontSize: 12,
              }}>
                ✓ All KRs are closed — nothing to decide.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {krsNeedingDisposition.map(kr => {
                  const score = krScores[kr.id] ?? 0
                  const tier = scoreTier(score)
                  const d = dispositions[kr.id]
                  return (
                    <div key={kr.id} style={{
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderRadius: 12, padding: '14px 16px',
                      borderLeft: d ? '3px solid var(--nw-nominal-text)' : '3px solid var(--line)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--nw-cream)', lineHeight: 1.35, marginBottom: 4 }}>
                            {kr.title}
                          </div>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                            letterSpacing: '.06em', textTransform: 'uppercase',
                            color: TIER_COLOR[tier], background: TIER_BG[tier],
                            padding: '2px 7px', borderRadius: 5,
                          }}>{score.toFixed(1)} · {TIER_LABEL[tier]}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 7 }}>
                        {([
                          { key: 'done',    label: '✓ Done',         hint: 'Close it out' },
                          { key: 'carry',   label: `→ Carry to ${nextQuarterStr.replace(/(\d)Q/,'Q$1 ')}`, hint: 'Reset & continue' },
                          { key: 'abandon', label: '× Abandon',       hint: 'Drop it' },
                        ] as const).map(opt => (
                          <button
                            key={opt.key}
                            onClick={() => setDispositions(prev => ({ ...prev, [kr.id]: opt.key }))}
                            title={opt.hint}
                            style={{
                              flex: 1, padding: '7px 6px', borderRadius: 8, cursor: 'pointer',
                              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                              letterSpacing: '.04em',
                              border: d === opt.key ? 'none' : '1px solid var(--line-2)',
                              background: d === opt.key
                                ? opt.key === 'done'    ? 'rgba(127,226,122,.18)'
                                : opt.key === 'carry'  ? 'var(--accent-bg)'
                                :                        'rgba(255,100,82,.12)'
                                : 'var(--surface-2)',
                              color: d === opt.key
                                ? opt.key === 'done'    ? 'var(--nw-nominal-text)'
                                : opt.key === 'carry'  ? 'var(--accent-2)'
                                :                        'var(--nw-alarm-text)'
                                : 'var(--navy-400)',
                              transition: 'all .12s',
                            }}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {!dispositionComplete && (
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--nw-caution-text)',
                marginBottom: 16, padding: '8px 12px', background: 'rgba(245,184,64,.08)',
                border: '1px solid rgba(245,184,64,.2)', borderRadius: 8,
              }}>
                ⚠ {krsNeedingDisposition.filter(kr => !dispositions[kr.id]).length} KR{krsNeedingDisposition.filter(kr => !dispositions[kr.id]).length !== 1 ? 's' : ''} still need a decision
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button onClick={() => setStep(2)} style={secondaryBtn}>← Back</button>
              <button
                onClick={krsNeedingDisposition.length === 0 ? () => setStep(4) : applyDispositions}
                disabled={saving || !dispositionComplete}
                style={{ ...primaryBtn, opacity: (saving || !dispositionComplete) ? .5 : 1 }}>
                {saving ? 'Applying…' : 'Apply & Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Retrospective ── */}
        {step === 4 && (
          <div>
            <p style={{
              fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--navy-300)',
              marginBottom: 32, lineHeight: 1.6,
            }}>
              Take 5 minutes. These three questions are the heart of the ritual — the raw material
              that makes next quarter's goals better calibrated and more honest.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <RetroPrompt
                emoji="🏆"
                label="What are you most proud of this quarter?"
                hint="Wins, moments, unexpected progress — name them specifically."
                value={proudOf}
                onChange={setProudOf}
              />
              <RetroPrompt
                emoji="🚧"
                label="What didn't go as planned?"
                hint="Be honest. A missed goal that leads to good reflection is more valuable than a sandbagged hit."
                value={didntGo}
                onChange={setDidntGo}
              />
              <RetroPrompt
                emoji="🔭"
                label={`Going into ${nextQuarterStr} — what changes?`}
                hint="Different approach, different priorities, or simply doing more of what worked."
                value={nextQ}
                onChange={setNextQ}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
              <button onClick={() => setStep(3)} style={secondaryBtn}>← Back</button>
              <button onClick={saveRetro} disabled={saving} style={{ ...primaryBtn, opacity: saving ? .6 : 1 }}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 5: Seal & Archive ── */}
        {step === 5 && (
          <div>
            {!sealed ? (
              <>
                <p style={{
                  fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--navy-300)',
                  marginBottom: 28, lineHeight: 1.6,
                }}>
                  Here's how {quarter} landed. Sealing the quarter timestamps it and closes the loop.
                  You can still edit KR data, but this marks the ceremony complete.
                </p>

                {/* Score summary scorecard */}
                <div style={{
                  background: 'var(--surface)', border: '1px solid var(--line)',
                  borderRadius: 14, padding: '20px 22px', marginBottom: 20,
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
                    letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)',
                    marginBottom: 14,
                  }}>Key Result Scorecard</div>

                  {/* Tier bars */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
                    {(Object.entries(tierCounts) as [Tier, number][]).map(([tier, count]) => (
                      <div key={tier} style={{
                        flex: '1 1 80px', background: TIER_BG[tier],
                        border: `1px solid ${TIER_COLOR[tier]}30`,
                        borderRadius: 10, padding: '10px 14px', textAlign: 'center',
                      }}>
                        <div style={{
                          fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700,
                          color: TIER_COLOR[tier], lineHeight: 1,
                        }}>{count}</div>
                        <div style={{
                          fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                          letterSpacing: '.08em', textTransform: 'uppercase',
                          color: TIER_COLOR[tier], marginTop: 4,
                        }}>{TIER_LABEL[tier]}</div>
                      </div>
                    ))}
                  </div>

                  {/* Avg score */}
                  <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 8,
                  }}>
                    <span style={{
                      fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700,
                      color: TIER_COLOR[scoreTier(avgScore)], letterSpacing: '-.02em',
                    }}>{avgScore.toFixed(2)}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--navy-400)',
                    }}>average · {totalKRs} KRs · {scoredKRs} scored</span>
                  </div>
                </div>

                {/* Objective grades */}
                {activeObjs.length > 0 && (
                  <div style={{
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 14, padding: '20px 22px', marginBottom: 24,
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
                      letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)',
                      marginBottom: 12,
                    }}>Objective Grades</div>
                    {activeObjs.map(obj => {
                      const grade = objGrades[obj.id]
                      const avg = objAvgScore(obj.id)
                      const tier = grade ? (grade as Tier) : scoreTier(avg)
                      return (
                        <div key={obj.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '6px 0',
                          borderTop: '1px solid var(--line)',
                        }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                            background: obj.color, display: 'inline-block',
                          }} />
                          <span style={{
                            fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--navy-200)',
                            flex: 1, lineHeight: 1.35,
                          }}>{obj.name}</span>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                            letterSpacing: '.06em', textTransform: 'uppercase',
                            color: TIER_COLOR[tier], background: TIER_BG[tier],
                            padding: '2px 8px', borderRadius: 5, flexShrink: 0,
                          }}>{TIER_LABEL[tier]}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Retro preview */}
                {(proudOf || didntGo || nextQ) && (
                  <div style={{
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 14, padding: '20px 22px', marginBottom: 24,
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
                      letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)',
                      marginBottom: 12,
                    }}>Retrospective</div>
                    {proudOf && <RetroLine emoji="🏆" label="Most proud of" text={proudOf} />}
                    {didntGo && <RetroLine emoji="🚧" label="Didn't go as planned" text={didntGo} />}
                    {nextQ && <RetroLine emoji="🔭" label={`Going into ${nextQuarterStr}`} text={nextQ} />}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button onClick={() => setStep(4)} style={secondaryBtn}>← Back</button>
                  <button onClick={seal} disabled={saving} style={{
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14,
                    color: '#fff',
                    background: 'linear-gradient(135deg,var(--accent),var(--accent-2,#4a8af4))',
                    border: 'none', borderRadius: 11, padding: '11px 32px',
                    cursor: 'pointer', opacity: saving ? .6 : 1,
                    boxShadow: '0 4px 20px rgba(91,141,239,.3)',
                  }}>{saving ? 'Sealing…' : `Seal ${quarter} →`}</button>
                </div>
              </>
            ) : (
              /* ── Sealed success state ── */
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 56, marginBottom: 16 }}>🏁</div>
                <div style={{
                  fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700,
                  color: 'var(--nw-cream)', marginBottom: 10,
                }}>{quarter} is sealed.</div>
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--navy-400)',
                  maxWidth: 380, margin: '0 auto 32px', lineHeight: 1.6,
                }}>
                  The quarter is closed. Your scores and reflections are saved.
                  Time to set the next quarter's goals.
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button onClick={onClose} style={secondaryBtn}>Back to Home</button>
                  {onPlanNextQuarter && (
                    <button onClick={() => { onClose(); onPlanNextQuarter() }} style={primaryBtn}>
                      Plan {nextQuarterStr} →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────
function RetroPrompt({
  emoji, label, hint, value, onChange
}: {
  emoji: string; label: string; hint: string
  value: string; onChange: (v: string) => void
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 14, padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{emoji}</span>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600,
            color: 'var(--nw-cream)', lineHeight: 1.3, marginBottom: 4,
          }}>{label}</div>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--navy-500)',
            lineHeight: 1.5,
          }}>{hint}</div>
        </div>
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Write freely…"
        rows={4}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6,
          color: 'var(--navy-200)', background: 'var(--surface-2)',
          border: '1px solid var(--line-2)', borderRadius: 9, padding: '10px 13px',
          outline: 'none',
        }}
      />
    </div>
  )
}

function RetroLine({ emoji, label, text }: { emoji: string; label: string; text: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
        letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--nw-label-dim)',
        marginBottom: 4,
      }}>{emoji} {label}</div>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--navy-200)',
        lineHeight: 1.6, whiteSpace: 'pre-wrap',
      }}>{text}</div>
    </div>
  )
}

// ── Shared button styles ──────────────────────────────────────────────────────
const primaryBtn: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5,
  color: '#fff', background: 'var(--accent)', border: 'none',
  borderRadius: 10, padding: '10px 28px', cursor: 'pointer',
}

const secondaryBtn: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5,
  color: 'var(--navy-300)', background: 'var(--surface-2)',
  border: '1px solid var(--line-2)', borderRadius: 10, padding: '10px 22px',
  cursor: 'pointer',
}
