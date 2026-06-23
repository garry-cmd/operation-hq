'use client'
import { useState, useMemo, useEffect, Fragment } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type {
  Space, AnnualObjective, RoadmapItem, WeeklyAction, MetricCheckin, Task,
  HabitCheckin, Note, Notebook, TrackedFile, WeeklyReview, ObjectiveLog,
} from '@/lib/types'
import { getMonday, addWeeks, parseDateLocal, ACTIVE_Q, formatMinutes } from '@/lib/utils'
import { getMetricKRs } from '@/lib/krFilters'
import VitalsStrip from './VitalsStrip'
import { randomQuote } from '@/lib/quotes'
import { spaceDisplayColor } from '@/lib/spaceColor'
import * as actionsDb from '@/lib/db/actions'
import * as checkinsDb from '@/lib/db/checkins'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import * as extrasDb from '@/lib/db/objectiveExtras'
import EditKRModal from './EditKRModal'
import EditObjectiveModal from './EditObjectiveModal'

// ── small local date helpers (no deps) ──
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateForDow(monday: string, i: number): string {
  const d = parseDateLocal(monday); d.setDate(d.getDate() + i); return ymd(d)
}
function fmtRange(monday: string): string {
  const m = parseDateLocal(monday); const e = new Date(m); e.setDate(e.getDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(m)} – ${f(e)}`
}
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// KR health → night-watch tone for the board pills.
const HEALTH_TONE: Record<string, { cls: string; label: string }> = {
  on_track:    { cls: 't-nominal', label: 'on track' },
  off_track:   { cls: 't-alarm',   label: 'off track' },
  blocked:     { cls: 't-alarm',   label: 'blocked' },
  waiting:     { cls: 't-caution', label: 'waiting' },
  backlog:     { cls: 't-standby', label: 'backlog' },
  not_started: { cls: 't-standby', label: 'not started' },
  done:        { cls: 't-nominal', label: 'done' },
}
function healthTone(s: string | null | undefined) {
  return HEALTH_TONE[s ?? 'not_started'] ?? HEALTH_TONE.not_started
}
// Compact metric readout. Supabase numerics arrive as strings — coerce.
function fmtMetric(v: number | string | null | undefined, unit: string | null | undefined): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  const s = isFinite(n) ? n.toLocaleString() : String(v)
  if (unit === '$') return '$' + s
  if (!unit || unit === '#') return s
  return `${s} ${unit}`
}
function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { const v = window.localStorage.getItem(key); return v == null ? fallback : (JSON.parse(v) as T) } catch { return fallback }
}

// Estimated-duration buckets for action items (multi-hour project pieces).
const ACTION_DURATIONS = [30, 60, 90, 120, 180, 240]
const RING_C = 2 * Math.PI * 18 // circumference for r=18

interface Props {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  setActions: Dispatch<SetStateAction<WeeklyAction[]>>
  metricCheckins: MetricCheckin[]
  tasks: Task[]
  setTasks: Dispatch<SetStateAction<Task[]>>
  habitCheckins: HabitCheckin[]
  setHabitCheckins: (fn: (h: HabitCheckin[]) => HabitCheckin[]) => void
  notes: Note[]
  setNotes: Dispatch<SetStateAction<Note[]>>
  notebooks: Notebook[]
  tagsByNote: Map<string, string[]>
  setTagsByNote: Dispatch<SetStateAction<Map<string, string[]>>>
  googleConnected: boolean
  driveGranted: boolean
  trackedFiles: TrackedFile[]
  setTrackedFiles: Dispatch<SetStateAction<TrackedFile[]>>
  reviews: WeeklyReview[]
  weekForSpace: (spaceId: string) => string
  onCloseWeek: (spaceId: string, week: string) => void
  onOpenNote: (noteId: string) => void
  onOpenTasks: () => void
  onOpenCalendar: () => void
  onLogMetric: (krId: string) => void
  setObjectives: Dispatch<SetStateAction<AnnualObjective[]>>
  setRoadmapItems: Dispatch<SetStateAction<RoadmapItem[]>>
  onOpenObjective: (objectiveId: string) => void
  logs: ObjectiveLog[]
  setLogs: Dispatch<SetStateAction<ObjectiveLog[]>>
  initialKRId?: string | null
  onConsumeInitialKRId?: () => void
  toast: (m: string) => void
}

export default function Home({
  spaces, objectives, roadmapItems, actions, setActions,
  metricCheckins, habitCheckins, setHabitCheckins,
  reviews, weekForSpace, onCloseWeek, onLogMetric,
  setObjectives, setRoadmapItems, onOpenObjective,
  logs, setLogs, initialKRId, onConsumeInitialKRId, toast,
}: Props) {
  const [weekMonday, setWeekMonday] = useState<string>(getMonday())
  const [spaceFilter, setSpaceFilter] = useState<string | null>(() => {
    const v = loadLS<string | null>('hq-home-space-filter', null)
    return v && spaces.some(s => s.id === v) ? v : null
  })
  const [quarterScope, setQuarterScope] = useState<'current' | 'all'>(() =>
    loadLS<'current' | 'all'>('hq-home-qtr-scope', 'current') === 'all' ? 'all' : 'current')
  const [editingKR, setEditingKR] = useState<RoadmapItem | null>(null)
  const [editingObjective, setEditingObjective] = useState<AnnualObjective | null>(null)
  const [durPickerAction, setDurPickerAction] = useState<string | null>(null)
  const [addActionKR, setAddActionKR] = useState<string | null>(null)
  const [actionDraft, setActionDraft] = useState('')
  const [logComposer, setLogComposer] = useState<{ krId: string; objId: string } | null>(null)
  const [logDraft, setLogDraft] = useState('')

  const todayStr = ymd(new Date())
  const isCurrentWeek = weekMonday === getMonday()
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateForDow(weekMonday, i)), [weekMonday])
  const [quote] = useState(() => randomQuote())

  useEffect(() => { try { window.localStorage.setItem('hq-home-space-filter', JSON.stringify(spaceFilter)) } catch {} }, [spaceFilter])
  useEffect(() => { try { window.localStorage.setItem('hq-home-qtr-scope', JSON.stringify(quarterScope)) } catch {} }, [quarterScope])

  const spaceById = useMemo(() => new Map(spaces.map(s => [s.id, s])), [spaces])
  const orderedSpaces = useMemo(() => [...spaces].sort((a, b) => a.sort_order - b.sort_order), [spaces])

  // Deep-link from ⌘K: scope Home to the KR's space (no dive anymore).
  useEffect(() => {
    if (!initialKRId) return
    const kr = roadmapItems.find(k => k.id === initialKRId)
    if (kr?.space_id) setSpaceFilter(kr.space_id)
    onConsumeInitialKRId?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKRId])

  // ── close-week status per space (independent of displayed week) ──
  const thisMonday = getMonday()
  const openCloses = orderedSpaces
    .map(sp => {
      const wk = weekForSpace(sp.id)
      const closed = reviews.some(r => r.space_id === sp.id && r.week_start === wk && r.closed_at != null)
      const open = !closed && wk <= thisMonday
      return { sp, wk, open, overdue: open && wk < thisMonday }
    })
    .filter(r => r.open && (spaceFilter === null || r.sp.id === spaceFilter))

  // ── metric readout per KR + metric band ──
  const latestMetricByKR = useMemo(() => {
    const m = new Map<string, MetricCheckin>()
    for (const c of metricCheckins) {
      const cur = m.get(c.roadmap_item_id)
      if (!cur || (c.week_start ?? '') > (cur.week_start ?? '')) m.set(c.roadmap_item_id, c)
    }
    return m
  }, [metricCheckins])
  const metricKRs = useMemo(
    () => getMetricKRs(roadmapItems, ACTIVE_Q).filter(k => spaceFilter === null || k.space_id === spaceFilter),
    [roadmapItems, spaceFilter],
  )

  // ── habits: KR × this-week 7-day grid ──
  const habitKRs = useMemo(() =>
    roadmapItems.filter(k => k.is_habit && !k.is_parked && k.health_status !== 'done'
      && (spaceFilter === null || k.space_id === spaceFilter)),
    [roadmapItems, spaceFilter])
  const checkinSet = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of habitCheckins) m.set(`${c.roadmap_item_id}:${c.date}`, c.id)
    return m
  }, [habitCheckins])

  // ── logs grouped by KR (per-KR log lane) ──
  const logsByKR = useMemo(() => {
    const m = new Map<string, ObjectiveLog[]>()
    for (const l of logs) {
      if (!l.roadmap_item_id) continue
      const a = m.get(l.roadmap_item_id) ?? []; a.push(l); m.set(l.roadmap_item_id, a)
    }
    for (const a of m.values()) a.sort((x, y) => (y.log_date ?? '').localeCompare(x.log_date ?? ''))
    return m
  }, [logs])

  // ── carried-forward weeks per (kr,title): prior scheduled instances ──
  const carriedByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of actions) {
      if (a.week_start && a.week_start < weekMonday) {
        const k = `${a.roadmap_item_id}::${a.title}`
        m.set(k, (m.get(k) ?? 0) + 1)
      }
    }
    return m
  }, [actions, weekMonday])
  const carriedFor = (a: WeeklyAction) => carriedByKey.get(`${a.roadmap_item_id}::${a.title}`) ?? 0

  // ── the board: objectives → deliverable KRs (+actions/logs) + habit/metric KRs ──
  const board = useMemo(() => {
    const objs = objectives
      .filter(o => o.status !== 'abandoned' && (spaceFilter === null || o.space_id === spaceFilter))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return objs
      .map(o => {
        const allKRs = roadmapItems
          .filter(k => k.annual_objective_id === o.id && !k.is_parked
            && (quarterScope === 'all' || k.quarter === ACTIVE_Q))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        const deliverables = allKRs
          .filter(k => !k.is_habit && !k.is_metric)
          .map(kr => ({
            kr,
            thisWeek: actions.filter(a => a.roadmap_item_id === kr.id && a.week_start === weekMonday),
            backlog: actions.filter(a => a.roadmap_item_id === kr.id && a.week_start == null && !a.completed),
          }))
        const special = allKRs.filter(k => k.is_habit || k.is_metric)
        const total = allKRs.length
        const done = allKRs.filter(k => k.health_status === 'done').length
        return { obj: o, deliverables, special, total, done }
      })
      .filter(g => g.deliverables.length > 0 || g.special.length > 0)
  }, [objectives, roadmapItems, actions, weekMonday, spaceFilter, quarterScope])

  // ── mutations ──
  async function toggleAction(a: WeeklyAction) {
    try {
      const updated = await actionsDb.update(a.id, { completed: !a.completed })
      setActions(prev => prev.map(x => x.id === a.id ? updated : x))
    } catch { toast('Could not update action') }
  }
  async function scheduleAction(a: WeeklyAction, week: string | null) {
    setActions(prev => prev.map(x => x.id === a.id ? { ...x, week_start: week } : x))
    try { await actionsDb.update(a.id, { week_start: week }) }
    catch { toast('Could not reschedule'); setActions(prev => prev.map(x => x.id === a.id ? a : x)) }
  }
  async function setActionDuration(a: WeeklyAction, mins: number | null) {
    setDurPickerAction(null)
    setActions(prev => prev.map(x => x.id === a.id ? { ...x, estimated_minutes: mins } : x))
    try { await actionsDb.update(a.id, { estimated_minutes: mins }) }
    catch { toast('Could not set duration'); setActions(prev => prev.map(x => x.id === a.id ? a : x)) }
  }
  async function submitAction(kr: RoadmapItem) {
    const t = actionDraft.trim(); if (!t) return
    try {
      const created = await actionsDb.create({ roadmap_item_id: kr.id, title: t, week_start: weekMonday })
      setActions(prev => [...prev, created]); setActionDraft(''); setAddActionKR(null)
    } catch { toast('Could not add action') }
  }
  async function toggleHabit(krId: string, date: string) {
    const existing = checkinSet.get(`${krId}:${date}`)
    try {
      if (existing) {
        await checkinsDb.habit.remove(existing)
        setHabitCheckins(prev => prev.filter(c => c.id !== existing))
      } else {
        const created = await checkinsDb.habit.create(krId, date)
        setHabitCheckins(prev => [...prev, created])
      }
    } catch { toast('Could not update habit') }
  }
  async function toggleKRDone(kr: RoadmapItem) {
    const next = kr.health_status === 'done' ? 'on_track' : 'done'
    setRoadmapItems(prev => prev.map(k => k.id === kr.id ? { ...k, health_status: next } : k))
    try { await krsDb.update(kr.id, { health_status: next }) }
    catch { toast('Could not update KR'); setRoadmapItems(prev => prev.map(k => k.id === kr.id ? kr : k)) }
  }
  async function submitLog() {
    const c = logComposer; const body = logDraft.trim()
    if (!c || !body) { setLogComposer(null); setLogDraft(''); return }
    try {
      const created = await extrasDb.logs.create({
        objective_id: c.objId, roadmap_item_id: c.krId, content: body, log_date: todayStr,
      })
      setLogs(prev => [created, ...prev]); setLogDraft(''); setLogComposer(null)
    } catch { toast('Could not save log') }
  }
  async function deleteKR(id: string) {
    try { await krsDb.remove(id); setRoadmapItems(prev => prev.filter(k => k.id !== id)); toast('Key Result deleted') }
    catch { toast('Failed to delete KR') }
  }
  async function deleteObjective(id: string) {
    try {
      try { await krsDb.removeByObjective(id) } catch { toast('Failed to delete objective'); return }
      await objectivesDb.remove(id)
      setRoadmapItems(prev => prev.filter(k => k.annual_objective_id !== id))
      setObjectives(prev => prev.filter(o => o.id !== id))
      toast('Objective deleted')
    } catch { toast('Failed to delete objective') }
  }

  // ── render helpers ──
  function durBadge(a: WeeklyAction) {
    const open = durPickerAction === a.id
    return (
      <button
        className={`act-dur${a.estimated_minutes ? ' set' : ''}${open ? ' open' : ''}`}
        title={a.estimated_minutes ? 'Change estimated duration' : 'Set estimated duration'}
        onClick={e => { e.stopPropagation(); setDurPickerAction(open ? null : a.id) }}
      >{a.estimated_minutes ? formatMinutes(a.estimated_minutes) : '+est'}</button>
    )
  }
  function durPicker(a: WeeklyAction) {
    if (durPickerAction !== a.id) return null
    return (
      <div className="act-durpick" onClick={e => e.stopPropagation()}>
        {ACTION_DURATIONS.map(m => (
          <button key={m} className={`act-durchip${a.estimated_minutes === m ? ' on' : ''}`}
            onClick={() => setActionDuration(a, a.estimated_minutes === m ? null : m)}>{formatMinutes(m)}</button>
        ))}
        {a.estimated_minutes != null && (
          <button className="act-durchip clear" onClick={() => setActionDuration(a, null)}>clear</button>
        )}
      </div>
    )
  }
  function actionRow(a: WeeklyAction, scheduled: boolean) {
    const carried = scheduled && !a.completed ? carriedFor(a) : 0
    return (
      <Fragment key={a.id}>
        <div className={`act${a.completed ? ' done' : ''}`}>
          <button className={`cb-sm${a.completed ? ' on' : ''}`} onClick={() => toggleAction(a)} title={a.completed ? 'Mark not done' : 'Mark done'}>{a.completed ? '✓' : ''}</button>
          <span className="at">{a.title}</span>
          {carried > 0 && <span className="carried" title={`Scheduled ${carried} prior week${carried > 1 ? 's' : ''}, still open`}>carried {carried} wk{carried > 1 ? 's' : ''}</span>}
          {scheduled
            ? <button className="sched week" title="Move to backlog" onClick={() => scheduleAction(a, null)}>this week</button>
            : <button className="sched promote" title="Schedule this week" onClick={() => scheduleAction(a, weekMonday)}>▸ this week</button>}
          {durBadge(a)}
        </div>
        {durPicker(a)}
      </Fragment>
    )
  }

  const objCount = board.length

  return (
    <div className="home">
      {/* header */}
      <div className="hd">
        <span className="hd-brand">Home</span>
        <span className="hd-qtr">{ACTIVE_Q}</span>
        <div className="hd-controls">
          <div className="wknav">
            <button onClick={() => setWeekMonday(addWeeks(weekMonday, -1))} title="Previous week">‹</button>
            <span className="wklbl" onClick={() => setWeekMonday(getMonday())} title="Jump to this week">
              {isCurrentWeek ? 'THIS WEEK' : fmtRange(weekMonday)}
            </span>
            <button onClick={() => setWeekMonday(addWeeks(weekMonday, 1))} title="Next week">›</button>
          </div>
          <select className="sel" value={quarterScope} onChange={e => setQuarterScope(e.target.value as 'current' | 'all')} title="Quarter scope">
            <option value="current">This quarter</option>
            <option value="all">All quarters</option>
          </select>
          <select className="sel" value={spaceFilter ?? ''} onChange={e => setSpaceFilter(e.target.value || null)} title="Space filter">
            <option value="">All spaces</option>
            {orderedSpaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* quote */}
      <div className="quote">
        <p>&ldquo;{quote.text}&rdquo;</p>
        {quote.author && <span>— {quote.author}</span>}
      </div>

      {/* habits */}
      {habitKRs.length > 0 && (
        <>
          <div className="seclbl"><span className="lbl">Habits · this week</span><span className="rule" /></div>
          <div className="habits">
            {habitKRs.map(kr => {
              const done = weekDates.filter(d => checkinSet.has(`${kr.id}:${d}`)).length
              const tone = healthTone(kr.health_status)
              return (
                <div key={kr.id} className="hcard">
                  <h4>{kr.title}</h4>
                  <div className="dots">
                    {weekDates.map((d, i) => {
                      const on = checkinSet.has(`${kr.id}:${d}`)
                      return <button key={d} className={`hdot${on ? ' on' : ''}`} title={`${DOW[i]} · ${d}`} onClick={() => toggleHabit(kr.id, d)} />
                    })}
                  </div>
                  <div className="hrow"><span className="cnt">{done} this wk</span><span className={`chip ${tone.cls}`}>{tone.label}</span></div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* metrics */}
      {metricKRs.length > 0 && (
        <VitalsStrip krs={metricKRs} checkins={metricCheckins} onLog={onLogMetric} />
      )}

      {/* week close */}
      {openCloses.length > 0 && (
        <div className="closes">
          {openCloses.map(({ sp, wk, overdue }) => (
            <div key={sp.id} className="closebar">
              <div className="ci">◷</div>
              <div className="ct">
                <b>{sp.name} — week of {fmtRange(wk).split(' – ')[0]}{overdue ? ' (overdue)' : ''}</b>
                <div>Review KRs, log metrics, plan next week</div>
              </div>
              <button className="cb-close" onClick={() => onCloseWeek(sp.id, wk)}>Close week →</button>
            </div>
          ))}
        </div>
      )}

      {/* objective board */}
      <div className="seclbl"><span className="lbl">Objectives{objCount ? ` · ${objCount}` : ''}</span><span className="rule" /></div>
      {board.length === 0 ? (
        <div className="empty">No objectives in scope. Try a different space or quarter.</div>
      ) : (
        <div className="board">
          {board.map(({ obj, deliverables, special, total, done }) => {
            const pct = total ? Math.round((done / total) * 100) : 0
            const oc = obj.space_id ? spaceDisplayColor(spaceById.get(obj.space_id)!) : 'var(--navy-500)'
            return (
              <div key={obj.id} className="ocard">
                <div className="ohead" style={{ borderLeftColor: oc }}>
                  <svg width="44" height="44" viewBox="0 0 44 44" className="ring">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="var(--navy-700)" strokeWidth="4" />
                    <circle cx="22" cy="22" r="18" fill="none" stroke={oc} strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - pct / 100)} transform="rotate(-90 22 22)" />
                    <text x="22" y="26" textAnchor="middle" className="ringtxt">{pct}%</text>
                  </svg>
                  <div className="oh-main">
                    <h3>{obj.name}</h3>
                    <div className="oh-sub"><span className="k">{done} / {total} KRs done</span></div>
                  </div>
                  <div className="oh-acts">
                    <button className="oh-btn" title="Links & objective log" onClick={() => onOpenObjective(obj.id)}>⋯</button>
                    <button className="oh-btn" title="Edit objective" onClick={() => setEditingObjective(obj)}>✎</button>
                  </div>
                </div>

                <div className="krs">
                  {deliverables.map(({ kr, thisWeek, backlog }) => {
                    const tone = healthTone(kr.health_status)
                    const isDone = kr.health_status === 'done'
                    const krLogs = logsByKR.get(kr.id) ?? []
                    const composing = logComposer?.krId === kr.id
                    return (
                      <div key={kr.id} className={`kr${isDone ? ' done' : ''}`}>
                        <div className="kr-l">
                          <div className="kr-head">
                            <button className={`cb${isDone ? ' on' : ''}`} onClick={() => toggleKRDone(kr)} title={isDone ? 'Mark not done' : 'Mark done'}>{isDone ? '✓' : ''}</button>
                            <span className="kt">{kr.title}{!isDone && <span className={`st ${tone.cls}`}>{tone.label}</span>}</span>
                            <button className="kr-edit" title="Edit KR" onClick={() => setEditingKR(kr)}>✎</button>
                          </div>
                          {(thisWeek.length > 0 || backlog.length > 0 || addActionKR === kr.id) && (
                            <div className="acts">
                              {thisWeek.map(a => actionRow(a, true))}
                              {backlog.map(a => actionRow(a, false))}
                              {addActionKR === kr.id ? (
                                <input className="act-input" autoFocus value={actionDraft}
                                  placeholder="New action…"
                                  onChange={e => setActionDraft(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') submitAction(kr); if (e.key === 'Escape') { setAddActionKR(null); setActionDraft('') } }}
                                  onBlur={() => { if (!actionDraft.trim()) setAddActionKR(null) }} />
                              ) : (
                                <button className="addact" onClick={() => { setAddActionKR(kr.id); setActionDraft('') }}>+ action</button>
                              )}
                            </div>
                          )}
                          {thisWeek.length === 0 && backlog.length === 0 && addActionKR !== kr.id && (
                            <div className="acts"><button className="addact" onClick={() => { setAddActionKR(kr.id); setActionDraft('') }}>+ action</button></div>
                          )}
                        </div>

                        <div className={`kr-r${krLogs.length === 0 && !composing ? ' empty' : ''}`}>
                          {krLogs.map(l => (
                            <div key={l.id} className="log-e">
                              <span className="wk">{(l.log_date ?? '').slice(5)}</span>
                              <span className="log-t">{l.title ? <b>{l.title}. </b> : null}{l.content}</span>
                            </div>
                          ))}
                          {composing ? (
                            <textarea className="log-input" autoFocus value={logDraft}
                              placeholder="Log an update for this KR…"
                              onChange={e => setLogDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitLog(); if (e.key === 'Escape') { setLogComposer(null); setLogDraft('') } }}
                              onBlur={submitLog} />
                          ) : (
                            <button className="addlog" onClick={() => { setLogComposer({ krId: kr.id, objId: obj.id }); setLogDraft('') }}>+ log</button>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {special.length > 0 && (
                    <>
                      <div className="grp-div" />
                      {special.map(kr => {
                        if (kr.is_metric) {
                          const c = latestMetricByKR.get(kr.id)
                          const dir = kr.metric_direction === 'down' ? '↓' : '↑'
                          const isDone = kr.health_status === 'done'
                          return (
                            <div key={kr.id} className="krmini" onClick={() => onLogMetric(kr.id)} title="Log a reading">
                              <span className="tag">metric</span><span className="mt">{kr.title}</span>
                              <span className="read" style={isDone ? { color: 'var(--nw-nominal-text)' } : undefined}>
                                {isDone ? 'done' : <>{fmtMetric(c?.value, kr.metric_unit)}<span className="u"> {dir}</span></>}
                              </span>
                            </div>
                          )
                        }
                        const tone = healthTone(kr.health_status)
                        const wkDone = weekDates.filter(d => checkinSet.has(`${kr.id}:${d}`)).length
                        return (
                          <div key={kr.id} className="krmini">
                            <span className="tag">habit</span><span className="mt">{kr.title}</span>
                            <span className="read" style={{ color: `var(--${tone.cls === 't-nominal' ? 'nw-nominal-text' : tone.cls === 't-alarm' ? 'nw-alarm-text' : 'navy-300'})` }}>{wkDone}<span className="u"> / 7 wk</span></span>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editingKR && (
        <EditKRModal
          kr={editingKR}
          onClose={() => setEditingKR(null)}
          onSave={async (patch) => {
            try {
              const updated = await krsDb.update(editingKR.id, patch)
              setRoadmapItems(prev => prev.map(k => k.id === editingKR.id ? updated : k))
              setEditingKR(null); toast('Key Result updated')
            } catch { toast('Failed to update KR') }
          }}
          onDelete={() => { deleteKR(editingKR.id); setEditingKR(null) }}
          toast={toast}
        />
      )}
      {editingObjective && (
        <EditObjectiveModal
          objective={editingObjective}
          onClose={() => setEditingObjective(null)}
          onSave={async (patch) => {
            try {
              const updated = await objectivesDb.update(editingObjective.id, patch)
              setObjectives(prev => prev.map(o => o.id === editingObjective.id ? updated : o))
              setEditingObjective(null); toast('Objective updated')
            } catch { toast('Failed to update objective') }
          }}
          onDelete={() => { deleteObjective(editingObjective.id); setEditingObjective(null) }}
          toast={toast}
        />
      )}

      <style>{`
        .home{max-width:1140px;margin:0 auto;padding:8px 4px 80px;}
        .lbl{font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--nw-label);}

        .hd{display:flex;align-items:center;gap:13px;padding:8px 0 2px;flex-wrap:wrap;}
        .hd-brand{font-family:var(--font-display);font-weight:700;font-size:22px;color:var(--nw-cream);letter-spacing:-.015em;}
        .hd-qtr{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--nw-label);letter-spacing:.14em;}
        .hd-controls{margin-left:auto;display:flex;align-items:center;gap:9px;}
        .wknav{display:flex;align-items:center;gap:2px;background:var(--surface);border:1px solid var(--line-2);border-radius:8px;padding:2px;}
        .wknav button{background:none;border:none;color:var(--navy-300);font-size:15px;cursor:pointer;padding:2px 8px;border-radius:6px;line-height:1;}
        .wknav button:hover{background:var(--hover);color:var(--navy-50);}
        .wklbl{font-family:var(--font-mono);font-size:10.5px;font-weight:600;letter-spacing:.06em;color:var(--navy-200);padding:0 6px;cursor:pointer;min-width:70px;text-align:center;}
        .sel{font-family:var(--font-body);font-size:12px;color:var(--navy-200);background:var(--surface);border:1px solid var(--line-2);border-radius:8px;padding:6px 9px;cursor:pointer;}

        .quote{margin:14px 0 22px;padding-left:14px;border-left:2px solid var(--nw-label-dim);}
        .quote p{margin:0;font-family:var(--font-display);font-weight:500;font-size:15px;color:var(--navy-200);font-style:italic;letter-spacing:-.005em;}
        .quote span{font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--navy-500);text-transform:uppercase;}

        .seclbl{display:flex;align-items:center;gap:10px;margin:0 0 11px;}
        .seclbl .rule{flex:1;height:1px;background:var(--line);}

        .habits{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:11px;margin-bottom:22px;}
        .hcard{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:13px;}
        .hcard h4{margin:0;font-family:var(--font-display);font-weight:600;font-size:13.5px;color:var(--nw-cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .dots{display:flex;gap:5px;margin:11px 0 9px;}
        .hdot{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--navy-600);background:transparent;cursor:pointer;padding:0;}
        .hdot.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .hrow{display:flex;align-items:center;justify-content:space-between;}
        .cnt{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--navy-200);}
        .chip{font-family:var(--font-mono);font-size:8.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:5px;}
        .chip.t-alarm{color:var(--nw-alarm-text);background:rgba(255,100,82,.1);}
        .chip.t-nominal{color:var(--nw-nominal-text);background:rgba(127,226,122,.1);}
        .chip.t-caution{color:var(--nw-caution-text);background:rgba(245,184,64,.1);}
        .chip.t-standby{color:var(--nw-standby-text);background:var(--surface-2);}

        .closes{display:flex;flex-direction:column;gap:10px;margin:4px 0 30px;}
        .closebar{display:flex;align-items:center;gap:16px;background:linear-gradient(90deg,rgba(200,150,66,.07),transparent 55%),var(--surface);border:1px solid var(--line-2);border-radius:13px;padding:13px 16px;}
        .closebar .ci{width:32px;height:32px;border-radius:9px;background:rgba(200,150,66,.12);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
        .closebar .ct b{font-family:var(--font-display);font-weight:600;font-size:13.5px;color:var(--nw-cream);}
        .closebar .ct div{font-size:11.5px;color:var(--navy-400);margin-top:1px;}
        .cb-close{margin-left:auto;font-family:var(--font-body);font-weight:600;font-size:12.5px;color:#fff;background:var(--accent);border:none;border-radius:9px;padding:8px 15px;cursor:pointer;}
        .cb-close:hover{background:var(--accent-2,#6ea3ff);}

        .empty{color:var(--navy-500);font-size:13px;padding:30px 0;text-align:center;}
        .board{display:flex;flex-direction:column;gap:16px;}
        .ocard{background:var(--surface);border:1px solid var(--line);border-radius:15px;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.02) inset,0 8px 24px -16px rgba(0,0,0,.7);}
        .ohead{display:flex;align-items:center;gap:14px;padding:15px 16px 14px;border-left:3px solid var(--navy-500);}
        .ring{flex-shrink:0;}
        .ringtxt{font-family:var(--font-mono);font-size:11px;font-weight:600;fill:var(--nw-cream);}
        .oh-main{flex:1;min-width:0;}
        .oh-main h3{margin:0;font-family:var(--font-display);font-weight:600;font-size:15.5px;color:var(--nw-cream);letter-spacing:-.01em;line-height:1.25;}
        .oh-sub{display:flex;align-items:center;gap:9px;margin-top:3px;}
        .oh-sub .k{font-family:var(--font-mono);font-size:10.5px;color:var(--navy-400);}
        .oh-acts{display:flex;gap:4px;flex-shrink:0;align-self:flex-start;}
        .oh-btn{background:none;border:none;color:var(--navy-500);font-size:14px;cursor:pointer;padding:3px 7px;border-radius:6px;line-height:1;}
        .oh-btn:hover{background:var(--hover);color:var(--navy-100);}

        .krs{padding:4px 0 8px;}
        .kr{display:flex;align-items:flex-start;padding:9px 16px;}
        .kr:hover{background:rgba(255,255,255,.012);}
        .kr-l{flex:0 0 56%;padding-right:16px;}
        .kr-r{flex:1;min-width:0;padding-left:16px;border-left:1px solid var(--line);align-self:stretch;}
        .kr-r.empty{border-left-color:transparent;}
        .kr-head{display:flex;gap:9px;align-items:flex-start;}
        .cb{width:16px;height:16px;border-radius:5px;flex-shrink:0;margin-top:1px;border:1.5px solid var(--navy-500);display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:var(--navy-900);background:transparent;cursor:pointer;padding:0;}
        .cb.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .kt{flex:1;font-size:13.5px;color:var(--navy-100);line-height:1.4;}
        .kr.done .kt{color:var(--navy-500);text-decoration:line-through;}
        .st{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-left:8px;white-space:nowrap;}
        .st.t-nominal{color:var(--nw-nominal-text);background:rgba(127,226,122,.1);}
        .st.t-alarm{color:var(--nw-alarm-text);background:rgba(255,100,82,.1);}
        .st.t-caution{color:var(--nw-caution-text);background:rgba(245,184,64,.1);}
        .st.t-standby{color:var(--nw-standby-text);background:var(--surface-2);}
        .kr-edit{background:none;border:none;color:var(--navy-600);font-size:11px;cursor:pointer;padding:2px 5px;border-radius:5px;flex-shrink:0;opacity:0;transition:opacity .12s;}
        .kr:hover .kr-edit{opacity:1;}
        .kr-edit:hover{color:var(--navy-100);background:var(--hover);}

        .acts{margin:7px 0 0 25px;display:flex;flex-direction:column;gap:1px;}
        .act{display:flex;align-items:center;gap:9px;padding:4px 0;}
        .cb-sm{width:13px;height:13px;border-radius:4px;flex-shrink:0;border:1.4px solid var(--navy-500);display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:var(--navy-900);background:transparent;cursor:pointer;padding:0;}
        .cb-sm.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .at{flex:1;font-size:12.5px;color:var(--navy-200);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .act.done .at{color:var(--navy-600);text-decoration:line-through;}
        .carried{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.04em;color:var(--nw-caution-text);background:rgba(245,184,64,.08);border-radius:4px;padding:1px 5px;flex-shrink:0;}
        .sched{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.03em;padding:2px 7px;border-radius:5px;flex-shrink:0;cursor:pointer;border:none;}
        .sched.week{color:var(--accent);background:var(--accent-dim);}
        .sched.promote{color:var(--navy-400);background:transparent;border:1px solid var(--line-2);}
        .sched.promote:hover{color:var(--accent);border-color:var(--accent);}
        .act-dur{font-family:var(--font-mono);font-size:9px;font-weight:600;padding:2px 7px;border-radius:5px;flex-shrink:0;cursor:pointer;border:1px solid var(--line-2);color:var(--navy-200);background:transparent;}
        .act-dur:hover{border-color:var(--navy-400);}
        .act-dur.set{color:var(--navy-200);}
        .act-dur:not(.set){color:var(--navy-500);border-style:dashed;}
        .act-dur.open{color:var(--accent);border-color:var(--accent);background:var(--accent-dim);}
        .act-durpick{display:flex;flex-wrap:wrap;gap:6px;margin:3px 0 5px 22px;}
        .act-durchip{font-family:var(--font-mono);font-size:9.5px;font-weight:600;padding:3px 9px;border-radius:6px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-300);cursor:pointer;}
        .act-durchip:hover{border-color:var(--accent);color:var(--accent);}
        .act-durchip.on{border-color:var(--accent);background:var(--accent-dim);color:var(--accent);}
        .act-durchip.clear{color:var(--navy-500);}
        .addact{font-family:var(--font-mono);font-size:9px;font-weight:600;color:var(--navy-600);border:1px dashed var(--line-2);border-radius:5px;padding:2px 8px;cursor:pointer;align-self:flex-start;margin-top:2px;background:none;}
        .addact:hover{color:var(--accent);border-color:var(--accent);}
        .act-input{margin-top:4px;width:90%;background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;padding:6px 9px;font-size:12px;color:var(--navy-50);font-family:inherit;outline:none;}
        .act-input:focus{border-color:var(--accent);}

        .log-e{display:flex;gap:9px;margin-bottom:6px;}
        .log-e:last-child{margin-bottom:0;}
        .wk{font-family:var(--font-mono);font-size:8.5px;font-weight:600;color:var(--nw-label);flex-shrink:0;margin-top:2px;min-width:34px;letter-spacing:.03em;}
        .log-t{font-size:12px;color:var(--navy-300);line-height:1.45;}
        .log-t b{color:var(--navy-100);font-weight:600;}
        .addlog{font-family:var(--font-mono);font-size:8.5px;font-weight:600;color:var(--navy-600);border:1px dashed var(--line-2);border-radius:5px;padding:2px 7px;cursor:pointer;background:none;}
        .kr:hover .addlog{color:var(--accent);border-color:var(--accent);}
        .log-input{width:100%;min-height:48px;background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;padding:7px 9px;font-size:12px;color:var(--navy-50);font-family:inherit;outline:none;resize:vertical;}
        .log-input:focus{border-color:var(--accent);}

        .grp-div{height:1px;background:var(--line);margin:2px 16px;}
        .krmini{display:flex;align-items:center;gap:10px;padding:7px 16px;border-top:1px solid var(--line);cursor:default;}
        .krmini:first-child{border-top:none;}
        .krmini:hover{background:rgba(255,255,255,.012);}
        .krmini .tag{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--navy-500);border:1px solid var(--line-2);border-radius:4px;padding:1px 5px;flex-shrink:0;}
        .krmini .mt{font-size:12.5px;color:var(--navy-300);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .krmini .read{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--navy-200);flex-shrink:0;}
        .krmini .read .u{color:var(--navy-500);font-weight:500;}

        @media (max-width:760px){
          .kr{flex-direction:column;}
          .kr-l{flex:1 1 auto;width:100%;padding-right:0;}
          .kr-r{width:100%;border-left:none;border-top:1px solid var(--line);padding-left:25px;margin-top:6px;padding-top:6px;}
          .kr-r.empty{border-top-color:transparent;}
        }
      `}</style>
    </div>
  )
}
