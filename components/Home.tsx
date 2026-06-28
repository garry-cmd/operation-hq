'use client'
import { useState, useMemo, useEffect, Fragment } from 'react'
import { shellOpen } from '@/lib/tauri'
import { TodoistIcon, EvernoteNotebookIcon, DriveFolderIcon, EvernoteNoteIcon, DriveFileIcon, LinkIcon } from './Icons'
import type { Dispatch, SetStateAction, ReactNode, CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type {
  Space, AnnualObjective, RoadmapItem, WeeklyAction, MetricCheckin,
  HabitCheckin, Note, Notebook, TrackedFile, WeeklyReview, ObjectiveLog,
} from '@/lib/types'
import { getMonday, addWeeks, parseDateLocal, ACTIVE_Q, formatMinutes } from '@/lib/utils'
import { getMetricKRs } from '@/lib/krFilters'
import { calculateRollingAggregate, parseHabitPattern } from '@/lib/habitUtils'
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
  failed:      { cls: 't-failed',  label: 'failed' },
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
// Parse "<n>Q<year>" → quarter start/end dates (local midnight).
function quarterBounds(q: string): { start: Date; end: Date } | null {
  const m = /^([1-4])Q(\d{4})$/.exec(q)
  if (!m) return null
  const n = +m[1], y = +m[2]
  return { start: new Date(y, (n - 1) * 3, 1), end: new Date(y, n * 3, 0) }
}
// Pace chip from progress% vs time-elapsed% (±8 pts = on pace; >20 behind = late).
function paceChip(progress: number, elapsed: number): { cls: string; txt: string } {
  if (progress >= 100) return { cls: 'done', txt: 'complete' }
  const d = progress - elapsed
  if (d >= 8) return { cls: 'ahead', txt: `ahead +${Math.round(d)}` }
  if (d <= -8) { const amt = Math.round(-d); return { cls: amt > 20 ? 'late' : 'behind', txt: `behind ${amt}` } }
  return { cls: 'onpace', txt: 'on pace' }
}
function loadLS<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try { const v = window.localStorage.getItem(key); return v == null ? fallback : (JSON.parse(v) as T) } catch { return fallback }
}

// Estimated-duration buckets for action items (multi-hour project pieces).
const ACTION_DURATIONS = [30, 60, 90, 120, 180, 240]

// Selectable KR statuses for the inline status menu.
const STATUS_OPTS: { v: RoadmapItem['health_status']; l: string }[] = [
  { v: 'on_track', l: 'On track' },
  { v: 'off_track', l: 'Off track' },
  { v: 'blocked', l: 'Blocked' },
  { v: 'waiting', l: 'Waiting' },
  { v: 'backlog', l: 'Backlog' },
  { v: 'done', l: 'Done' },
  { v: 'failed', l: 'Failed' },
]

interface Props {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  setActions: Dispatch<SetStateAction<WeeklyAction[]>>
  metricCheckins: MetricCheckin[]
  habitCheckins: HabitCheckin[]
  setHabitCheckins: (fn: (h: HabitCheckin[]) => HabitCheckin[]) => void
  notes: Note[]
  setNotes: Dispatch<SetStateAction<Note[]>>
  notebooks: Notebook[]
  tagsByNote: Map<string, string[]>
  setTagsByNote: Dispatch<SetStateAction<Map<string, string[]>>>
  driveGranted: boolean
  trackedFiles: TrackedFile[]
  setTrackedFiles: Dispatch<SetStateAction<TrackedFile[]>>
  reviews: WeeklyReview[]
  weekForSpace: (spaceId: string) => string
  onCloseWeek: (spaceId: string, week: string) => void
  onOpenNote: (noteId: string) => void
  onLogMetric: (krId: string) => void
  setObjectives: Dispatch<SetStateAction<AnnualObjective[]>>
  setRoadmapItems: Dispatch<SetStateAction<RoadmapItem[]>>
  onOpenObjective: (objectiveId: string) => void
  links: import('@/lib/types').ObjectiveLink[]
  logs: ObjectiveLog[]
  setLogs: Dispatch<SetStateAction<ObjectiveLog[]>>
  initialKRId?: string | null
  onConsumeInitialKRId?: () => void
  onQuarterClose?: (quarter: string, spaceId: string | null) => void
  quarterReviews?: import('@/lib/db/quarterReviews').QuarterReview[]
  toast: (m: string) => void
}

export default function Home({
  spaces, objectives, roadmapItems, actions, setActions,
  metricCheckins, habitCheckins, setHabitCheckins,
  reviews, weekForSpace, onCloseWeek, onLogMetric,
  setObjectives, setRoadmapItems, onOpenObjective,
  links,
  logs, setLogs, initialKRId, onConsumeInitialKRId, onQuarterClose, quarterReviews = [], toast,
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadLS<Record<string, boolean>>('hq-home-obj-collapsed', {}))
  const toggleCollapse = (id: string) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  const [durPickerAction, setDurPickerAction] = useState<string | null>(null)
  // Section collapse — all start collapsed so everything fits on one page
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const [focusOpen, setFocusOpen] = useState(false)
  const [objectivesOpen, setObjectivesOpen] = useState(false)

  const [addActionObj, setAddActionObj] = useState<string | null>(null)
  const [actionKRSel, setActionKRSel] = useState<string>('')
  const [actionDraft, setActionDraft] = useState('')

  const [logComposer, setLogComposer] = useState<{ krId: string; objId: string } | null>(null)
  const [logDraft, setLogDraft] = useState('')
  const [flippedM, setFlippedM] = useState<Record<string, boolean>>({})
  const toggleFlip = (id: string) => setFlippedM(p => ({ ...p, [id]: !p[id] }))
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({})
  const toggleLogs = (id: string) => {
    const willOpen = !openLogs[id]
    setOpenLogs(p => ({ ...p, [id]: willOpen }))
    // collapsing must also tear down an open composer, or (logsOpen||composing) keeps it visible
    if (!willOpen && logComposer?.krId === id) { setLogComposer(null); setLogDraft('') }
  }
  // Tracks which prior-week groups are expanded inside a KR log panel.
  // Key = `${krId}::${weekMonday}`. Current week is always open; prior weeks default collapsed.
  const [openKrWeekGroups, setOpenKrWeekGroups] = useState<Record<string, boolean>>({})
  const toggleKrWeekGroup = (krId: string, wk: string) =>
    setOpenKrWeekGroups(p => ({ ...p, [`${krId}::${wk}`]: !p[`${krId}::${wk}`] }))
  const [krMenu, setKrMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const openKrMenu = (e: ReactMouseEvent, id: string) => {
    if (krMenu?.id === id) { setKrMenu(null); return }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setKrMenu({ id, x: r.right, y: r.bottom })
  }
  // Focus-this-week band + per-action update thread
  const [hideFocusDone, setHideFocusDone] = useState<boolean>(() => loadLS<boolean>('hq-home-hide-focus-done', false))
  const [openActLogs, setOpenActLogs] = useState<Record<string, boolean>>({})
  const [actComposer, setActComposer] = useState<{ actionId: string; objId: string } | null>(null)
  const [actDraft, setActDraft] = useState('')
  const toggleActLogs = (id: string) => {
    const willOpen = !openActLogs[id]
    setOpenActLogs(p => ({ ...p, [id]: willOpen }))
    if (!willOpen && actComposer?.actionId === id) { setActComposer(null); setActDraft('') }
  }

  const todayStr = ymd(new Date())
  const isCurrentWeek = weekMonday === getMonday()
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateForDow(weekMonday, i)), [weekMonday])
  const [quote] = useState(() => randomQuote())

  // When ACTIVE_Q is sealed, advance the display quarter so metrics/habits/header
  // show the planning quarter rather than the closed one.
  const activeQSealed = useMemo(() =>
    quarterReviews.some(qr => qr.quarter === ACTIVE_Q && qr.closed_at != null),
    [quarterReviews])

  const displayQ = useMemo(() => {
    if (!activeQSealed) return ACTIVE_Q
    const m = ACTIVE_Q.match(/^([1-4])Q(\d{4})$/)
    if (!m) return ACTIVE_Q
    let q = +m[1], y = +m[2]
    q++; if (q > 4) { q = 1; y++ }
    return `${q}Q${y}`
  }, [activeQSealed])

  // Show "Close Quarter" CTA in the last 3 weeks of the quarter (or after quarter end),
  // but only if the active quarter hasn't been sealed already.
  const showQuarterCloseCTA = useMemo(() => {
    const qb = quarterBounds(ACTIVE_Q)
    if (!qb) return false
    const today = parseDateLocal(todayStr)
    const daysLeft = (qb.end.getTime() - today.getTime()) / 864e5
    if (daysLeft > 21) return false  // not close enough yet
    return !activeQSealed
  }, [todayStr, activeQSealed])

  useEffect(() => { try { window.localStorage.setItem('hq-home-space-filter', JSON.stringify(spaceFilter)) } catch {} }, [spaceFilter])
  useEffect(() => { try { window.localStorage.setItem('hq-home-hide-focus-done', JSON.stringify(hideFocusDone)) } catch {} }, [hideFocusDone])
  useEffect(() => { try { window.localStorage.setItem('hq-home-qtr-scope', JSON.stringify(quarterScope)) } catch {} }, [quarterScope])
  useEffect(() => { try { window.localStorage.setItem('hq-home-obj-collapsed', JSON.stringify(collapsed)) } catch {} }, [collapsed])

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
    () => getMetricKRs(roadmapItems, displayQ).filter(k => spaceFilter === null || k.space_id === spaceFilter),
    [roadmapItems, spaceFilter],
  )

  // ── habits: KR × this-week 7-day grid ──
  const habitKRs = useMemo(() =>
    roadmapItems.filter(k => k.is_habit && !k.is_parked && k.health_status !== 'done'
      && k.quarter === displayQ
      && (spaceFilter === null || k.space_id === spaceFilter)),
    [roadmapItems, spaceFilter, displayQ])

  // When the active quarter is sealed, clamp habit checkins to the new quarter's
  // start so the rolling aggregate shows 3Q progress only (not 2Q carryover).
  const displayQStart = useMemo(() => {
    const m = displayQ.match(/^([1-4])Q(\d{4})$/)
    if (!m) return null
    return new Date(+m[2], (+m[1] - 1) * 3, 1)
  }, [displayQ])

  const displayQHabitCheckins = useMemo(() => {
    if (!activeQSealed || !displayQStart) return habitCheckins
    const startStr = displayQStart.toISOString().slice(0, 10)
    return habitCheckins.filter(c => c.date >= startStr)
  }, [habitCheckins, activeQSealed, displayQStart])
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

  // ── logs grouped by KR, then by week (for the grouped panel in renderObjCard) ──
  const logsByKRGrouped = useMemo(() => {
    // Returns Map<krId, Array<{ weekMonday: string; logs: ObjectiveLog[] }>> newest-first
    const m = new Map<string, Map<string, ObjectiveLog[]>>()
    for (const l of logs) {
      if (!l.roadmap_item_id || l.weekly_action_id) continue  // skip action-scoped logs
      const wk = getMonday(parseDateLocal(l.log_date ?? l.created_at))
      const byKR = m.get(l.roadmap_item_id) ?? new Map<string, ObjectiveLog[]>()
      const byWk = byKR.get(wk) ?? []
      byWk.push(l)
      byKR.set(wk, byWk)
      m.set(l.roadmap_item_id, byKR)
    }
    // Sort each week's entries newest-first; return weeks newest-first
    const result = new Map<string, { weekMonday: string; logs: ObjectiveLog[] }[]>()
    for (const [krId, byWk] of m) {
      const weeks = [...byWk.entries()]
        .map(([wk, ls]) => ({ weekMonday: wk, logs: ls.sort((a, b) => (b.log_date ?? '').localeCompare(a.log_date ?? '')) }))
        .sort((a, b) => b.weekMonday.localeCompare(a.weekMonday))
      result.set(krId, weeks)
    }
    return result
  }, [logs])

  // ── logs grouped by action (per-action update thread) ──
  const logsByAction = useMemo(() => {
    const m = new Map<string, ObjectiveLog[]>()
    for (const l of logs) {
      if (!l.weekly_action_id) continue
      const a = m.get(l.weekly_action_id) ?? []; a.push(l); m.set(l.weekly_action_id, a)
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
            && (quarterScope === 'all' || k.quarter === displayQ))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        const actsFor = (kr: RoadmapItem) => ({
          thisWeek: actions.filter(a => a.roadmap_item_id === kr.id && a.week_start === weekMonday),
          backlog: actions.filter(a => a.roadmap_item_id === kr.id && a.week_start == null && !a.completed),
        })
        const hasWork = (kr: RoadmapItem) => {
          const w = actsFor(kr); return w.thisWeek.length > 0 || w.backlog.length > 0
        }
        // Deliverable KRs always show as full rows; habit/metric KRs only get a
        // full row when they carry scheduled work — otherwise a slim mini.
        // Done KRs are excluded from full rows (they've been completed).
        const activeKRs = allKRs.filter(k => k.health_status !== 'done' && k.health_status !== 'failed')
        const fullKRs = activeKRs.filter(k => (!k.is_habit && !k.is_metric) || hasWork(k))
        const miniKRs = activeKRs.filter(k => (k.is_habit || k.is_metric) && !hasWork(k))
        // Objective-level action list — only for active (non-done) KRs.
        const activeKRIds = new Set(activeKRs.map(k => k.id))
        const tag = (a: WeeklyAction) => ({ a, kr: allKRs.find(k => k.id === a.roadmap_item_id) ?? null })
        const actThisWeek = actions.filter(a => activeKRIds.has(a.roadmap_item_id) && a.week_start === weekMonday).map(tag)
        const actBacklog = actions.filter(a => activeKRIds.has(a.roadmap_item_id) && a.week_start == null && !a.completed).map(tag)
        const total = allKRs.length
        const done = allKRs.filter(k => k.health_status === 'done' || k.health_status === 'failed').length
        const onN = allKRs.filter(k => k.health_status === 'on_track').length
        const offN = allKRs.filter(k => k.health_status === 'off_track' || k.health_status === 'blocked').length
        const thisWkActs = actThisWeek.filter(x => !x.a.completed).length
        const carriedN = actThisWeek.filter(x => !x.a.completed && (carriedByKey.get(`${x.a.roadmap_item_id}::${x.a.title}`) ?? 0) > 0).length
        return { obj: o, fullKRs, miniKRs, allKRs, actThisWeek, actBacklog, total, done, onN, offN, thisWkActs, carriedN }
      })
      .filter(g => g.fullKRs.length > 0 || g.miniKRs.length > 0)
  }, [objectives, roadmapItems, actions, weekMonday, spaceFilter, quarterScope, carriedByKey])

  // ── Focus this week: every this-week action across objectives, grouped by space ──
  const focusBySpace = useMemo(() => {
    const rows = actions
      .filter(a => a.week_start === weekMonday && a.roadmap_item_id)
      .map(a => {
        const kr = roadmapItems.find(k => k.id === a.roadmap_item_id) ?? null
        const sp = kr?.space_id ? spaceById.get(kr.space_id) ?? null : null
        return { a, kr, sp }
      })
      .filter((r): r is { a: WeeklyAction; kr: RoadmapItem; sp: Space } =>
        r.kr != null && r.sp != null && (spaceFilter === null || r.sp.id === spaceFilter))
    const m = new Map<string, { sp: Space; items: { a: WeeklyAction; kr: RoadmapItem; sp: Space }[] }>()
    for (const r of rows) {
      const g = m.get(r.sp.id) ?? { sp: r.sp, items: [] }
      g.items.push(r); m.set(r.sp.id, g)
    }
    const groups = [...m.values()].sort((a, b) => a.sp.sort_order - b.sp.sort_order)
    for (const g of groups) g.items.sort((x, y) => (x.a.completed ? 1 : 0) - (y.a.completed ? 1 : 0))
    return groups
  }, [actions, weekMonday, roadmapItems, spaceById, spaceFilter])
  const focusTotal = focusBySpace.reduce((n, g) => n + g.items.length, 0)
  const focusDone = focusBySpace.reduce((n, g) => n + g.items.filter(i => i.a.completed).length, 0)

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
  async function submitObjAction() {
    const t = actionDraft.trim(); const krId = actionKRSel
    if (!t || !krId) return
    try {
      const created = await actionsDb.create({ roadmap_item_id: krId, title: t, week_start: weekMonday })
      setActions(prev => [...prev, created]); setActionDraft(''); setAddActionObj(null)
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
  async function setKRStatus(kr: RoadmapItem, status: RoadmapItem['health_status']) {
    setKrMenu(null)
    if (kr.health_status === status) return
    setRoadmapItems(prev => prev.map(k => k.id === kr.id ? { ...k, health_status: status } : k))
    try { await krsDb.update(kr.id, { health_status: status }) }
    catch { toast('Could not update status'); setRoadmapItems(prev => prev.map(k => k.id === kr.id ? kr : k)) }
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
  async function submitActLog() {
    const c = actComposer; const body = actDraft.trim()
    if (!c || !body) { setActComposer(null); setActDraft(''); return }
    try {
      const created = await extrasDb.logs.create({
        objective_id: c.objId, weekly_action_id: c.actionId, content: body, log_date: todayStr,
      })
      setLogs(prev => [created, ...prev]); setActDraft(''); setActComposer(null)
    } catch { toast('Could not save update') }
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

  async function deleteAction(a: WeeklyAction) {
    setActions(prev => prev.filter(x => x.id !== a.id))
    try { await actionsDb.remove(a.id) }
    catch { toast('Could not delete action'); setActions(prev => [...prev, a]) }
  }
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
  function colActionRow(item: { a: WeeklyAction; kr: RoadmapItem | null }, scheduled: boolean) {
    const { a, kr } = item
    const carried = scheduled && !a.completed ? carriedFor(a) : 0
    const objId = kr?.annual_objective_id
    const aLogs = logsByAction.get(a.id) ?? []
    const open = !!openActLogs[a.id]
    const composing = actComposer?.actionId === a.id
    return (
      <Fragment key={a.id}>
        <div className={`act${a.completed ? ' done' : ''}`}>
          <button className={`cb-sm${a.completed ? ' on' : ''}`} onClick={() => toggleAction(a)} title={a.completed ? 'Mark not done' : 'Mark done'}>{a.completed ? '✓' : ''}</button>
          <span className="at">{a.title}</span>
          {kr && <span className="krtag" title={kr.title}><span className="kd" />{kr.title}</span>}
          <div className="ameta">
            {carried > 0 && <span className="carried" title={`Scheduled ${carried} prior week${carried > 1 ? 's' : ''}, still open`}>{carried} wk{carried > 1 ? 's' : ''}</span>}
            {scheduled
              ? <button className="sched week" title="Move to backlog" onClick={() => scheduleAction(a, null)}>this wk</button>
              : <button className="sched back" title="Schedule this week" onClick={() => scheduleAction(a, weekMonday)}>backlog</button>}
            {durBadge(a)}
            <button className={`flogchip${open ? ' open' : ''}${aLogs.length ? ' has' : ''}`} onClick={() => toggleActLogs(a.id)} title={open ? 'Hide updates' : 'Updates'}>
              <span className="lcar">▸</span>{aLogs.length ? aLogs.length : 'note'}
            </button>
            <button className="act-del" title="Delete action" onClick={() => deleteAction(a)}>×</button>
          </div>
        </div>
        {durPicker(a)}
        {open && (
          <div className="flogs">
            {aLogs.map(l => (
              <div key={l.id} className="logline"><span className="d">{(l.log_date ?? '').slice(5)}</span><span className="t">{l.content}</span></div>
            ))}
            {composing ? (
              <textarea className="log-input" autoFocus value={actDraft} placeholder="Update on this action… (⌘↵ to save)"
                onChange={e => setActDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitActLog(); if (e.key === 'Escape') { setActComposer(null); setActDraft('') } }}
                onBlur={submitActLog} />
            ) : objId ? (
              <button className="addlog" onClick={() => setActComposer({ actionId: a.id, objId })}>＋ add update</button>
            ) : null}
          </div>
        )}
      </Fragment>
    )
  }

  // One row in the Focus-this-week band: checkbox · title · carried · KR tag ·
  // an inline update thread (objective_logs scoped to this action via weekly_action_id).
  function focusRow(r: { a: WeeklyAction; kr: RoadmapItem; sp: Space }) {
    const { a, kr } = r
    const objId = kr.annual_objective_id
    const carried = !a.completed ? carriedFor(a) : 0
    const aLogs = logsByAction.get(a.id) ?? []
    const open = !!openActLogs[a.id]
    const composing = actComposer?.actionId === a.id
    return (
      <Fragment key={a.id}>
        <div className={`frow${a.completed ? ' done' : ''}`}>
          <button className={`fcb${a.completed ? ' on' : ''}`} onClick={() => toggleAction(a)} title={a.completed ? 'Mark not done' : 'Mark done'}>{a.completed ? '✓' : ''}</button>
          <span className="ftitle">{a.title}</span>
          {carried > 0 && <span className="fcarried" title={`Carried ${carried} week${carried > 1 ? 's' : ''}`}>carried</span>}
          <div className="frow-actions">
            <span className="fkrtag" title={kr.title}><span className="kd" />{kr.title}</span>
            <button className="sched back" title="Move to backlog" onClick={() => scheduleAction(a, null)}>backlog</button>
            <button className={`flogchip${open ? ' open' : ''}${aLogs.length ? ' has' : ''}`} onClick={() => toggleActLogs(a.id)} title={open ? 'Hide updates' : 'Updates'}>
              <span className="lcar">▸</span>{aLogs.length ? aLogs.length : 'note'}
            </button>
            <button className="act-del" title="Delete action" onClick={() => deleteAction(a)}>×</button>
          </div>
        </div>
        {open && (
          <div className="flogs">
            {aLogs.map(l => (
              <div key={l.id} className="logline"><span className="d">{(l.log_date ?? '').slice(5)}</span><span className="t">{l.content}</span></div>
            ))}
            {composing ? (
              <textarea className="log-input" autoFocus value={actDraft} placeholder="Update on this action… (⌘↵ to save)"
                onChange={e => setActDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitActLog(); if (e.key === 'Escape') { setActComposer(null); setActDraft('') } }}
                onBlur={submitActLog} />
            ) : objId ? (
              <button className="addlog" onClick={() => setActComposer({ actionId: a.id, objId })}>＋ add update</button>
            ) : null}
          </div>
        )}
      </Fragment>
    )
  }
  function sparkPoints(vals: number[]): string {
    if (vals.length < 2) return ''
    const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
    return vals.map((v, i) => {
      const x = 2 + i * (96 / (vals.length - 1))
      const y = 26 - ((v - min) / range) * 24
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }
  function metricCard(kr: RoadmapItem) {
    const ck = metricCheckins
      .filter(c => c.roadmap_item_id === kr.id && c.value != null)
      .sort((a, b) => (a.week_start ?? '').localeCompare(b.week_start ?? ''))
    const vals = ck.map(c => Number(c.value)).filter(v => isFinite(v))
    const latest = vals.length ? vals[vals.length - 1] : null
    const prev = vals.length > 1 ? vals[vals.length - 2] : null
    const unit = kr.metric_unit ?? ''
    const target = kr.target_value == null ? null : Number(kr.target_value)
    const dir = kr.metric_direction === 'down' ? 'down' : 'up'
    const hit = latest != null && target != null && (dir === 'up' ? latest >= target : latest <= target)
    const improving = latest != null && prev != null && (dir === 'up' ? latest > prev : latest < prev)
    const tone = latest == null ? 'flat' : (hit || improving) ? 'up' : prev == null ? 'flat' : 'down'
    const stroke = tone === 'up' ? '#7fe27a' : tone === 'down' ? '#f5b840' : 'var(--navy-500)'
    const pts = sparkPoints(vals)
    const gid = `sp-${kr.id.slice(0, 8)}`
    const delta = latest != null && prev != null ? latest - prev : null
    const flipped = !!flippedM[kr.id]
    // required run-rate to hit target by the KR's end (own end_date, else quarter end)
    const rqb = quarterBounds(ACTIVE_Q)
    const rEnd = kr.end_date ? parseDateLocal(kr.end_date) : rqb?.end ?? null
    let rate: { cls: string; txt: string } | null = null
    if (target != null && latest != null && rEnd) {
      const weeksLeft = Math.max(0, (rEnd.getTime() - parseDateLocal(todayStr).getTime()) / (7 * 864e5))
      const remaining = dir === 'up' ? target - latest : latest - target
      if (remaining <= 0) rate = { cls: 'met', txt: 'target met · hold' }
      else if (weeksLeft < 0.15) rate = { cls: 'urgent', txt: `${fmtMetric(remaining, unit)} short — window closed` }
      else {
        const r = Math.round((remaining / weeksLeft) * 10) / 10
        rate = { cls: weeksLeft < 2 ? 'urgent' : 'ok', txt: `need ${dir === 'up' ? '+' : '−'}${fmtMetric(r, unit)}/wk` }
      }
    }
    // readings, newest first, with Δ vs the prior reading
    const readings = ck.map((c, i) => {
      const v = Number(c.value)
      const p = i > 0 ? Number(ck[i - 1].value) : null
      return { date: (c.week_start ?? '').slice(5), val: v, delta: p == null ? null : v - p }
    }).reverse()
    return (
      <div key={kr.id} className={`mcard${flipped ? ' flipped' : ''}`}>
        <div className="m-inner">
          <div className="m-face" onClick={() => toggleFlip(kr.id)} title="Show readings">
            <h4>{kr.title}</h4>
            <div className="mval">
              <b>{latest == null ? '—' : fmtMetric(latest, unit)}</b>
              {target != null && <span className="ghost">/ {fmtMetric(target, unit)}</span>}
            </div>
            {rate && <div className={`rate ${rate.cls}`}>{rate.txt}</div>}
            <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none">
              {pts ? (
                <>
                  <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={stroke} stopOpacity="0.26" /><stop offset="1" stopColor={stroke} stopOpacity="0" />
                  </linearGradient></defs>
                  <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  <polygon points={`${pts} 98,30 2,30`} fill={`url(#${gid})`} />
                </>
              ) : (
                <line x1="2" y1="25" x2="98" y2="25" stroke="var(--navy-600)" strokeWidth="1.4" strokeDasharray="2 3" />
              )}
            </svg>
            <div className="mfoot">
              <span className={`delta ${tone}`}>{
                latest == null ? 'no readings' :
                tone === 'up' ? (hit ? '▲ on/above target' : '▲ improving') :
                tone === 'down' ? `▼ ${delta != null ? Math.abs(delta).toLocaleString() + ' last reading' : 'off target'}` :
                'no movement yet'
              }</span>
              <span className="flipnote">tap → readings</span>
            </div>
          </div>
          <div className="m-face m-back">
            <div className="bh"><h4>{kr.title}</h4><button className="back" onClick={() => toggleFlip(kr.id)}>↩ back</button></div>
            <div className="readings">
              {readings.length === 0 ? <div className="rd-empty">No readings yet.</div> : readings.map((r, i) => (
                <div key={i} className="rd">
                  <span className="rdate">{r.date}</span>
                  <span className="rval">{fmtMetric(r.val, unit)}</span>
                  {r.delta != null && r.delta !== 0 && (
                    <span className={`rdelta${(dir === 'up' ? r.delta > 0 : r.delta < 0) ? '' : ' dn'}`}>
                      {r.delta > 0 ? '+' : '−'}{Math.abs(r.delta).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <button className="logbtn" onClick={() => onLogMetric(kr.id)}>+ Log reading</button>
          </div>
        </div>
      </div>
    )
  }

  // One habit KR as a flip card: front = 4-week % + trend; back = this week's
  // 7-day check-off (replaces the old far-right dot-rail). Reuses flippedM.
  function habitCard(kr: RoadmapItem) {
    const agg = calculateRollingAggregate(kr, displayQHabitCheckins, 4)
    const priorEnd = new Date(); priorEnd.setDate(priorEnd.getDate() - 28)
    const prior = calculateRollingAggregate(kr, displayQHabitCheckins, 4, priorEnd)
    const tone = agg.sessions === 0 ? 'standby'
      : agg.percent >= 80 ? 'nominal'
      : agg.percent >= 50 ? 'caution'
      : 'alarm'
    // pts delta vs the prior 4-week window; null when nothing logged either side
    const trend = (agg.sessions === 0 && prior.sessions === 0) ? null : agg.percent - prior.percent
    const pat = parseHabitPattern(kr.title)
    const cadence = pat.mode === 'daily' ? 'daily'
      : pat.mode === 'weekly_count' ? `${pat.target || 1}×/wk`
      : pat.mode === 'weekly_percentage' ? `${pat.target || 0}%/wk`
      : pat.mode === 'monthly_count' ? `${pat.target || 0}/mo` : ''
    const wkTarget = pat.mode === 'daily' ? 7
      : pat.mode === 'weekly_count' ? (pat.target || null)
      : pat.mode === 'weekly_percentage' ? Math.round(((pat.target || 0) / 100) * 7)
      : null
    const wkDone = weekDates.filter(d => checkinSet.has(`${kr.id}:${d}`)).length
    const wkLabel = wkTarget != null ? `${wkDone} / ${wkTarget}` : `${wkDone}`
    const flipped = !!flippedM[kr.id]
    return (
      <div key={kr.id} className={`hcard t-${tone}${flipped ? ' flipped' : ''}`}>
        <div className="h-inner">
          <div className="h-face" onClick={() => toggleFlip(kr.id)} title="Tap to check off this week">
            <h4>{kr.title}</h4>
            <div className="hero-row">
              <span className="hero">{agg.percent}<small>%</small></span>
              {trend != null && (
                trend > 0
                  ? <span className="trend up" title="vs previous 4 weeks">▲ {trend} pts</span>
                  : trend < 0
                    ? <span className="trend down" title="vs previous 4 weeks">▼ {Math.abs(trend)} pts</span>
                    : <span className="trend flat" title="vs previous 4 weeks">steady</span>
              )}
            </div>
            <div className="hsub">{agg.sessions} / {agg.expected} · {cadence}</div>
            <div className="hf-foot">
              <span className="wkcount">{wkLabel} this wk</span>
              <span className="flipnote">tap → check off</span>
            </div>
          </div>
          <div className="h-face h-back">
            <div className="bh"><h4>{kr.title}</h4><button className="back" onClick={() => toggleFlip(kr.id)}>↩ back</button></div>
            <div className="bcount">{wkLabel} this week</div>
            <div className="daygrid">
              {weekDates.map((d, i) => {
                const isOn = checkinSet.has(`${kr.id}:${d}`)
                return (
                  <div key={d} className={`day${d === todayStr ? ' today' : ''}`}>
                    <span className="dl">{DOW[i]}</span>
                    <button className={`dd${isOn ? ' on' : ''}`} title={`${DOW[i]} · ${d}`} onClick={() => toggleHabit(kr.id, d)} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // One objective card (collapsed pill-row, or expanded rail | KRs | actions).
  function renderObjCard(g: typeof board[number]) {
    const { obj, fullKRs, miniKRs, allKRs, actThisWeek, actBacklog, total, done, onN, offN, thisWkActs, carriedN } = g
    const pct = total ? Math.round((done / total) * 100) : 0
    const oc = obj.space_id ? spaceDisplayColor(spaceById.get(obj.space_id)!) : 'var(--navy-500)'
    const isCol = !!collapsed[obj.id]
    // pacing: progress% vs time-elapsed in the objective's window (own dates, else active quarter)
    const qb = quarterBounds(ACTIVE_Q)
    const winStart = obj.start_date ? parseDateLocal(obj.start_date) : qb?.start ?? null
    const winEnd = obj.end_date ? parseDateLocal(obj.end_date) : qb?.end ?? null
    let pace: { cls: string; txt: string; elapsed: number } | null = null
    if (total > 0 && winStart && winEnd && winEnd.getTime() > winStart.getTime()) {
      const now = parseDateLocal(todayStr).getTime()
      const e = Math.max(0, Math.min(1, (now - winStart.getTime()) / (winEnd.getTime() - winStart.getTime())))
      const elapsed = Math.round(e * 100)
      pace = { ...paceChip(pct, elapsed), elapsed }
    }
    const pillEls = (
      <div className="pills">
        {done > 0 && <span className="opill done">{done} done</span>}
        {onN > 0 && <span className="opill on">{onN} on track</span>}
        {offN > 0 && <span className="opill off">{offN} off track</span>}
        {thisWkActs > 0 && <span className="opill wk">{thisWkActs} this wk</span>}
        {carriedN > 0 && <span className="opill carried">{carriedN} carried</span>}
      </div>
    )
    if (isCol) {
      return (
        <div key={obj.id} className="ocard" style={{ ['--oc']: oc } as CSSProperties}>
          <div className="col-row" onClick={() => toggleCollapse(obj.id)}>
            <span className="chev">▸</span>
            <span className="col-name">{obj.name}</span>
            <div className="prog-inline"><span className="prog-num">{pct}%</span><span className="prog-bar"><i style={{ width: `${pct}%` }} />{pace && <span className="pm" style={{ left: `${pace.elapsed}%` }} />}</span>{pace && <span className={`pacechip ${pace.cls}`} title={`ideal pace ${pace.elapsed}% of the window`}>{pace.txt}</span>}</div>
            {pillEls}
            <button className="ohb" title="Links & log" onClick={e => { e.stopPropagation(); onOpenObjective(obj.id) }}>⋯</button>
            <button className="ohb" title="Edit objective" onClick={e => { e.stopPropagation(); setEditingObjective(obj) }}>✎</button>
          </div>
        </div>
      )
    }
    const showActCol = actThisWeek.length > 0 || actBacklog.length > 0 || addActionObj === obj.id
    const addBtn = (
      <button className="addact" onClick={() => { setAddActionObj(obj.id); setActionKRSel(allKRs[0]?.id ?? ''); setActionDraft('') }}>+ action</button>
    )
    const addRow = addActionObj === obj.id ? (
      <div className="addrow">
        <select className="kr-sel" value={actionKRSel} onChange={e => setActionKRSel(e.target.value)}>
          {allKRs.map(k => <option key={k.id} value={k.id}>{k.title}</option>)}
        </select>
        <input className="act-input" autoFocus value={actionDraft} placeholder="New action…"
          onChange={e => setActionDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitObjAction(); if (e.key === 'Escape') { setAddActionObj(null); setActionDraft('') } }}
          onBlur={() => { if (!actionDraft.trim()) setAddActionObj(null) }} />
      </div>
    ) : null
    return (
      <div key={obj.id} className="ocard" style={{ ['--oc']: oc } as CSSProperties}>
        <div className="exp">
          <div className="rail">
            <div className="rail-top">
              <span className="chev" onClick={() => toggleCollapse(obj.id)} title="Collapse">▾</span>
              <h3>{obj.name}</h3>
            </div>
            <div className="prog">
              <div className="num">{pct}<small>%</small></div>
              <div className="track"><i style={{ width: `${pct}%` }} />{pace && <span className="pm" style={{ left: `${pace.elapsed}%` }} />}</div>
              <div className="sub">{done} of {total} KRs done{pace ? ` · ideal ${pace.elapsed}%` : ''}</div>
              {pace && <span className={`pacechip ${pace.cls}`} style={{ marginTop: 7, display: 'inline-block' }}>{pace.txt}</span>}
            </div>
            {pillEls}
            <ObjResources
              objId={obj.id}
              links={links.filter(l => l.objective_id === obj.id)}
              onManage={() => onOpenObjective(obj.id)}
            />
            <div className="rail-acts">
              <button className="ohb" title="Links & objective log" onClick={() => onOpenObjective(obj.id)}>⋯</button>
              <button className="ohb" title="Edit objective" onClick={() => setEditingObjective(obj)}>✎</button>
            </div>
          </div>

          <div className="kr-col">
            {fullKRs.map(kr => {
              const tone = healthTone(kr.health_status)
              const isDone = kr.health_status === 'done'
              const krLogs = logsByKR.get(kr.id) ?? []
              const composing = logComposer?.krId === kr.id
              const logsOpen = !!openLogs[kr.id]
              let metricChip: ReactNode = null
              if (kr.is_metric) {
                const c = latestMetricByKR.get(kr.id)
                const d = kr.metric_direction === 'down' ? '↓' : '↑'
                metricChip = <span className="st metricv">{fmtMetric(c?.value, kr.metric_unit)} {d}</span>
              }
              return (
                <div key={kr.id} className={`kr${isDone ? ' done' : ''}`}>
                  <div className="kr-head">
                    <button className={`cb${isDone ? ' on' : ''}`} onClick={() => toggleKRDone(kr)} title={isDone ? 'Mark not done' : 'Mark done'}>{isDone ? '✓' : ''}</button>
                    <span className="kt">{kr.title}{metricChip}</span>
                    <button className={`st ${tone.cls} clk`} title="Change status" onClick={e => openKrMenu(e, kr.id)}>{tone.label}</button>
                    {(() => {
                      const thisWk = getMonday()
                      const grouped = logsByKRGrouped.get(kr.id) ?? []
                      const thisWkCount = grouped.find(g => g.weekMonday === thisWk)?.logs.length ?? 0
                      const totalCount = grouped.reduce((n, g) => n + g.logs.length, 0)
                      if (totalCount === 0) {
                        // No logs at all — always-visible quiet prompt
                        return (
                          <button className="upd-prompt" title="Add this week's update"
                            onClick={() => { setLogComposer({ krId: kr.id, objId: obj.id }); setLogDraft(''); setOpenLogs(p => ({ ...p, [kr.id]: true })); setKrMenu(null) }}>
                            ＋ this week
                          </button>
                        )
                      }
                      if (thisWkCount > 0) {
                        // Has update this week → accent badge
                        return (
                          <button className={`upd-badge${logsOpen ? ' open' : ''}`} title={logsOpen ? 'Hide updates' : 'Show updates'}
                            onClick={() => toggleLogs(kr.id)}>
                            <span className="lcar">▸</span>{thisWkCount} this week
                          </button>
                        )
                      }
                      // Has prior logs but not this week → quiet prompt + old log count
                      return (
                        <>
                          <button className={`logchip${logsOpen ? ' open' : ''}`} onClick={() => toggleLogs(kr.id)} title={logsOpen ? 'Hide logs' : 'Show logs'}>
                            <span className="lcar">▸</span>{totalCount} log{totalCount > 1 ? 's' : ''}
                          </button>
                          <button className="upd-prompt" title="Add this week's update"
                            onClick={() => { setLogComposer({ krId: kr.id, objId: obj.id }); setLogDraft(''); setOpenLogs(p => ({ ...p, [kr.id]: true })); setKrMenu(null) }}>
                            ＋ this week
                          </button>
                        </>
                      )
                    })()}
                    <span className="kr-menu-wrap">
                      <button className="krmenu-btn" title="KR actions" onClick={e => openKrMenu(e, kr.id)}>⋯</button>
                      {krMenu?.id === kr.id && (
                        <>
                          <div className="menu-backdrop" onClick={() => setKrMenu(null)} />
                          <div className="krmenu" role="menu" style={{ top: krMenu.y + 4, left: Math.max(8, krMenu.x - 176) }}>
                            <div className="mlbl">Set status</div>
                            {STATUS_OPTS.map(o => (
                              <button key={o.v} className={`mitem${kr.health_status === o.v ? ' on' : ''}`} onClick={() => setKRStatus(kr, o.v)}>
                                <span className={`sdot ${healthTone(o.v).cls}`} />{o.l}{kr.health_status === o.v && <span className="ck">✓</span>}
                              </button>
                            ))}
                            <div className="mdiv" />
                            <button className="mitem" onClick={() => { setEditingKR(kr); setKrMenu(null) }}>Edit details…</button>
                            <button className="mitem" onClick={() => { setLogComposer({ krId: kr.id, objId: obj.id }); setLogDraft(''); setOpenLogs(p => ({ ...p, [kr.id]: true })); setKrMenu(null) }}>Add log</button>
                            <button className="mitem danger" onClick={() => { setKrMenu(null); if (window.confirm(`Delete “${kr.title}”? This can’t be undone.`)) deleteKR(kr.id) }}>Delete KR</button>
                          </div>
                        </>
                      )}
                    </span>
                  </div>
                  {(logsOpen || composing) && (() => {
                    const thisWk = getMonday()
                    const grouped = logsByKRGrouped.get(kr.id) ?? []
                    // Ensure current week group always appears (even if empty — for compose)
                    const hasThisWk = grouped.some(g => g.weekMonday === thisWk)
                    const allGroups: { weekMonday: string; logs: ObjectiveLog[] }[] = hasThisWk ? grouped : [{ weekMonday: thisWk, logs: [] as ObjectiveLog[] }, ...grouped]
                    return (
                      <div className="upd-panel">
                        {allGroups.map(({ weekMonday: wk, logs: wkLogs }) => {
                          const isCurrent = wk === thisWk
                          const groupKey = `${kr.id}::${wk}`
                          const isOpen = isCurrent || !!openKrWeekGroups[groupKey]
                          const composingHere = composing && isCurrent
                          const wkLabel = isCurrent ? `This week · ${wk.slice(5)}` : `${wk.slice(5)}`
                          return (
                            <div key={wk} className={`upd-wk${isCurrent ? ' cur' : ''}`}>
                              <button className="upd-wk-hdr" onClick={() => { if (!isCurrent) toggleKrWeekGroup(kr.id, wk) }}>
                                <span className="upd-wk-label">{wkLabel}</span>
                                {!isCurrent && <span className="upd-wk-ct">{wkLogs.length}</span>}
                                {!isCurrent && <span className={`upd-wk-chev${isOpen ? ' open' : ''}`}>▸</span>}
                              </button>
                              {isOpen && (
                                <div className="upd-wk-body">
                                  {wkLogs.map(l => (
                                    <div key={l.id} className="logline">
                                      <span className="d">{(l.log_date ?? '').slice(5)}</span>
                                      <span className="t">{l.title ? <b>{l.title}. </b> : null}{l.content}</span>
                                    </div>
                                  ))}
                                  {isCurrent && (
                                    composingHere ? (
                                      <textarea className="log-input" autoFocus value={logDraft}
                                        placeholder="Update on this KR… (⌘↵ to save)"
                                        onChange={e => setLogDraft(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitLog(); if (e.key === 'Escape') { setLogComposer(null); setLogDraft('') } }}
                                        onBlur={submitLog} />
                                    ) : (
                                      <button className="addlog" onClick={() => { setLogComposer({ krId: kr.id, objId: obj.id }); setLogDraft('') }}>＋ add update</button>
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )
            })}

            {miniKRs.length > 0 && (
              <>
                {fullKRs.length > 0 && <div className="grp-div" />}
                {miniKRs.map(kr => {
                  if (kr.is_metric) {
                    const c = latestMetricByKR.get(kr.id)
                    const d = kr.metric_direction === 'down' ? '↓' : '↑'
                    const isDone = kr.health_status === 'done'
                    return (
                      <div key={kr.id} className="krmini" onClick={() => onLogMetric(kr.id)} title="Log a reading">
                        <span className="tag">metric</span><span className="mt">{kr.title}</span>
                        <span className="read" style={isDone ? { color: 'var(--nw-nominal-text)' } : undefined}>
                          {isDone ? 'done' : <>{fmtMetric(c?.value, kr.metric_unit)}<span className="u"> {d}</span></>}
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

            {!showActCol && addBtn}
          </div>

          {showActCol && (
            <div className="act-col">
              {actThisWeek.length > 0 && (
                <div className="ac-grp"><div className="ac-lbl">Action Items</div>{actThisWeek.map(it => colActionRow(it, true))}</div>
              )}
              {actBacklog.length > 0 && (
                <div className="ac-grp"><div className="ac-lbl">Backlog</div>{actBacklog.map(it => colActionRow(it, false))}</div>
              )}
              {addRow}
              {!addRow && addBtn}
            </div>
          )}
        </div>

      </div>
    )
  }

  const objCount = board.length

  return (
    <div className="home">
      {/* header */}
      <div className="hd">
        <span className="hd-brand">Home</span>
        <span className="hd-qtr">{displayQ}</span>
        {(() => {
          const qb = quarterBounds(displayQ)
          if (!qb) return null
          const today = new Date(); today.setHours(0,0,0,0)
          const daysLeft = Math.ceil((qb.end.getTime() - today.getTime()) / 864e5)
          // ISO week number
          const d = new Date(today); d.setHours(0,0,0,0)
          d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7)
          const week1 = new Date(d.getFullYear(), 0, 4)
          const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 864e5 - 3 + (week1.getDay() + 6) % 7) / 7)
          if (daysLeft < 0) return null
          return (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, color: 'var(--navy-400)', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span title="ISO week number">W{weekNum}</span>
              <span style={{ color: daysLeft <= 14 ? 'var(--nw-caution-text)' : 'var(--navy-400)' }} title="Days left in quarter">
                {daysLeft}d left
              </span>
            </span>
          )
        })()}
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
          {showQuarterCloseCTA && onQuarterClose && (
            <button
              className="qclose-btn"
              onClick={() => onQuarterClose(ACTIVE_Q, spaceFilter)}
              title={`Close ${ACTIVE_Q}`}
            >Close {ACTIVE_Q} →</button>
          )}
        </div>
      </div>

      {/* quote */}
      <div className="quote">
        <p>&ldquo;{quote.text}&rdquo;</p>
        {quote.author && <span>— {quote.author}</span>}
      </div>

      {/* vitals — metric + habit flip cards */}
      {(metricKRs.length > 0 || habitKRs.length > 0) && (
        <div className="vitals">
          <button className="sec-hdr" onClick={() => setVitalsOpen(v => !v)}>
            <span className={`sec-chev${vitalsOpen ? ' open' : ''}`}>▸</span>
            <span className="lbl">Vitals</span>
            <span className="sec-meta">{metricKRs.length + habitKRs.length} tracked</span>
            <span className="rule" />
          </button>
          {vitalsOpen && (
            <div className="sec-body">
              {metricKRs.length > 0 && (
                <div className="vrow">
                  <div className="sublbl">Metrics · {displayQ}</div>
                  <div className="metrics">{metricKRs.map(metricCard)}</div>
                </div>
              )}
              {habitKRs.length > 0 && (
                <div className="vrow">
                  <div className="sublbl">Habits · 4-week rolling</div>
                  <div className="habits-cards">{habitKRs.map(habitCard)}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* focus this week — consolidated actions across objectives */}
      {focusTotal > 0 && (
        <div className="focusw">
          <button className="sec-hdr" onClick={() => setFocusOpen(v => !v)}>
            <span className={`sec-chev${focusOpen ? ' open' : ''}`}>▸</span>
            <span className="lbl">Focus this week</span>
            <span className="sec-meta">{focusDone} / {focusTotal} done</span>
            <span className="fbar"><i style={{ width: `${Math.round((focusDone / focusTotal) * 100)}%` }} /></span>
            <span className="rule" />
            {focusOpen && focusDone > 0 && <button className="dtoggle" onClick={e => { e.stopPropagation(); setHideFocusDone(v => !v) }}>{hideFocusDone ? 'show done' : 'hide done'}</button>}
          </button>
          {focusOpen && (
            <div className="sec-body">
              <div className={`focuslist${hideFocusDone ? ' hide-done' : ''}`}>
                {focusBySpace.map(g => {
                  const d = g.items.filter(i => i.a.completed).length
                  if (hideFocusDone && d === g.items.length) return null
                  return (
                    <div key={g.sp.id} className="sgrp" style={{ ['--sc']: spaceDisplayColor(g.sp) } as CSSProperties}>
                      <div className="sgrp-h"><span className="dot" /><span className="nm">{g.sp.name}</span><span className="n">{d}/{g.items.length}</span></div>
                      {g.items.map(focusRow)}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}



      {/* body: objectives (grouped by space in All view) + habits rail */}
      <div className="body">
        <div className="main">
          <button className="sec-hdr" onClick={() => setObjectivesOpen(v => !v)}>
            <span className={`sec-chev${objectivesOpen ? ' open' : ''}`}>▸</span>
            <span className="lbl">Objectives{objCount ? ` · ${objCount}` : ''}</span>
            <span className="rule" />
          </button>
          {objectivesOpen && (
            board.length === 0 ? (
              <div className="empty">No objectives in scope. Try a different space or quarter.</div>
            ) : spaceFilter === null ? (
              orderedSpaces
                .map(s => ({ s, items: board.filter(b => b.obj.space_id === s.id) }))
                .filter(grp => grp.items.length > 0)
                .map(({ s, items }) => (
                  <Fragment key={s.id}>
                    <div className="spacehdr" style={{ ['--sc']: spaceDisplayColor(s) } as CSSProperties}>
                      <span className="dot" /><span className="nm">{s.name}</span><span className="ct">{items.length}</span><span className="rule" />
                    </div>
                    <div className="board">{items.map(renderObjCard)}</div>
                  </Fragment>
                ))
            ) : (
              <div className="board">{board.map(renderObjCard)}</div>
            )
          )}

          {/* close the week — bottom of main */}
          {openCloses.length > 0 && (
            <div className="closes">
              <div className="seclbl"><span className="lbl">Close the week</span><span className="rule" /></div>
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
        </div>
      </div>

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

        .home{max-width:1340px;margin:0 auto;padding:8px 4px 80px;}
        .lbl{font-family:var(--font-mono);font-size:9.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--nw-label);}

        .hd{display:flex;align-items:center;gap:13px;padding:8px 0 2px;flex-wrap:wrap;}
        .hd-brand{font-family:var(--font-display);font-weight:700;font-size:22px;color:var(--nw-cream);letter-spacing:-.015em;}
        .hd-qtr{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--nw-label);letter-spacing:.14em;}
        .qclose-btn{font-family:var(--font-mono);font-size:9.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--accent);border:none;border-radius:7px;padding:5px 12px;cursor:pointer;white-space:nowrap;flex-shrink:0;}
        .qclose-btn:hover{background:var(--accent-2,#4a8af4);}
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

        /* Collapsible section headers */
        .sec-hdr{
          width:100%;display:flex;align-items:center;gap:10px;
          background:none;border:none;cursor:pointer;
          padding:7px 0;margin:0 0 4px;
          text-align:left;font-family:inherit;
          border-radius:6px;
        }
        .sec-hdr:hover .lbl{color:var(--accent);}
        .sec-hdr:hover .sec-chev{color:var(--accent);}
        .sec-chev{
          font-size:10px;color:var(--navy-400);
          transition:transform .18s;
          display:inline-block;transform:rotate(0deg);
          flex-shrink:0;
        }
        .sec-chev.open{transform:rotate(90deg);}
        .sec-meta{
          font-family:var(--font-mono);font-size:10px;
          color:var(--navy-400);white-space:nowrap;flex-shrink:0;
        }
        .sec-body{margin-bottom:8px;}

        /* focus this week — consolidated weekly actions */
        .focusw{margin-bottom:26px;}
        .focus-head{display:flex;align-items:center;gap:12px;margin:0 0 12px;}
        .focus-head .lbl{font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--nw-label);}
        .focus-head .fcount{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--navy-300);}
        .focus-head .fbar{flex:0 0 150px;height:5px;border-radius:3px;background:var(--navy-700);overflow:hidden;}
        .focus-head .fbar i{display:block;height:100%;background:var(--nw-nominal-text);border-radius:3px;transition:width .2s;}
        .focus-head .rule{flex:1;height:1px;background:var(--line);}
        .dtoggle{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.04em;color:var(--navy-400);background:var(--surface-2);border:1px solid var(--line-2);border-radius:6px;padding:4px 9px;cursor:pointer;}
        .dtoggle:hover{color:var(--navy-100);border-color:var(--navy-400);}
        .focuslist{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:6px 0;}
        .sgrp{padding:9px 18px;}
        .sgrp + .sgrp{border-top:1px solid var(--line);}
        .sgrp-h{display:flex;align-items:center;gap:8px;margin:0 0 5px;}
        .sgrp-h .dot{width:8px;height:8px;border-radius:3px;background:var(--sc,var(--navy-500));flex-shrink:0;}
        .sgrp-h .nm{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--nw-label-dim);}
        .sgrp-h .n{font-family:var(--font-mono);font-size:9px;color:var(--navy-600);}
        .frow{display:flex;align-items:center;gap:12px;padding:7px 4px;border-radius:8px;}
        .frow:hover{background:rgba(255,255,255,.014);}
        .fcb{width:18px;height:18px;border-radius:6px;flex-shrink:0;border:1.6px solid var(--navy-500);display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:var(--navy-900);background:transparent;cursor:pointer;padding:0;transition:.12s;}
        .fcb:hover{border-color:var(--nw-nominal-text);}
        .fcb.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .ftitle{flex:1;min-width:0;font-size:13.5px;color:var(--navy-50);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .frow.done .ftitle{color:var(--navy-500);text-decoration:line-through;}
        .fcarried{font-family:var(--font-mono);font-size:8.5px;font-weight:600;letter-spacing:.04em;color:var(--nw-caution-text);background:rgba(245,184,64,.1);border-radius:5px;padding:2px 7px;flex-shrink:0;}
        .fkrtag{font-family:var(--font-mono);font-size:9px;font-weight:600;color:var(--navy-300);background:var(--surface-2);border:1px solid var(--line-2);border-radius:5px;padding:2px 8px;display:inline-flex;align-items:center;gap:5px;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
        .fkrtag .kd{width:6px;height:6px;border-radius:2px;background:var(--sc,var(--navy-500));flex-shrink:0;}
        .frow.done .fkrtag{opacity:.5;}
        .flogchip{font-family:var(--font-mono);font-size:8.5px;font-weight:600;color:var(--navy-500);background:var(--surface-2);border:1px solid var(--line-2);border-radius:5px;padding:2px 7px;cursor:pointer;display:inline-flex;gap:4px;align-items:center;white-space:nowrap;flex-shrink:0;}
        .flogchip:hover{color:var(--navy-200);border-color:var(--navy-400);}
        .flogchip.has{color:var(--navy-200);}
        .flogchip.open{color:var(--accent);border-color:var(--accent);background:var(--accent-dim);}
        .flogchip .lcar{display:inline-block;font-size:7px;transition:transform .15s;}
        .flogchip.open .lcar{transform:rotate(90deg);}
        .flogs{margin:1px 0 7px 30px;display:flex;flex-direction:column;gap:4px;border-left:2px solid var(--line);padding-left:10px;}
        .addlog{font-family:var(--font-mono);font-size:9px;font-weight:600;color:var(--navy-500);border:1px dashed var(--line-2);border-radius:6px;padding:4px 9px;background:none;cursor:pointer;align-self:flex-start;}
        .addlog:hover{color:var(--accent);border-color:var(--accent);}
        .hide-done .frow.done{display:none;}
        .frow-actions{display:contents;}

        /* mobile: focus-head + action rows */
        @media(max-width:899px){
          .focus-head{flex-wrap:wrap;row-gap:6px;}
          .focus-head .lbl{flex:0 0 auto;}
          .focus-head .fcount{flex:0 0 auto;}
          .focus-head .fbar{flex:1 1 100%;order:3;margin-top:0;}
          .focus-head .rule{display:none;}
          .dtoggle{order:4;margin-left:auto;}
          .frow{flex-wrap:wrap;row-gap:3px;align-items:flex-start;padding:8px 4px;}
          .fcb{margin-top:2px;}
          .ftitle{flex:1 1 0;min-width:0;white-space:normal;}
          .fcarried{order:1;}
          .frow-actions{display:flex;align-items:center;gap:8px;flex:0 0 100%;margin-left:22px;box-sizing:border-box;}
          .fkrtag{max-width:none;flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;}
          .frow .sched,.frow .flogchip{flex-shrink:0;}
        }

        /* key metric flip cards */
        .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;}
        .mcard{height:150px;perspective:1200px;cursor:pointer;}
        .m-inner{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,.1,.2,1);transform-style:preserve-3d;}
        .mcard.flipped .m-inner{transform:rotateY(180deg);}
        .m-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:linear-gradient(180deg,var(--surface),var(--surface-2));border:1px solid var(--line);border-radius:13px;padding:14px 15px 11px;display:flex;flex-direction:column;}
        .m-face:hover{border-color:var(--line-strong);}
        .m-back{transform:rotateY(180deg);}
        .mcard h4{margin:0;font-family:var(--font-display);font-weight:600;font-size:13px;color:var(--nw-cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .mval{display:flex;align-items:baseline;gap:6px;margin-top:6px;}
        .mval b{font-family:var(--font-display);font-weight:700;font-size:25px;letter-spacing:-.02em;line-height:1;color:var(--nw-cream);}
        .mval .ghost{font-family:var(--font-mono);font-size:11px;color:var(--navy-500);}
        .rate{font-family:var(--font-mono);font-size:10px;font-weight:600;margin-top:7px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .rate.met{color:var(--nw-nominal-text);}
        .rate.ok{color:var(--nw-caution-text);}
        .rate.urgent{color:var(--nw-alarm-text);}
        .spark{margin-top:auto;width:100%;height:32px;display:block;}
        .mfoot{display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:6px;}
        .delta{font-family:var(--font-mono);font-size:10.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .delta.up{color:var(--nw-nominal-text);}
        .delta.down{color:var(--nw-caution-text);}
        .delta.flat{color:var(--navy-400);}
        .flipnote{font-family:var(--font-mono);font-size:8px;color:var(--navy-600);letter-spacing:.05em;flex-shrink:0;}
        .m-back .bh{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .m-back .back{font-family:var(--font-mono);font-size:9px;color:var(--navy-500);background:none;border:none;cursor:pointer;flex-shrink:0;}
        .m-back .back:hover{color:var(--navy-100);}
        .readings{margin-top:8px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:4px;}
        .rd{display:flex;align-items:baseline;gap:8px;font-family:var(--font-mono);font-size:10.5px;}
        .rd .rdate{color:var(--nw-label);min-width:38px;flex-shrink:0;}
        .rd .rval{color:var(--navy-100);font-weight:600;}
        .rd .rdelta{margin-left:auto;color:var(--nw-nominal-text);}
        .rd .rdelta.dn{color:var(--nw-caution-text);}
        .rd-empty{font-family:var(--font-mono);font-size:10px;color:var(--navy-600);}
        .logbtn{margin-top:7px;font-family:var(--font-mono);font-size:9px;font-weight:600;color:var(--accent);background:var(--accent-dim);border:none;border-radius:6px;padding:5px 0;cursor:pointer;}

        /* vitals band — metrics + habit flip cards */
        .vitals{margin-bottom:24px;}

        .vrow + .vrow{margin-top:16px;}
        .sublbl{font-family:var(--font-mono);font-size:8.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--nw-label-dim);margin:0 0 9px;}

        /* habit flip cards (front % + trend / back week check-off) */
        .habits-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:13px;}
        .hcard{height:132px;perspective:1200px;cursor:pointer;}
        .h-inner{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,.1,.2,1);transform-style:preserve-3d;}
        .hcard.flipped .h-inner{transform:rotateY(180deg);}
        .h-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;background:linear-gradient(180deg,var(--surface),var(--surface-2));border:1px solid var(--line);border-left:3px solid var(--ba,var(--navy-500));border-radius:13px;padding:13px 15px 11px;display:flex;flex-direction:column;}
        .h-face:hover{border-color:var(--line-strong);border-left-color:var(--ba,var(--navy-500));}
        .h-back{transform:rotateY(180deg);}
        .hcard h4{margin:0;font-family:var(--font-display);font-weight:600;font-size:12.5px;color:var(--nw-cream);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .hero-row{display:flex;align-items:baseline;gap:9px;margin:9px 0 0;}
        .hero{font-family:var(--font-mono);font-size:32px;font-weight:600;line-height:1;letter-spacing:-.01em;color:var(--hc,var(--navy-200));font-variant-numeric:tabular-nums;}
        .hero small{font-size:15px;}
        .trend{font-family:var(--font-mono);font-size:10px;font-weight:600;white-space:nowrap;}
        .trend.up{color:var(--nw-nominal-text);}
        .trend.down{color:var(--nw-caution-text);}
        .trend.flat{color:var(--navy-400);}
        .hsub{font-family:var(--font-mono);font-size:9px;color:var(--navy-500);margin-top:6px;letter-spacing:.02em;}
        .hf-foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;gap:6px;}
        .wkcount{font-family:var(--font-mono);font-size:9.5px;font-weight:600;color:var(--hc,var(--navy-300));white-space:nowrap;}
        .h-back .bh{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .h-back .back{font-family:var(--font-mono);font-size:9px;color:var(--navy-500);background:none;border:none;cursor:pointer;flex-shrink:0;}
        .h-back .back:hover{color:var(--navy-100);}
        .bcount{font-family:var(--font-mono);font-size:9px;font-weight:600;color:var(--hc,var(--nw-label));margin:9px 0 0;letter-spacing:.04em;}
        .daygrid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:9px;}
        .day{display:flex;flex-direction:column;align-items:center;gap:5px;}
        .day .dl{font-family:var(--font-mono);font-size:8px;font-weight:600;color:var(--navy-500);letter-spacing:.02em;}
        .day .dd{width:100%;height:26px;border-radius:8px;border:1.5px solid var(--navy-600);background:transparent;cursor:pointer;padding:0;transition:.12s;}
        .day .dd:hover{border-color:var(--nw-nominal-text);}
        .day .dd.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .day.today .dl{color:var(--accent);}
        .day.today .dd{box-shadow:0 0 0 1px var(--bg),0 0 0 2px var(--accent);}
        .hcard.t-nominal{--hc:var(--nw-nominal-text);--ba:var(--nw-nominal-text);}
        .hcard.t-caution{--hc:var(--nw-hero-amber);--ba:var(--nw-caution-text);}
        .hcard.t-alarm{--hc:var(--nw-alarm-text);--ba:var(--nw-alarm-text);}
        .hcard.t-standby{--hc:var(--nw-standby-text);--ba:var(--nw-standby-text);}

        /* body split: objectives (left) + habits rail (far right) */
        .body{display:flex;gap:22px;align-items:flex-start;}
        .main{flex:1;min-width:0;}

        /* space group headers (All view) */
        .spacehdr{display:flex;align-items:center;gap:9px;margin:22px 0 11px;}
        .spacehdr:first-child{margin-top:0;}
        .spacehdr .dot{width:9px;height:9px;border-radius:3px;background:var(--sc,var(--navy-500));flex-shrink:0;}
        .spacehdr .nm{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--nw-label);}
        .spacehdr .ct{font-family:var(--font-mono);font-size:9.5px;color:var(--navy-600);}
        .spacehdr .rule{flex:1;height:1px;background:var(--line);}

        .empty{color:var(--navy-500);font-size:13px;padding:30px 0;text-align:center;}
        .board{display:flex;flex-direction:column;gap:12px;margin-bottom:4px;}
        .ocard{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 0 rgba(255,255,255,.02) inset,0 8px 24px -16px rgba(0,0,0,.7);}

        /* collapsed pill row */
        .col-row{display:flex;align-items:center;gap:13px;padding:13px 15px;cursor:pointer;border-left:3px solid var(--oc,var(--navy-500));}
        .col-row:hover{background:rgba(255,255,255,.013);}
        .chev{color:var(--navy-500);font-size:11px;flex-shrink:0;width:12px;cursor:pointer;user-select:none;}
        .col-name{font-family:var(--font-display);font-weight:600;font-size:14.5px;color:var(--nw-cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;}
        .prog-inline{display:flex;align-items:center;gap:8px;flex-shrink:0;}
        .prog-num{font-family:var(--font-display);font-weight:700;font-size:15px;color:var(--oc,var(--navy-200));letter-spacing:-.01em;}
        .prog-bar{position:relative;width:56px;height:6px;border-radius:3px;background:var(--navy-700);overflow:hidden;}
        .prog-bar i{display:block;height:100%;background:var(--oc,var(--navy-400));border-radius:3px;}
        .pm{position:absolute;top:0;height:100%;width:2px;border-radius:1px;background:var(--navy-100);box-shadow:0 0 0 1px var(--surface);}
        .pacechip{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.02em;padding:2px 7px;border-radius:5px;white-space:nowrap;flex-shrink:0;}
        .pacechip.ahead{color:var(--nw-nominal-text);background:rgba(127,226,122,.1);}
        .pacechip.onpace{color:var(--nw-standby-text);background:var(--surface-2);}
        .pacechip.behind{color:var(--nw-caution-text);background:rgba(245,184,64,.1);}
        .pacechip.late{color:var(--nw-alarm-text);background:rgba(255,100,82,.1);}
        .pacechip.done{color:var(--nw-nominal-text);background:rgba(127,226,122,.14);}
        .pills{display:flex;flex-wrap:wrap;gap:5px;flex:1;}
        .opill{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.03em;padding:2px 7px;border-radius:5px;white-space:nowrap;}
        .opill.done{color:var(--nw-nominal-text);background:rgba(127,226,122,.1);}
        .opill.on{color:var(--nw-standby-text);background:var(--surface-2);}
        .opill.off{color:var(--nw-alarm-text);background:rgba(255,100,82,.1);}
        .opill.wk{color:var(--accent);background:var(--accent-dim);}
        .opill.carried{color:var(--nw-caution-text);background:rgba(245,184,64,.1);}
        .ohb{background:none;border:none;color:var(--navy-600);font-size:13px;cursor:pointer;padding:3px 6px;border-radius:6px;flex-shrink:0;line-height:1;}
        .ohb:hover{background:var(--hover);color:var(--navy-100);}

        /* expanded: rail | KRs | actions */
        .exp{display:flex;}
        .rail{flex:0 0 220px;padding:15px 16px;border-left:3px solid var(--oc,var(--navy-500));border-right:1px solid var(--line);}
        .rail-top{display:flex;align-items:flex-start;gap:8px;}
        .rail-top .chev{margin-top:5px;}
        .rail h3{margin:0;font-family:var(--font-display);font-weight:600;font-size:15px;color:var(--nw-cream);letter-spacing:-.01em;line-height:1.25;}
        .prog{margin:12px 0 0;}
        .prog .num{font-family:var(--font-display);font-size:30px;font-weight:700;color:var(--oc,var(--nw-cream));line-height:1;letter-spacing:-.02em;}
        .prog .num small{font-size:14px;color:var(--navy-500);font-weight:600;margin-left:2px;}
        .prog .track{position:relative;margin-top:7px;height:6px;border-radius:3px;background:var(--navy-700);overflow:hidden;}
        .prog .track i{display:block;height:100%;background:var(--oc,var(--navy-400));border-radius:3px;}
        .prog .sub{font-family:var(--font-mono);font-size:9px;color:var(--navy-500);margin-top:6px;}
        .rail .pills{margin-top:12px;}
        .rail-acts{margin-top:13px;display:flex;gap:4px;}

        /* middle: KR column */
        .kr-col{flex:1;min-width:0;padding:3px 0;}
        .kr{padding:9px 15px;border-top:1px solid var(--line);}
        .kr:first-child{border-top:none;}
        .kr:hover{background:rgba(255,255,255,.012);}
        .kr-head{display:flex;align-items:center;gap:9px;}
        .cb{width:16px;height:16px;border-radius:5px;flex-shrink:0;border:1.5px solid var(--navy-500);display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:var(--navy-900);background:transparent;cursor:pointer;padding:0;}
        .cb.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .kt{flex:1;min-width:0;font-size:13.5px;color:var(--navy-100);line-height:1.4;}
        .kr.done .kt{color:var(--navy-500);text-decoration:line-through;}
        .st{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:1px 6px;border-radius:4px;margin-left:8px;white-space:nowrap;}
        .st.t-nominal{color:var(--nw-nominal-text);background:rgba(127,226,122,.1);}
        .st.t-alarm{color:var(--nw-alarm-text);background:rgba(255,100,82,.1);}
        .st.t-failed{color:var(--navy-300);background:rgba(255,100,82,.07);text-decoration:line-through;text-decoration-color:rgba(255,100,82,.55);}
        .st.t-caution{color:var(--nw-caution-text);background:rgba(245,184,64,.1);}
        .st.t-standby{color:var(--nw-standby-text);background:var(--surface-2);}
        .st.metricv{color:var(--navy-100);background:var(--surface-2);font-weight:600;text-transform:none;letter-spacing:0;}
        .upd-prompt{font-family:var(--font-mono);font-size:8.5px;font-weight:600;color:var(--t-3,var(--navy-600));border:1px dashed var(--line-2);border-radius:5px;padding:2px 8px;background:none;cursor:pointer;white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;transition:color .15s,border-color .15s;}
        .upd-prompt:hover{color:var(--accent);border-color:var(--accent);}
        .upd-badge{font-family:var(--font-mono);font-size:8.5px;font-weight:700;color:var(--accent);background:var(--accent-bg,var(--accent-dim));border:1px solid rgba(59,130,246,.3);border-radius:5px;padding:2px 7px;cursor:pointer;white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;}
        .upd-badge:hover{background:rgba(59,130,246,.18);}
        .upd-badge.open{background:rgba(59,130,246,.2);}
        .upd-badge .lcar{display:inline-block;font-size:7px;transition:transform .15s;}
        .upd-badge.open .lcar{transform:rotate(90deg);}
        .upd-panel{margin:2px 0 4px 25px;border-left:2px solid var(--line);padding-left:9px;display:flex;flex-direction:column;gap:0;}
        .upd-wk{margin-bottom:3px;}
        .upd-wk-hdr{display:flex;align-items:center;gap:6px;background:none;border:none;padding:3px 0;cursor:pointer;width:100%;}
        .upd-wk.cur .upd-wk-hdr{cursor:default;}
        .upd-wk-label{font-family:var(--font-mono);font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
        .upd-wk.cur .upd-wk-label{color:var(--accent);}
        .upd-wk:not(.cur) .upd-wk-label{color:var(--nw-label-dim);}
        .upd-wk:not(.cur) .upd-wk-hdr:hover .upd-wk-label{color:var(--nw-label);}
        .upd-wk-ct{font-family:var(--font-mono);font-size:8px;color:var(--navy-600);}
        .upd-wk-chev{font-size:7px;color:var(--navy-600);display:inline-block;transition:transform .12s;}
        .upd-wk-chev.open{transform:rotate(90deg);}
        .upd-wk-body{padding:2px 0 6px;display:flex;flex-direction:column;gap:3px;}
        .logchip{font-family:var(--font-mono);font-size:8.5px;font-weight:600;color:var(--navy-500);background:var(--surface-2);border:1px solid var(--line-2);border-radius:5px;padding:1px 6px;cursor:pointer;display:inline-flex;gap:4px;align-items:center;white-space:nowrap;flex-shrink:0;}
        .logchip:hover{color:var(--navy-200);border-color:var(--navy-400);}
        .logchip.open{color:var(--accent);border-color:var(--accent);background:var(--accent-dim);}
        .lcar{display:inline-block;font-size:7px;transition:transform .15s;}
        .logchip.open .lcar{transform:rotate(90deg);}
        .st.clk{border:1px solid transparent;cursor:pointer;font-family:var(--font-mono);line-height:1.4;}
        .st.clk:hover{border-color:currentColor;}
        .kr-menu-wrap{position:relative;flex-shrink:0;display:flex;}
        .krmenu-btn{background:none;border:none;color:var(--navy-500);font-size:15px;line-height:1;cursor:pointer;padding:2px 6px;border-radius:6px;}
        .krmenu-btn:hover{background:var(--hover);color:var(--navy-100);}
        .menu-backdrop{position:fixed;inset:0;z-index:40;}
        .krmenu{position:fixed;z-index:50;min-width:176px;background:var(--surface-2);border:1px solid var(--line-strong);border-radius:10px;padding:5px;box-shadow:0 12px 32px -10px rgba(0,0,0,.8);}
        .krmenu .mlbl{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--nw-label-dim);padding:4px 8px 5px;}
        .krmenu .mitem{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:none;color:var(--navy-100);font-family:var(--font-body);font-size:12.5px;padding:6px 8px;border-radius:6px;cursor:pointer;}
        .krmenu .mitem:hover{background:var(--hover);}
        .krmenu .mitem.on{color:var(--nw-cream);}
        .krmenu .mitem .ck{margin-left:auto;color:var(--accent);font-size:11px;}
        .krmenu .mitem.danger{color:var(--nw-alarm-text);}
        .krmenu .mitem.danger:hover{background:rgba(255,100,82,.12);}
        .krmenu .sdot{width:8px;height:8px;border-radius:3px;flex-shrink:0;}
        .krmenu .sdot.t-nominal{background:var(--nw-nominal-text);}
        .krmenu .sdot.t-alarm{background:var(--nw-alarm-text);}
        .krmenu .sdot.t-failed{background:var(--navy-400);}
        .krmenu .sdot.t-caution{background:var(--nw-caution-text);}
        .krmenu .sdot.t-standby{background:var(--navy-500);}
        .krmenu .mdiv{height:1px;background:var(--line);margin:5px 4px;}
        .logs{margin:7px 0 1px 25px;display:flex;flex-direction:column;gap:3px;border-left:2px solid var(--line);padding-left:9px;}
        .logline{display:flex;gap:8px;align-items:baseline;}
        .logline .d{font-family:var(--font-mono);font-size:8.5px;font-weight:600;color:var(--nw-label);min-width:34px;flex-shrink:0;}
        .logline .t{font-size:11.5px;color:var(--navy-300);line-height:1.4;}
        .logline .t b{color:var(--navy-100);font-weight:600;}
        .log-input{width:100%;min-height:46px;background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;padding:7px 9px;font-size:12px;color:var(--navy-50);font-family:inherit;outline:none;resize:vertical;margin-top:3px;}
        .log-input:focus{border-color:var(--accent);}

        .grp-div{height:1px;background:var(--line);margin:2px 15px;}
        .krmini{display:flex;align-items:center;gap:10px;padding:6px 15px;border-top:1px solid var(--line);cursor:default;}
        .krmini:hover{background:rgba(255,255,255,.012);}
        .krmini .tag{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--navy-500);border:1px solid var(--line-2);border-radius:4px;padding:1px 5px;flex-shrink:0;}
        .krmini .mt{font-size:12.5px;color:var(--navy-300);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .krmini .read{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--navy-200);flex-shrink:0;}
        .krmini .read .u{color:var(--navy-500);font-weight:500;}

        /* right: actions column */
        .act-col{flex:0 0 320px;border-left:1px solid var(--line);background:rgba(255,255,255,.012);padding:12px 14px;}
        .ac-grp + .ac-grp{margin-top:12px;}
        .ac-lbl{font-family:var(--font-mono);font-size:8.5px;font-weight:600;letter-spacing:.13em;text-transform:uppercase;color:var(--nw-label-dim);margin:0 0 6px;}
        .act{display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap;}
        .cb-sm{width:14px;height:14px;border-radius:4px;flex-shrink:0;border:1.4px solid var(--navy-500);display:inline-flex;align-items:center;justify-content:center;font-size:8px;color:var(--navy-900);background:transparent;cursor:pointer;padding:0;}
        .cb-sm.on{background:var(--nw-nominal-text);border-color:var(--nw-nominal-text);}
        .at{flex:1;font-size:12.5px;color:var(--navy-100);min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .act.done .at{color:var(--navy-600);text-decoration:line-through;}
        .krtag{font-family:var(--font-mono);font-size:8px;font-weight:600;color:var(--navy-400);background:var(--surface-2);border-radius:4px;padding:1px 6px;display:inline-flex;align-items:center;gap:4px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
        .krtag .kd{width:6px;height:6px;border-radius:2px;background:var(--oc,var(--navy-500));flex-shrink:0;}
        .ameta{display:flex;gap:5px;align-items:center;margin-left:auto;flex-shrink:0;}
        .carried{font-family:var(--font-mono);font-size:8px;font-weight:600;letter-spacing:.04em;color:var(--nw-caution-text);background:rgba(245,184,64,.08);border-radius:4px;padding:1px 5px;flex-shrink:0;}
        .sched{font-family:var(--font-mono);font-size:8.5px;font-weight:600;letter-spacing:.03em;padding:2px 6px;border-radius:5px;flex-shrink:0;cursor:pointer;border:none;}
        .sched.week{color:var(--accent);background:var(--accent-dim);}
        .sched.back{color:var(--navy-400);background:var(--surface-2);border:1px solid var(--line-2);}
        .sched.back:hover{color:var(--accent);border-color:var(--accent);}
        .act-dur{font-family:var(--font-mono);font-size:8.5px;font-weight:600;padding:2px 6px;border-radius:5px;flex-shrink:0;cursor:pointer;border:1px solid var(--line-2);color:var(--navy-200);background:transparent;}
        .act-del{font-family:var(--font-mono);font-size:13px;font-weight:400;line-height:1;padding:1px 4px;border-radius:5px;flex-shrink:0;cursor:pointer;border:none;color:var(--navy-600);background:transparent;opacity:0;}
        .act:hover .act-del,.frow:hover .act-del{opacity:1;}
        .act-del:hover{color:var(--nw-alarm-text);background:rgba(255,100,82,.1);}
        .act-dur:hover{border-color:var(--navy-400);}
        .act-dur:not(.set){color:var(--navy-500);border-style:dashed;}
        .act-dur.open{color:var(--accent);border-color:var(--accent);background:var(--accent-dim);}
        .act-durpick{display:flex;flex-wrap:wrap;gap:6px;margin:3px 0 5px 22px;}
        .act-durchip{font-family:var(--font-mono);font-size:9.5px;font-weight:600;padding:3px 9px;border-radius:6px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-300);cursor:pointer;}
        .act-durchip:hover{border-color:var(--accent);color:var(--accent);}
        .act-durchip.on{border-color:var(--accent);background:var(--accent-dim);color:var(--accent);}
        .act-durchip.clear{color:var(--navy-500);}
        .addrow{display:flex;flex-direction:column;gap:5px;margin-top:10px;}
        .kr-sel{background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;padding:5px 8px;font-size:11px;color:var(--navy-100);font-family:inherit;outline:none;}
        .kr-sel:focus{border-color:var(--accent);}
        .act-input{background:var(--surface-2);border:1px solid var(--line-2);border-radius:7px;padding:6px 9px;font-size:12px;color:var(--navy-50);font-family:inherit;outline:none;}
        .act-input:focus{border-color:var(--accent);}
        .addact{font-family:var(--font-mono);font-size:9px;font-weight:600;color:var(--navy-500);border:1px dashed var(--line-2);border-radius:6px;padding:5px 9px;background:none;cursor:pointer;margin-top:10px;width:100%;}
        .addact:hover{color:var(--accent);border-color:var(--accent);}

        .closes{display:flex;flex-direction:column;gap:10px;margin-top:30px;}
        .closebar{display:flex;align-items:center;gap:16px;background:linear-gradient(90deg,rgba(200,150,66,.07),transparent 55%),var(--surface);border:1px solid var(--line-2);border-radius:13px;padding:13px 16px;}
        .closebar .ci{width:32px;height:32px;border-radius:9px;background:rgba(200,150,66,.12);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;}
        .closebar .ct b{font-family:var(--font-display);font-weight:600;font-size:13.5px;color:var(--nw-cream);}
        .closebar .ct div{font-size:11.5px;color:var(--navy-400);margin-top:1px;}
        .cb-close{margin-left:auto;font-family:var(--font-body);font-weight:600;font-size:12.5px;color:#fff;background:var(--accent);border:none;border-radius:9px;padding:8px 15px;cursor:pointer;}
        .cb-close:hover{background:var(--accent-2,#6ea3ff);}

        @media (max-width:1080px){
          .metrics{grid-template-columns:repeat(2,1fr);}
          .body{flex-direction:column;}
        }
        @media (max-width:899px){
          .metrics{grid-template-columns:1fr;}
          .mcard{height:130px;}
          .habits-cards{grid-template-columns:1fr;}
          .hcard{height:116px;}
          .vrow + .vrow{margin-top:12px;}
        }
        @media (max-width:760px){
          .exp{flex-direction:column;}
          .rail{flex:1 1 auto;border-right:none;border-bottom:1px solid var(--line);}
          .act-col{flex:1 1 auto;border-left:none;border-top:1px solid var(--line);}
          .col-name{max-width:150px;}
        }
      `}</style>
    </div>
  )
}

// ─── ObjResources ──────────────────────────────────────────────────────
// Compact resource strip on the expanded objective card rail.
// Shows linked Todoist projects, Evernote notebooks, Drive folders, etc.
// as clickable chips. "+ Manage" opens the ObjectivePanel.
function ObjResources({
  objId, links, onManage,
}: {
  objId: string
  links: import('@/lib/types').ObjectiveLink[]
  onManage: () => void
}) {
  if (links.length === 0) {
    return (
      <div style={{ marginTop: 8 }}>
        <button onClick={onManage}
          style={{ fontSize: 11, color: 'var(--navy-500)', background: 'transparent', border: '1px dashed var(--navy-600)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
          + link resources
        </button>
      </div>
    )
  }

  const EMOJI: Record<string, React.ReactNode> = {
    todoist_project: <TodoistIcon size={13}/>, evernote_notebook: <EvernoteNotebookIcon size={13}/>, drive_folder: <DriveFolderIcon size={13}/>,
    evernote_note: <EvernoteNoteIcon size={13}/>, file: <DriveFileIcon size={13}/>, link: <LinkIcon size={13}/>, todoist_task: <TodoistIcon size={13}/>,
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
      {links.map(l => (
        <button key={l.id}
          onClick={() => shellOpen(l.url)}
          title={l.url}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600, color: 'var(--navy-200)',
            background: 'var(--navy-750, var(--navy-700))',
            border: '1px solid var(--navy-600)',
            borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}>
          <span style={{ display:'inline-flex', alignItems:'center' }}>{EMOJI[l.kind] ?? <LinkIcon size={13}/>}</span>
          <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>↗</span>
        </button>
      ))}
      <button onClick={onManage}
        style={{ fontSize: 11, color: 'var(--navy-500)', background: 'transparent', border: '1px dashed var(--navy-600)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
        +
      </button>
    </div>
  )
}
