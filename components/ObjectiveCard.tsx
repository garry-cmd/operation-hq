'use client'
import React, { useState } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as actionsDb from '@/lib/db/actions'
import { AnnualObjective, RoadmapItem, WeeklyAction, HealthStatus, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'

// Notes / links / files all live on the ObjectivePanel now (commit-5 panel
// arc). The card's footer tabs are gone — the title is the click target.
// The legacy `obj.notes` text column and the `objective_logs` rendering that
// once lived here are dormant; the panel reads/writes them directly.
const HEALTH_CYCLE: HealthStatus[] = ['not_started', 'backlog', 'on_track', 'off_track', 'blocked', 'done']
const HEALTH: Record<HealthStatus, { bg: string; color: string; label: string }> = {
  not_started: { bg: 'var(--navy-600)',  color: 'var(--navy-300)', label: 'Not started' },
  backlog:     { bg: 'var(--navy-600)',  color: 'var(--navy-200)', label: 'Backlog' },
  on_track:    { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'On track' },
  off_track:   { bg: 'var(--red-bg)',    color: 'var(--red-text)',  label: 'Off track' },
  blocked:     { bg: 'var(--amber-bg)',  color: 'var(--amber-text)', label: 'Blocked' },
  done:        { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'Done ✓' },
}

function hex2rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

interface Props {
  obj: AnnualObjective
  krs: RoadmapItem[]
  actions: WeeklyAction[]
  weekStart: string
  metricCheckins: MetricCheckin[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  onEditKR: (kr: RoadmapItem) => void
  onLogMetric: (krId: string) => void
  // Click on the objective title → ObjectivePanel opens for this objective.
  onObjectiveClick: (objectiveId: string) => void
  // True when the panel is currently showing this objective. Surfaces as an
  // accent border on the card so the user knows where the panel content
  // came from (mirrors the action-row accent in Focus.tsx).
  isActive: boolean
  toast: (m: string) => void
}

export default function ObjectiveCard({ obj, krs, actions, weekStart, metricCheckins, setRoadmapItems, setObjectives, setActions, onEditKR, onLogMetric, onObjectiveClick, isActive, toast }: Props) {
  const [collapsed, setCollapsed] = useState(true)
  const [addingKR, setAddingKR] = useState(false)
  const [newKRTitle, setNewKRTitle] = useState('')
  const [newKRIsHabit, setNewKRIsHabit] = useState(false)
  const [savingKR, setSavingKR] = useState(false)
  const [addingActionKRId, setAddingActionKRId] = useState<string | null>(null)
  const [newActionTitle, setNewActionTitle] = useState('')
  const [savingAction, setSavingAction] = useState(false)
  const [titleHover, setTitleHover] = useState(false)

  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack  = krs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
  const offTrack = krs.filter(k => k.health_status === 'off_track').length
  const blocked  = krs.filter(k => k.health_status === 'blocked').length
  const notStarted = krs.filter(k => k.health_status === 'not_started' || !k.health_status).length
  const doneKRs  = krs.filter(k => k.health_status === 'done').length
  const progress = krs.length > 0 ? Math.round((doneKRs / krs.length) * 100) : 0

  // Avoid using `setObjectives` here so its prop stays unused but kept for
  // future panel-driven mutations (e.g. renaming an objective from the panel
  // header). Suppress lint with a void cast — cheaper than dropping the prop
  // and re-threading later.
  void setObjectives

  async function cycleStatus(kr: RoadmapItem) {
    const idx = HEALTH_CYCLE.indexOf(kr.health_status ?? 'not_started')
    const next = HEALTH_CYCLE[(idx + 1) % HEALTH_CYCLE.length]
    try {
      const updated = await krsDb.setHealth(kr.id, next)
      setRoadmapItems(prev => prev.map(i => i.id === kr.id ? updated : i))
    } catch (err) {
      console.error('cycleStatus failed:', err)
    }
  }

  async function addKR() {
    if (!newKRTitle.trim() || savingKR) return
    setSavingKR(true)
    try {
      const count = await krsDb.countByObjective(obj.id)
      const created = await krsDb.create({
        space_id: obj.space_id,
        annual_objective_id: obj.id,
        title: newKRTitle.trim(),
        quarter: ACTIVE_Q,
        status: 'active',
        sort_order: count,
        health_status: 'not_started',
        progress: 0,
        is_habit: newKRIsHabit,
      })
      setRoadmapItems(prev => [...prev, created])
      setNewKRTitle('')
      setNewKRIsHabit(false)
      setAddingKR(false)
      toast('Key result added.')
    } catch (err) {
      console.error('addKR failed:', err)
    }
    setSavingKR(false)
  }

  async function addAction(krId: string) {
    if (!newActionTitle.trim() || savingAction) return
    setSavingAction(true)
    try {
      const created = await actionsDb.create({
        roadmap_item_id: krId,
        title: newActionTitle.trim(),
        week_start: weekStart,
      })
      setActions(prev => [...prev, created])
      setNewActionTitle('')
      setAddingActionKRId(null)
      toast('Action added.')
    } catch (err) {
      console.error('addAction failed:', err)
    }
    setSavingAction(false)
  }

  // Border treatment: accent when the panel is open for this objective,
  // otherwise the existing color-tinted border.
  const borderColor = isActive ? 'var(--accent)' : hex2rgba(obj.color, 0.25)
  const bgColor = hex2rgba(obj.color, 0.04)
  const hdrBg = hex2rgba(obj.color, 0.1)
  const divColor = hex2rgba(obj.color, 0.12)

  return (
    <>
      <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: `1px solid ${borderColor}`, background: bgColor, transition: 'border-color .12s' }}>

        {/* Objective header — title is its own click target (opens panel),
            chevron-icon-only collapses/expands. Status pills + progress are
            non-interactive read-out. */}
        <div style={{ padding: '12px 14px', background: hdrBg, display: 'flex', alignItems: 'flex-start', gap: 10, userSelect: 'none' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color, flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <button
              onClick={() => onObjectiveClick(obj.id)}
              onMouseEnter={() => setTitleHover(true)}
              onMouseLeave={() => setTitleHover(false)}
              style={{
                fontSize: 14, fontWeight: 700,
                color: isActive || titleHover ? 'var(--accent)' : 'var(--navy-50)',
                lineHeight: 1.3, marginBottom: 5,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                textAlign: 'left', fontFamily: 'inherit',
                display: 'block', maxWidth: '100%',
                transition: 'color .12s',
              }}>
              {obj.name}
            </button>
            {collapsed ? (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
                {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
                {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
                {notStarted > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>{notStarted} not started</span>}
                {krs.length === 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>No key results</span>}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
                {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
                {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
                {notStarted > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>{notStarted} not started</span>}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
              <div style={{ flex: 1, height: 4, background: 'var(--navy-600)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: 4, borderRadius: 2, background: progress === 100 ? 'var(--teal)' : obj.color, width: `${progress}%`, transition: 'width .4s ease' }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: progress === 100 ? 'var(--teal-text)' : 'var(--navy-300)', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>
                {progress}%
              </span>
            </div>
          </div>
          {/* Chevron button — own click target for collapse/expand */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{
              flexShrink: 0, marginTop: 0,
              width: 28, height: 28, borderRadius: 8,
              border: 'none', background: 'transparent',
              color: 'var(--navy-400)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .2s, background .12s',
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Body — hidden when collapsed */}
        {!collapsed && (<>

        {krs.map((kr, i) => {
          const actCount = weekActions.filter(a => a.roadmap_item_id === kr.id).length
          const h = kr.health_status ?? 'not_started'
          const hs = HEALTH[h]
          // Metric KR context — latest value + whether this week's been logged.
          // Only non-null for KRs flagged is_metric; normal rows render unchanged.
          const metricCtx = (() => {
            if (!kr.is_metric) return null
            const krCheckins = metricCheckins.filter(c => c.roadmap_item_id === kr.id)
            const sorted = [...krCheckins].sort((a, b) => b.week_start.localeCompare(a.week_start))
            const latest = sorted[0]
            const thisWeek = sorted.find(c => c.week_start === weekStart)
            return { latest, loggedThisWeek: !!thisWeek, unit: kr.metric_unit ?? '' }
          })()
          // i is unused after the section divider rewrite, but keeping for
          // potential per-row striping later. Suppress lint with a void.
          void i
          return (
            <React.Fragment key={kr.id}>
              <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-100)', lineHeight: 1.4, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {kr.title}
                    {kr.is_metric && (
                      <span title="Metric KR" style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--accent-dim)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.5px' }}>metric</span>
                    )}
                  </div>
                  {metricCtx ? (
                    <div style={{ fontSize: 11, color: 'var(--navy-500)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {metricCtx.latest ? (
                        <span>
                          Latest: <span style={{ color: 'var(--navy-200)', fontWeight: 600 }}>{metricCtx.latest.value}{metricCtx.unit && ` ${metricCtx.unit}`}</span>
                        </span>
                      ) : (
                        <span style={{ fontStyle: 'italic' }}>No readings yet</span>
                      )}
                      <button onClick={() => onLogMetric(kr.id)}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99,
                          border: metricCtx.loggedThisWeek ? '1px solid var(--navy-500)' : '1px solid var(--accent)',
                          background: metricCtx.loggedThisWeek ? 'transparent' : 'var(--accent-dim)',
                          color: metricCtx.loggedThisWeek ? 'var(--navy-300)' : 'var(--accent)',
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>
                        {metricCtx.loggedThisWeek ? 'Update this week' : 'Log this week →'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--navy-500)' }}>
                      {actCount === 0 ? 'No actions this week' : `${actCount} action${actCount > 1 ? 's' : ''} this week`}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 1 }}>
                  <button onClick={() => setAddingActionKRId(kr.id)}
                    style={{ fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Add action
                  </button>
                  <button onClick={() => cycleStatus(kr)}
                    style={{ fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 99, border: 'none', cursor: 'pointer', background: hs.bg, color: hs.color, whiteSpace: 'nowrap', transition: 'all .12s' }}>
                    {hs.label}
                  </button>
                  <button onClick={() => onEditKR(kr)}
                    style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="var(--navy-300)" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                  </button>
                </div>
              </div>
              {addingActionKRId === kr.id && (
                <div style={{ padding: '11px 14px', borderTop: `1px solid ${divColor}`, background: 'var(--navy-700)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <input
                      value={newActionTitle}
                      onChange={e => setNewActionTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addAction(kr.id)
                        if (e.key === 'Escape') { setAddingActionKRId(null); setNewActionTitle('') }
                      }}
                      placeholder="What action will move this KR forward?"
                      autoFocus
                      style={{ flex: 1, fontSize: 12, padding: '8px 10px', border: '1px solid var(--navy-600)', borderRadius: 8, background: 'var(--navy-800)', color: 'var(--navy-100)', outline: 'none' }}
                    />
                    <button onClick={() => addAction(kr.id)} disabled={!newActionTitle.trim() || savingAction}
                      style={{ padding: '8px 12px', background: obj.color, color: '#fff', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer', opacity: !newActionTitle.trim() ? .5 : 1 }}>
                      {savingAction ? 'Adding…' : 'Add'}
                    </button>
                    <button onClick={() => { setAddingActionKRId(null); setNewActionTitle('') }}
                      style={{ padding: '8px 12px', background: 'transparent', color: 'var(--navy-400)', fontSize: 11, border: '1px solid var(--navy-600)', borderRadius: 8, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}

        {/* Add key result */}
        {!addingKR ? (
          <button onClick={() => setAddingKR(true)}
            style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)', border: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', color: 'var(--navy-400)', fontSize: 12, fontWeight: 600, transition: 'color .12s' }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            Add key result
          </button>
        ) : (
          <div style={{ padding: '11px 14px', borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
            <textarea
              value={newKRTitle}
              onChange={e => setNewKRTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addKR()
                if (e.key === 'Escape') { setAddingKR(false); setNewKRTitle(''); setNewKRIsHabit(false) }
              }}
              placeholder="New key result…"
              autoFocus
              style={{ width: '100%', background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 10, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, resize: 'none', color: 'var(--navy-100)', outline: 'none', marginBottom: 8 }}
              rows={2}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10, fontSize: 12, color: 'var(--navy-300)' }}>
              <input
                type="checkbox"
                checked={newKRIsHabit}
                onChange={e => setNewKRIsHabit(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              This is a daily habit
            </label>
            <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
              <button onClick={() => { setAddingKR(false); setNewKRTitle(''); setNewKRIsHabit(false) }}
                style={{ padding: '7px 14px', background: 'var(--navy-700)', color: 'var(--navy-300)', fontSize: 12, fontWeight: 600, border: '1px solid var(--navy-600)', borderRadius: 9, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={addKR} disabled={!newKRTitle.trim() || savingKR}
                style={{ padding: '7px 16px', background: obj.color, color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9, cursor: 'pointer', opacity: !newKRTitle.trim() ? .45 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                {savingKR ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        )}
        </>)}
      </div>
    </>
  )
}
