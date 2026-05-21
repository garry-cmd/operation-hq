'use client'
import React, { useState } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as actionsDb from '@/lib/db/actions'
import { AnnualObjective, RoadmapItem, WeeklyAction, HealthStatus, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import { getDefaultNewKRRange } from '@/lib/dateBuckets'
import KRDateChip from '@/components/KRDateChip'

// Notes / links / files all live on the ObjectivePanel now (commit-5 panel
// arc). The card's footer tabs are gone — the title is the click target.
// The legacy `obj.notes` text column and the `objective_logs` rendering that
// once lived here are dormant; the panel reads/writes them directly.
const HEALTH_CYCLE: HealthStatus[] = ['not_started', 'backlog', 'on_track', 'off_track', 'waiting', 'blocked', 'done']
const HEALTH: Record<HealthStatus, { bg: string; color: string; label: string }> = {
  not_started: { bg: 'var(--nw-standby-bg)', color: 'var(--nw-standby-text)', label: 'Standby' },
  backlog:     { bg: 'var(--nw-standby-bg)', color: 'var(--nw-standby-text)', label: 'Backlog' },
  on_track:    { bg: 'var(--nw-nominal-bg)', color: 'var(--nw-nominal-text)', label: 'On track' },
  off_track:   { bg: 'var(--nw-alarm-bg)',   color: 'var(--nw-alarm-text)',   label: 'Off track' },
  waiting:     { bg: 'var(--indigo-bg)',     color: 'var(--indigo-text)',     label: 'Waiting' },
  blocked:     { bg: 'var(--nw-caution-bg)', color: 'var(--nw-caution-text)', label: 'Blocked' },
  done:        { bg: 'var(--nw-nominal-bg)', color: 'var(--nw-nominal-text)', label: 'Done ✓' },
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
  // Click on the edit button in the header toolbar → parent opens
  // EditObjectiveModal. The button used to live in OKRs.tsx as an absolutely-
  // positioned overlay; moved into the header toolbar in the May 21 cleanup.
  onEditObjective: (objective: AnnualObjective) => void
  // True when the panel is currently showing this objective. Surfaces as an
  // accent border on the card so the user knows where the panel content
  // came from (mirrors the action-row accent in Focus.tsx).
  isActive: boolean
  toast: (m: string) => void
}

export default function ObjectiveCard({ obj, krs, actions, weekStart, metricCheckins, setRoadmapItems, setObjectives, setActions, onEditKR, onLogMetric, onObjectiveClick, onEditObjective, isActive, toast }: Props) {
  // Default to collapsed on mount (May 21 — Garry's call). Compact OKR tab
  // by default; expand the cards you actually want to read. State resets per
  // navigation since the component remounts when the screen changes; no
  // localStorage persistence wanted.
  const [collapsed, setCollapsed] = useState(true)
  const [addingKR, setAddingKR] = useState(false)
  const [newKRTitle, setNewKRTitle] = useState('')
  const [newKRIsHabit, setNewKRIsHabit] = useState(false)
  const [savingKR, setSavingKR] = useState(false)
  const [addingActionKRId, setAddingActionKRId] = useState<string | null>(null)
  const [newActionTitle, setNewActionTitle] = useState('')
  const [savingAction, setSavingAction] = useState(false)
  const [titleHover, setTitleHover] = useState(false)
  const [hoveredKRId, setHoveredKRId] = useState<string | null>(null)

  const weekActions = actions.filter(a => a.week_start === weekStart)
  // Full health-status breakdown for the header pills (May 21 cleanup). The
  // old design only surfaced offTrack + blocked as chips; the new pill row
  // shows one dot-pill per non-zero status so the user can read the entire
  // mix at a glance. not_started + backlog merge into a single "pending"
  // count since the two have no behavioural difference in the dashboard.
  const offTrack   = krs.filter(k => k.health_status === 'off_track').length
  const blocked    = krs.filter(k => k.health_status === 'blocked').length
  const doneKRs    = krs.filter(k => k.health_status === 'done').length
  const onTrack    = krs.filter(k => k.health_status === 'on_track').length
  const waiting    = krs.filter(k => k.health_status === 'waiting').length
  const pending    = krs.filter(k => k.health_status === 'not_started' || k.health_status === 'backlog').length
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

  // Reorder a KR up or down within this objective. Swaps sort_order with the
  // adjacent sibling (by current sort_order, ignoring gaps). Writes both rows
  // and optimistically updates local state. Local render also sorts by
  // sort_order so the visual order tracks immediately — `prev.map(...)` keeps
  // each item at its existing array index, so without re-sorting the swap
  // wouldn't show until a reload.
  async function moveKR(kr: RoadmapItem, direction: 'up' | 'down') {
    const sorted = [...krs].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(k => k.id === kr.id)
    if (idx === -1) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= sorted.length) return  // already at boundary
    const target = sorted[targetIdx]
    const krNewOrder = target.sort_order
    const targetNewOrder = kr.sort_order
    try {
      const [updatedKR, updatedTarget] = await Promise.all([
        krsDb.update(kr.id, { sort_order: krNewOrder }),
        krsDb.update(target.id, { sort_order: targetNewOrder }),
      ])
      setRoadmapItems(prev => prev.map(i =>
        i.id === updatedKR.id ? updatedKR :
        i.id === updatedTarget.id ? updatedTarget : i
      ))
    } catch (err) {
      console.error('moveKR failed:', err)
      toast('Could not reorder.')
    }
  }

  async function addKR() {
    if (!newKRTitle.trim() || savingKR) return
    setSavingKR(true)
    try {
      const count = await krsDb.countByObjective(obj.id)
      // Default new outcome KRs to the current calendar week (Mon → Sun). This
      // lands them in the All Spaces "This Week" bucket so they're visible and
      // pressure the user to either commit or push out. Habits skip dates —
      // they're ongoing, not bounded.
      const defaultRange = newKRIsHabit ? null : getDefaultNewKRRange()
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
        start_date: defaultRange?.start_date ?? null,
        end_date: defaultRange?.end_date ?? null,
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

  // Polish pass (May 17): object color becomes a 3px left-border accent on a
  // neutral card, instead of tinting the entire card lavender/coral/etc.
  // Drops the lavender-on-lavender look in favor of dramatic typography and
  // quiet chrome. Active state still wins — accent border replaces the obj
  // color when the panel is open for this objective.
  const accentColor = isActive ? 'var(--accent)' : obj.color
  const divColor = 'var(--navy-700)'

  // Quarter timing for the "N weeks remaining" pill. ACTIVE_Q format is
  // "<n>Q<yyyy>"; quarter ends on the last day of month n*3.
  const qMatch = ACTIVE_Q.match(/(\d)Q(\d{4})/)
  const weeksRemaining = (() => {
    if (!qMatch) return null
    const qNum = parseInt(qMatch[1], 10)
    const qYear = parseInt(qMatch[2], 10)
    // new Date(year, month, 0) = last day of (month-1). qNum*3 gives the
    // month-after-quarter-end (1-indexed), so day=0 of that = quarter close.
    const qEnd = new Date(qYear, qNum * 3, 0)
    const ms = qEnd.getTime() - Date.now()
    return Math.max(0, Math.ceil(ms / (7 * 24 * 60 * 60 * 1000)))
  })()

  return (
    <>
      <div style={{ borderRadius: 10, overflow: 'hidden', marginBottom: 12, border: `1px solid var(--navy-700)`, borderLeft: `3px solid ${accentColor}`, background: 'var(--navy-800)', transition: 'border-color .12s' }}>

        {/* Objective header — three-row layout (May 21 tighten pass):
            Row 1: title (left) · "N wk remain" (right)
            Row 2: status pills (left) · edit + chevron (right)
            Row 3: progress bar (full width, bottom)
            Removed the dedicated bottom toolbar + hairline divider — folding
            edit/chevron onto the pills row drops a full row of height. */}
        <div style={{ padding: '14px 18px 12px', userSelect: 'none' }}>

          {/* Row 1 — title + weeks remain */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <button
              onClick={() => onObjectiveClick(obj.id)}
              onMouseEnter={() => setTitleHover(true)}
              onMouseLeave={() => setTitleHover(false)}
              style={{
                flex: 1, minWidth: 0,
                fontSize: 16, fontWeight: 500,
                color: isActive || titleHover ? 'var(--accent)' : 'var(--nw-cream)',
                lineHeight: 1.3,
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                textAlign: 'left', fontFamily: 'inherit',
                letterSpacing: '-.005em',
                transition: 'color .12s',
              }}>
              {obj.name}
            </button>
            {weeksRemaining != null && (
              <div style={{
                fontSize: 10, letterSpacing: '.04em',
                color: 'var(--nw-label-dim)',
                fontVariantNumeric: 'tabular-nums',
                textTransform: 'uppercase',
                fontWeight: 500, whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                <strong style={{ color: 'var(--navy-200)', fontWeight: 700 }}>{weeksRemaining} wk</strong> remain
              </div>
            )}
          </div>

          {/* Row 2 — pills + edit/chevron. Both share a single row so the
              card stays tight; pills wrap if the row gets crowded, edit +
              chevron stay anchored to the right. */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, marginBottom: 10, flexWrap: 'wrap',
          }}>
            {krs.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--nw-label-dim)', fontStyle: 'italic' }}>
                No key results yet
              </div>
            ) : (
              <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                <StatusPill count={doneKRs}  color="var(--nw-nominal-text)" label="done"       glow />
                <StatusPill count={onTrack}  color="var(--nw-nominal-text)" label="on track"   dim />
                <StatusPill count={offTrack} color="var(--nw-alarm-text)"   label="off track"  glow />
                <StatusPill count={blocked}  color="var(--nw-caution-text)" label="blocked" />
                <StatusPill count={waiting}  color="var(--nw-standby-text)" label="waiting" />
                <StatusPill count={pending}  color="var(--nw-standby-text)" label="pending" dim />
              </div>
            )}
            <div style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
              <button
                onClick={() => onEditObjective(obj)}
                title="Edit objective"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  width: 28, height: 24, borderRadius: 5,
                  color: 'var(--nw-label-dim)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background .12s, color .12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--nw-label)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--nw-label-dim)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button
                onClick={() => setCollapsed(c => !c)}
                title={collapsed ? 'Expand' : 'Collapse'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  width: 28, height: 24, borderRadius: 5,
                  color: 'var(--nw-label-dim)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background .12s, color .12s, transform .2s',
                  transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--nw-label)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--nw-label-dim)' }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Row 3 — progress bar (full width, bottom of header) */}
          <div style={{ height: 5, background: 'var(--navy-700)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(progress, krs.length > 0 ? 2 : 0)}%`, background: 'var(--nw-nominal-text)', borderRadius: 99, boxShadow: `0 0 6px var(--nw-glow-green)`, transition: 'width .4s ease' }} />
          </div>
        </div>

        {/* Body — hidden when collapsed */}
        {!collapsed && (<>

        {(() => {
          // Local sort by sort_order so optimistic moveKR updates (which keep
          // each row at its existing array index) take immediate visual effect.
          // The DB query also orders by sort_order, so on first load this is
          // a no-op.
          const sortedKRs = [...krs].sort((a, b) => a.sort_order - b.sort_order)
          return sortedKRs.map((kr, i) => {
          const isFirst = i === 0
          const isLast = i === sortedKRs.length - 1
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
          return (
            <React.Fragment key={kr.id}>
              <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ lineHeight: 1.4, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => onObjectiveClick(obj.id)}
                      onMouseEnter={() => setHoveredKRId(kr.id)}
                      onMouseLeave={() => setHoveredKRId(null)}
                      style={{
                        fontSize: 14, fontWeight: 500,
                        color: hoveredKRId === kr.id ? 'var(--accent)' : 'var(--nw-cream)',
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        textAlign: 'left', fontFamily: 'inherit', lineHeight: 1.35,
                        transition: 'color .12s',
                      }}>
                      {kr.title}
                    </button>
                    {kr.is_metric && (
                      <span title="Metric KR" style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--accent-dim)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.5px' }}>metric</span>
                    )}
                  </div>
                  {metricCtx ? (
                    <div style={{ fontSize: 11, color: 'var(--nw-label-dim)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {metricCtx.latest ? (
                        <span>
                          Latest: <span style={{ color: 'var(--nw-cream)', fontWeight: 600 }}>{metricCtx.latest.value}{metricCtx.unit && ` ${metricCtx.unit}`}</span>
                        </span>
                      ) : (
                        <span style={{ fontStyle: 'italic' }}>No readings yet</span>
                      )}
                      <KRDateChip kr={kr} />
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
                    <div style={{ fontSize: 11, color: 'var(--nw-label-dim)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <KRDateChip kr={kr} />
                      <span>{actCount === 0 ? 'No actions this week' : `${actCount} action${actCount > 1 ? 's' : ''} this week`}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 1 }}>
                  <button onClick={() => setAddingActionKRId(kr.id)}
                    style={{ fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Add action
                  </button>
                  <button onClick={() => cycleStatus(kr)}
                    style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: hs.bg, color: hs.color, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5, transition: 'all .12s' }}>
                    <span style={{ width: 4, height: 4, borderRadius: 99, background: 'currentColor' }} />
                    {hs.label}
                  </button>
                  {/* Reorder controls — boring up/down arrows over a drag handle.
                      Disabled at the boundaries instead of hidden so the row's
                      right-edge geometry stays stable across all KRs. */}
                  <button onClick={() => moveKR(kr, 'up')} disabled={isFirst} title="Move up"
                    style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isFirst ? 'default' : 'pointer', opacity: isFirst ? 0.35 : 1 }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M3 7l3-3 3 3" stroke="var(--navy-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <button onClick={() => moveKR(kr, 'down')} disabled={isLast} title="Move down"
                    style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isLast ? 'default' : 'pointer', opacity: isLast ? 0.35 : 1 }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M3 5l3 3 3-3" stroke="var(--navy-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
        })
        })()}

        {/* Add key result */}
        {!addingKR ? (
          <button onClick={() => setAddingKR(true)}
            style={{ width: '100%', padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)', border: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', color: 'var(--nw-label)', fontSize: 10.5, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', transition: 'color .12s' }}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
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


// =========================================================================
// StatusPill — tiny dot + count + label, one per non-zero health status in
// the objective header. Lighter than a full filled chip so 4-5 pills side
// by side don't visually shout. Glow on the dot is reserved for the two
// "act-on-this" states (done as celebration; off track as alarm).
// =========================================================================
function StatusPill({
  count,
  color,
  label,
  glow = false,
  dim = false,
}: {
  count: number
  color: string
  label: string
  /** Adds a soft halo to the dot — used for done (celebrate) + off-track (alarm). */
  glow?: boolean
  /** Reduces dot opacity — used for on-track + pending (both are "neutral
   *  in-flight" states that shouldn't compete with done/off-track for
   *  attention). */
  dim?: boolean
}) {
  if (count === 0) return null
  return (
    <span style={{
      fontSize: 11, fontWeight: 500,
      color: 'var(--navy-200)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
      padding: '2px 6px',
      lineHeight: 1.3,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 99,
        background: color,
        opacity: dim ? 0.6 : 1,
        boxShadow: glow ? `0 0 4px ${color}` : 'none',
        flexShrink: 0,
      }} />
      <span style={{ fontWeight: 700, color: 'var(--nw-cream)' }}>{count}</span>
      <span>{label}</span>
    </span>
  )
}
