'use client'
import React, { useState } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as actionsDb from '@/lib/db/actions'
import * as extrasDb from '@/lib/db/objectiveExtras'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog, HealthStatus, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import { getToday } from '@/lib/habitUtils'

// Notes UI moved out of this card. The legacy `obj.notes` text field is
// no longer rendered anywhere in v1; `objective_logs` (titled, dated entries)
// is the canonical notes substrate going forward, surfaced via the action
// panel work in commit 4. The DB column stays put — drop, don't migrate.
type Section = 'links' | 'logs' | null

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
  links: ObjectiveLink[]
  logs: ObjectiveLog[]
  metricCheckins: MetricCheckin[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  onAddLink: (link: ObjectiveLink) => void
  onDeleteLink: (id: string) => void
  onAddLog: (log: ObjectiveLog) => void
  onDeleteLog: (id: string) => void
  onEditKR: (kr: RoadmapItem) => void
  onLogMetric: (krId: string) => void
  toast: (m: string) => void
}

export default function ObjectiveCard({ obj, krs, actions, weekStart, links, logs, metricCheckins, setRoadmapItems, setObjectives, setActions, onAddLink, onDeleteLink, onAddLog, onDeleteLog, onEditKR, onLogMetric, toast }: Props) {
  const [collapsed, setCollapsed] = useState(true)
  const [section, setSection] = useState<Section>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [logEntry, setLogEntry] = useState('')
  const [savingLog, setSavingLog] = useState(false)
  const [addingKR, setAddingKR] = useState(false)
  const [newKRTitle, setNewKRTitle] = useState('')
  const [newKRIsHabit, setNewKRIsHabit] = useState(false)
  const [savingKR, setSavingKR] = useState(false)
  const [addingActionKRId, setAddingActionKRId] = useState<string | null>(null)
  const [newActionTitle, setNewActionTitle] = useState('')
  const [savingAction, setSavingAction] = useState(false)

  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack  = krs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
  const offTrack = krs.filter(k => k.health_status === 'off_track').length
  const blocked  = krs.filter(k => k.health_status === 'blocked').length
  const notStarted = krs.filter(k => k.health_status === 'not_started' || !k.health_status).length
  const doneKRs  = krs.filter(k => k.health_status === 'done').length
  const progress = krs.length > 0 ? Math.round((doneKRs / krs.length) * 100) : 0
  const objLinks = links.filter(l => l.objective_id === obj.id)
  const objLogs  = logs.filter(l => l.objective_id === obj.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

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

  async function addLink() {
    if (!linkUrl.trim() || addingLink) return
    setAddingLink(true)
    let url = linkUrl.trim()
    if (!url.startsWith('http')) url = 'https://' + url
    const domain = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    try {
      const created = await extrasDb.links.create({
        objective_id: obj.id,
        url,
        title: domain,
        sort_order: objLinks.length,
      })
      onAddLink(created)
      setLinkUrl('')
    } catch (err) {
      console.error('addLink failed:', err)
    }
    setAddingLink(false)
  }

  async function saveLog() {
    if (!logEntry.trim() || savingLog) return
    setSavingLog(true)
    const today = getToday()
    try {
      const created = await extrasDb.logs.create({
        objective_id: obj.id,
        content: logEntry.trim(),
        log_date: today,
      })
      onAddLog(created)
      setLogEntry('')
    } catch (err) {
      console.error('saveLog failed:', err)
    }
    setSavingLog(false)
  }

  async function deleteLogEntry(id: string) {
    try {
      await extrasDb.logs.remove(id)
      onDeleteLog(id)
    } catch (err) {
      console.error('deleteLogEntry failed:', err)
    }
  }

  async function deleteLink(id: string) {
    try {
      await extrasDb.links.remove(id)
      onDeleteLink(id)
    } catch (err) {
      console.error('deleteLink failed:', err)
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

  function toggleSection(s: Section) {
    setSection(prev => prev === s ? null : s)
  }

  const borderColor = hex2rgba(obj.color, 0.25)
  const bgColor = hex2rgba(obj.color, 0.04)
  const hdrBg = hex2rgba(obj.color, 0.1)
  const divColor = hex2rgba(obj.color, 0.12)

  return (
    <>
      <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: `1px solid ${borderColor}`, background: bgColor }}>

        {/* Objective header */}
        <div onClick={() => { setCollapsed(c => !c); setSection(null) }}
          style={{ padding: '12px 14px', background: hdrBg, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color, flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)', lineHeight: 1.3, marginBottom: collapsed ? 5 : 5 }}>
              {obj.name}
            </div>
            {collapsed ? (
              // Collapsed: show clean status counts
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
                {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
                {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
                {notStarted > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>{notStarted} not started</span>}
                {krs.length === 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>No key results</span>}
              </div>
            ) : (
              // Expanded: show same status counts (unchanged)
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
                {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
                {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
                {notStarted > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>{notStarted} not started</span>}
              </div>
            )}
            {/* Progress bar — always visible, even collapsed */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
              <div style={{ flex: 1, height: 4, background: 'var(--navy-600)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: 4, borderRadius: 2, background: progress === 100 ? 'var(--teal)' : obj.color, width: `${progress}%`, transition: 'width .4s ease' }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: progress === 100 ? 'var(--teal-text)' : 'var(--navy-300)', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>
                {progress}%
              </span>
            </div>
          </div>
          {/* Chevron */}
          <div style={{ flexShrink: 0, marginTop: 2, transition: 'transform .2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', color: 'var(--navy-400)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Body — hidden when collapsed */}
        {!collapsed && (<>

        {/* KR rows */}
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
              {/* Inline action form */}
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

        {/* Footer tabs */}
        <div style={{ display: 'flex', borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
          {/* Links tab */}
          <button onClick={() => toggleSection('links')}
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: section === 'links' ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'none', border: 'none', borderRight: `1px solid ${divColor}`, cursor: 'pointer', color: section === 'links' ? obj.color : 'var(--navy-400)', transition: 'color .12s' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.5-1.5a3.5 3.5 0 0 0-4.95-4.95L7 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0L3 8a3.5 3.5 0 0 0 4.95 4.95L9 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Links
            {objLinks.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: section === 'links' ? obj.color : 'var(--navy-600)', color: section === 'links' ? '#fff' : 'var(--navy-400)' }}>
                {objLinks.length}
              </span>
            )}
          </button>
          {/* Logs tab */}
          <button onClick={() => toggleSection('logs')}
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: section === 'logs' ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: section === 'logs' ? obj.color : 'var(--navy-400)', transition: 'color .12s' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Logs
            {objLogs.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: section === 'logs' ? obj.color : 'var(--navy-600)', color: section === 'logs' ? '#fff' : 'var(--navy-400)' }}>
                {objLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Links section */}
        {section === 'links' && (
          <div style={{ padding: '12px 14px', background: 'var(--navy-700)', borderTop: `1px solid ${divColor}` }}>
            {objLinks.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', paddingBottom: 10 }}>No links yet</div>
            )}
            {objLinks.map((link, i) => (
              <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: i < objLinks.length - 1 ? '1px solid var(--navy-600)' : 'none' }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.5-1.5a3.5 3.5 0 0 0-4.95-4.95L7 4" stroke="var(--navy-300)" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0L3 8a3.5 3.5 0 0 0 4.95 4.95L9 12" stroke="var(--navy-300)" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, fontWeight: 500, color: 'var(--navy-100)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {link.title || link.url}
                  </a>
                  <div style={{ fontSize: 10, color: 'var(--navy-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.url}</div>
                </div>
                <button onClick={() => deleteLink(link.id)}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  ×
                </button>
              </div>
            ))}
            {/* Add link input */}
            <div style={{ display: 'flex', gap: 7, marginTop: objLinks.length > 0 ? 10 : 0 }}>
              <input
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addLink()}
                placeholder="Paste a URL…"
                className="input"
                style={{ flex: 1, fontSize: 12, padding: '8px 11px' }}
              />
              <button onClick={addLink} disabled={!linkUrl.trim() || addingLink}
                style={{ padding: '8px 14px', background: obj.color, color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 10, cursor: 'pointer', flexShrink: 0, opacity: !linkUrl.trim() ? .5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="white" strokeWidth="1.7" strokeLinecap="round"/></svg>
                Add
              </button>
            </div>
          </div>
        )}

        {/* Logs section */}
        {section === 'logs' && (
          <div style={{ borderTop: `1px solid ${divColor}`, background: 'var(--navy-700)' }}>
            {/* New entry form */}
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${divColor}` }}>
              <textarea
                value={logEntry}
                onChange={e => setLogEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveLog() }}
                placeholder={`What's happening with ${obj.name.split('—')[0].trim()}?`}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'none', color: 'var(--navy-100)', outline: 'none', marginBottom: 8 }}
                rows={3}
              />
              <button onClick={saveLog} disabled={!logEntry.trim() || savingLog}
                style={{ padding: '8px 18px', background: obj.color, color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9, cursor: 'pointer', opacity: !logEntry.trim() ? .45 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="white" strokeWidth="1.7" strokeLinecap="round"/></svg>
                {savingLog ? 'Saving…' : 'Log it'}
              </button>
            </div>
            {/* Entries — newest first */}
            {objLogs.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '14px 0' }}>
                No entries yet
              </div>
            )}
            {objLogs.map((log, i) => (
              <div key={log.id} style={{ padding: '12px 14px', borderBottom: i < objLogs.length - 1 ? `1px solid ${divColor}` : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>
                    {new Date(log.log_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--navy-200)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {log.content}
                  </div>
                </div>
                <button onClick={() => deleteLogEntry(log.id)}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}
      </div>
    </>
  )
}
