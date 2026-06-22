'use client'
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import type { Space, AnnualObjective, RoadmapItem, WeeklyAction, Task, HabitCheckin, Note, Notebook, WeeklyReview, ActionTag, TrackedFile, MetricCheckin } from '@/lib/types'
import { getMonday, addWeeks, parseDateLocal, ACTIVE_Q } from '@/lib/utils'
import { getMetricKRs } from '@/lib/krFilters'
import MetricKPICard from './MetricKPICard'
import { randomQuote } from '@/lib/quotes'
import { spaceDisplayColor } from '@/lib/spaceColor'
import * as actionsDb from '@/lib/db/actions'
import * as tasksDb from '@/lib/db/tasks'
import * as notesDb from '@/lib/db/notes'
import * as checkinsDb from '@/lib/db/checkins'
import { extractNoteText } from '@/lib/noteText'
import { deleteAllMediaForNote } from '@/lib/db/noteMedia'
import { NoteEditor } from './notes/NoteEditor'
import { fetchCalendarEvents, type GoogleBusyEvent, type GoogleAllDayEvent } from '@/lib/db/googleApi'
import * as filesDb from '@/lib/db/trackedFiles'
import { trackViaPicker } from '@/lib/trackViaPicker'

// Which object the Home cockpit's focused "work" view is showing.
type WorkTarget = { kind: 'kr'; id: string } | { kind: 'note'; id: string } | { kind: 'task'; id: string }

// ── date helpers (local-tz safe; mirror Calendar.tsx) ──
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateForDow(weekStart: string, dow: number): string {
  const d = parseDateLocal(weekStart); d.setDate(d.getDate() + dow); return ymd(d)
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseDateLocal(b).getTime() - parseDateLocal(a).getTime()) / 86_400_000)
}
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// Mirrors ActionPanel/Focus TAG_STYLE — the backlog/waiting/doing pill, shown
// read-only on Home's action rows (set in ActionPanel, the canonical picker).
const TAG_STYLE: Record<ActionTag, { bg: string; color: string; label: string }> = {
  backlog: { bg: 'var(--navy-600)', color: 'var(--navy-200)', label: 'backlog' },
  waiting: { bg: 'var(--indigo-bg)', color: 'var(--indigo-text)', label: 'waiting' },
  doing:   { bg: 'var(--teal-bg)',   color: 'var(--teal-text)',   label: 'doing' },
}
function shortDow(dateStr: string): string {
  return DOW[(parseDateLocal(dateStr).getDay() + 6) % 7]
}
function fmtRange(weekStart: string): string {
  const a = parseDateLocal(weekStart); const b = parseDateLocal(weekStart); b.setDate(b.getDate() + 6)
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  return a.getMonth() === b.getMonth()
    ? `${mo(a)} ${a.getDate()} – ${b.getDate()}`
    : `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}`
}
function dayPart(h: number): string {
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}
// File row helpers for the KR work view's Files section.
const FILE_STATUS_LABEL: Record<string, string> = {
  new_in: 'New in', editing: 'Editing', with_client: 'With client', sent: 'Sent',
}
function fileGlyph(mime: string | null): string {
  const m = mime ?? ''
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return '▦'
  if (m.includes('document') || m.includes('word')) return '▤'
  if (m.includes('presentation') || m.includes('powerpoint')) return '◫'
  if (m.includes('pdf')) return '▥'
  return '◻'
}

interface Props {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  setActions: React.Dispatch<React.SetStateAction<WeeklyAction[]>>
  metricCheckins: MetricCheckin[]
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  habitCheckins: HabitCheckin[]
  setHabitCheckins: (fn: (h: HabitCheckin[]) => HabitCheckin[]) => void
  notes: Note[]
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  notebooks: Notebook[]
  tagsByNote: Map<string, string[]>
  setTagsByNote: React.Dispatch<React.SetStateAction<Map<string, string[]>>>
  googleConnected: boolean
  driveGranted: boolean
  trackedFiles: TrackedFile[]
  setTrackedFiles: React.Dispatch<React.SetStateAction<TrackedFile[]>>
  reviews: WeeklyReview[]
  weekForSpace: (spaceId: string) => string
  onCloseWeek: (spaceId: string, week: string) => void
  onOpenNote: (noteId: string) => void
  onOpenTasks: () => void
  onOpenCalendar: () => void
  onLogMetric: (krId: string) => void
  toast: (m: string) => void
}

// KR health → night-watch tone for the board pills.
const HEALTH_TONE: Record<string, { cls: string; label: string }> = {
  on_track:    { cls: 't-nominal', label: 'on track' },
  off_track:   { cls: 't-alarm',   label: 'off track' },
  blocked:     { cls: 't-alarm',   label: 'blocked' },
  waiting:     { cls: 't-caution', label: 'waiting' },
  backlog:     { cls: 't-standby', label: 'backlog' },
  not_started: { cls: 't-standby', label: 'not started' },
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

export default function Home({
  spaces, objectives, roadmapItems, actions, setActions, tasks, setTasks,
  metricCheckins,
  habitCheckins, setHabitCheckins, notes, setNotes, notebooks, tagsByNote, setTagsByNote,
  googleConnected, driveGranted, trackedFiles, setTrackedFiles, reviews, weekForSpace, onCloseWeek,
  onOpenTasks, onOpenCalendar, toast,
  onLogMetric,
}: Props) {
  const [weekMonday, setWeekMonday] = useState<string>(getMonday())
  const [spaceFilter, setSpaceFilter] = useState<string | null>(null) // null = All spaces
  const [quarterScope, setQuarterScope] = useState<'current' | 'all'>('current') // board defaults to ACTIVE_Q
  const [busyEvents, setBusyEvents] = useState<GoogleBusyEvent[]>([])
  const [allDayEvents, setAllDayEvents] = useState<GoogleAllDayEvent[]>([])
  const [nowTick, setNowTick] = useState(() => Date.now())

  const weekEnd = useMemo(() => dateForDow(weekMonday, 6), [weekMonday])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateForDow(weekMonday, i)), [weekMonday])
  const todayStr = ymd(new Date())
  const isCurrentWeek = weekMonday === getMonday()

  const krById = useMemo(() => new Map(roadmapItems.map(r => [r.id, r])), [roadmapItems])
  const spaceById = useMemo(() => new Map(spaces.map(s => [s.id, s])), [spaces])
  const objById = useMemo(() => new Map(objectives.map(o => [o.id, o])), [objectives])
  const orderedSpaces = useMemo(() => [...spaces].sort((a, b) => a.sort_order - b.sort_order), [spaces])
  const colorForSpace = (id: string | null) => {
    const sp = id ? spaceById.get(id) : null
    return sp ? spaceDisplayColor(sp) : 'var(--navy-500)'
  }

  // Per-space weekly-close status — same rule as Reflect's launcher: a space's
  // cursor week is "open" (closeable) when it's this week or earlier and has no
  // closed review; "overdue" when strictly before this week. Independent of the
  // week Home is currently displaying (close cadence is per-space, not the deck).
  const thisMonday = getMonday()
  const closeRows = orderedSpaces.map(sp => {
    const wk = weekForSpace(sp.id)
    const closed = reviews.some(r => r.space_id === sp.id && r.week_start === wk && r.closed_at != null)
    const open = !closed && wk <= thisMonday
    const overdue = open && wk < thisMonday
    return { sp, wk, open, overdue }
  })
  const anyOpen = closeRows.some(r => r.open)

  // Tick the now-line every minute (only matters on the current week).
  useEffect(() => {
    if (!isCurrentWeek) return
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [isCurrentWeek])

  // Fetch the week's calendar (busy + all-day) when connected.
  useEffect(() => {
    if (!googleConnected) { setBusyEvents([]); setAllDayEvents([]); return }
    let cancelled = false
    fetchCalendarEvents(weekMonday, weekEnd)
      .then(({ events, allDayEvents }) => { if (!cancelled) { setBusyEvents(events); setAllDayEvents(allDayEvents) } })
      .catch(() => { if (!cancelled) { setBusyEvents([]); setAllDayEvents([]) } })
    return () => { cancelled = true }
  }, [googleConnected, weekMonday, weekEnd])

  // Fresh quote on every mount (page open / refresh / nav back to Home).
  const [quote] = useState(() => randomQuote())

  // A space-week that's been closed is off the deck. At close, incomplete
  // actions are carried forward into the next week as fresh rows; the originals
  // stay in the now-closed week with completed=false. Without this guard those
  // carried originals keep rendering as live "open" items on the current-week
  // board even though you've already rolled them on. Drop any space whose review
  // for the displayed week is closed.
  // ── Latest metric reading per KR (for the readout on metric KR rows) ──
  const latestMetricByKR = useMemo(() => {
    const m = new Map<string, MetricCheckin>()
    for (const c of metricCheckins) {
      const cur = m.get(c.roadmap_item_id)
      if (!cur || (c.week_start ?? '') > (cur.week_start ?? '')) m.set(c.roadmap_item_id, c)
    }
    return m
  }, [metricCheckins])

  // ── Metric KRs (current quarter, in scope) for the Key metrics band ──
  // Always current-quarter — the cards are quarter-anchored — so they ignore
  // the board's This-quarter/All toggle.
  const metricKRs = useMemo(
    () => getMetricKRs(roadmapItems, ACTIVE_Q).filter(k => spaceFilter === null || k.space_id === spaceFilter),
    [roadmapItems, spaceFilter],
  )

  // ── KR board: active objectives → their KRs, with this-week + backlog
  // actions. This is the working backbone of Home — present whether or not
  // the week has any scheduled work, so an empty week is never a dead screen.
  // Habits are excluded (they live in the Habits tracker on the rail).
  const krBoard = useMemo(() => {
    const objs = objectives
      .filter(o => o.status !== 'abandoned' && (spaceFilter === null || o.space_id === spaceFilter))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const groups = objs
      .map(o => {
        const krs = roadmapItems
          .filter(k => k.annual_objective_id === o.id && !k.is_habit && !k.is_parked && k.health_status !== 'done'
            && (quarterScope === 'all' || k.quarter === ACTIVE_Q))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map(kr => ({
            kr,
            thisWeek: actions.filter(a => a.roadmap_item_id === kr.id && a.week_start === weekMonday),
            backlog: actions.filter(a => a.roadmap_item_id === kr.id && a.week_start == null && !a.completed),
          }))
        return { obj: o, krs }
      })
      .filter(g => g.krs.length > 0)
    const inMotion = groups.flatMap(g => g.krs).filter(x => x.thisWeek.length > 0)
    const totalKRs = groups.reduce((n, g) => n + g.krs.length, 0)
    return { groups, inMotion, totalKRs }
  }, [objectives, roadmapItems, actions, weekMonday, spaceFilter, quarterScope])

  // ── Tasks due this week (open, non-subtask, due in week) ──
  const dueThisWeek = useMemo(() =>
    tasks
      .filter(t => !t.completed_at && !t.parent_task_id && t.due_date && t.due_date >= weekMonday && t.due_date <= weekEnd && (spaceFilter === null || t.space_id === spaceFilter))
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [tasks, weekMonday, weekEnd, spaceFilter])

  // ── Overdue tasks (needs attention) ──
  const overdue = useMemo(() =>
    tasks
      .filter(t => !t.completed_at && !t.parent_task_id && t.due_date && t.due_date < todayStr && (spaceFilter === null || t.space_id === spaceFilter))
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [tasks, todayStr, spaceFilter])

  // ── Habits: habit KRs × 7-day grid ──
  const habitKRs = useMemo(() =>
    roadmapItems.filter(k => k.is_habit && !k.is_parked && k.health_status !== 'done' && (spaceFilter === null || k.space_id === spaceFilter)),
    [roadmapItems, spaceFilter])
  const checkinSet = useMemo(() => {
    const m = new Map<string, string>() // `${kr}:${date}` → checkin id
    for (const c of habitCheckins) m.set(`${c.roadmap_item_id}:${c.date}`, c.id)
    return m
  }, [habitCheckins])

  // ── Recent notes for the rail (each dives into its note work view) ──
  const recentNotes = useMemo(() =>
    [...notes]
      .filter(n => spaceFilter === null || n.space_id === spaceFilter)
      .sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1))
      .slice(0, 4),
    [notes, spaceFilter])

  // ── meetings + all-day grouped by date ──
  // Drop self-created "Busy (…)" / "Blocked (…)" holds — they're capacity blocks,
  // not real meetings. Keep everything else.
  const isHold = (title: string) => /^\s*(busy|blocked)\b/i.test(title)
  const busyByDate = useMemo(() => {
    const m = new Map<string, GoogleBusyEvent[]>()
    for (const e of busyEvents) { if (isHold(e.title)) continue; const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a) }
    for (const a of m.values()) a.sort((x, y) => x.startMinute - y.startMinute)
    return m
  }, [busyEvents])
  const allDayByDate = useMemo(() => {
    const m = new Map<string, GoogleAllDayEvent[]>()
    for (const e of allDayEvents) { if (isHold(e.title)) continue; const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a) }
    return m
  }, [allDayEvents])

  // now-line position (current week only)
  const nowLeftPct = useMemo(() => {
    if (!isCurrentWeek) return null
    const now = new Date(nowTick)
    const dayIdx = (now.getDay() + 6) % 7 // Mon=0
    const frac = (now.getHours() * 60 + now.getMinutes()) / 1440
    return ((dayIdx + frac) / 7) * 100
  }, [isCurrentWeek, nowTick])

  // ── mutations ──
  async function toggleAction(a: WeeklyAction) {
    try {
      const updated = await actionsDb.update(a.id, { completed: !a.completed })
      setActions(prev => prev.map(x => x.id === a.id ? updated : x))
    } catch { toast('Could not update action') }
  }
  async function toggleTask(t: Task) {
    try {
      const updated = await tasksDb.toggleComplete(t)
      setTasks(prev => prev.map(x => x.id === t.id ? updated : x))
    } catch { toast('Could not update task') }
  }
  async function toggleHabit(krId: string, date: string) {
    const key = `${krId}:${date}`
    const existing = checkinSet.get(key)
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
  async function backlogTask(t: Task) {
    try {
      const updated = await tasksDb.update(t.id, { due_date: null })
      setTasks(prev => prev.map(x => x.id === t.id ? updated : x))
      toast('Due date cleared')
    } catch { toast('Could not update task') }
  }
  async function snoozeTask(t: Task) {
    const tm = parseDateLocal(todayStr); tm.setDate(tm.getDate() + 1)
    try {
      const updated = await tasksDb.update(t.id, { due_date: ymd(tm) })
      setTasks(prev => prev.map(x => x.id === t.id ? updated : x))
      toast('Snoozed to tomorrow')
    } catch { toast('Could not snooze') }
  }
  async function killTask(t: Task) {
    try {
      await tasksDb.remove(t.id) // hard delete, no confirm (locked decision)
      setTasks(prev => prev.filter(x => x.id !== t.id))
      toast('Deleted')
    } catch { toast('Could not delete') }
  }
  // ── Home cockpit: focused "work" dive ───────────────────────────────
  const [work, setWork] = useState<WorkTarget | null>(null)
  const [entered, setEntered] = useState(false)         // drives the dive/surface animation
  const [krNoteId, setKrNoteId] = useState<string | null>(null) // selected note in the KR shelf
  const [editorFull, setEditorFull] = useState(false)   // editor focus / KR expand-to-spine
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [krActionInput, setKrActionInput] = useState('')
  const [deckAddKR, setDeckAddKR] = useState<string | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function dive(t: WorkTarget) {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    setWork(t); setKrNoteId(null); setEditorFull(false); setLinkPickerOpen(false); setLinkQuery('')
    // double-rAF: let the just-mounted work layer paint hidden, then animate in.
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function surface() {
    setEntered(false)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setWork(null), 240)
  }
  useEffect(() => {
    if (!work) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (linkPickerOpen) setLinkPickerOpen(false); else surface()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [work, linkPickerOpen])

  // Pinned-first, then most-recent (mirrors Notes' byPinnedThenUpdated).
  const byPinned = (a: Note, b: Note) => {
    const ap = a.pinned_at ? 1 : 0, bp = b.pinned_at ? 1 : 0
    if (ap !== bp) return bp - ap
    if (a.pinned_at && b.pinned_at) return a.pinned_at > b.pinned_at ? -1 : 1
    return a.updated_at > b.updated_at ? -1 : 1
  }
  const shortDate = (iso: string) => {
    const d = new Date(iso); const now = new Date()
    if (d.toDateString() === now.toDateString()) return 'today'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Note persistence (stable identities — NoteEditor flushes on these). Mirrors Notes.tsx.
  const onUpdateNote = useCallback(async (id: string, patch: Partial<Note>) => {
    try {
      const updated = await notesDb.update(id, patch)
      setNotes(prev => prev.map(n => n.id === id ? updated : n))
    } catch { toast('Could not save note') }
  }, [setNotes, toast])
  const onSetNoteTags = useCallback(async (id: string, t: string[]) => {
    try {
      await notesDb.setTags(id, t)
      setTagsByNote(prev => { const next = new Map(prev); if (t.length === 0) next.delete(id); else next.set(id, t); return next })
    } catch { toast('Could not update tags') }
  }, [setTagsByNote, toast])
  const onDeleteNote = useCallback(async (id: string) => {
    try {
      await notesDb.remove(id)
      void deleteAllMediaForNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      setTagsByNote(prev => { const next = new Map(prev); next.delete(id); return next })
    } catch { toast('Could not delete note'); return }
    if (work?.kind === 'note') surface(); else setKrNoteId(null)
  }, [setNotes, setTagsByNote, toast, work])
  const openNoteByTitle = useCallback((rawTitle: string) => {
    const t = rawTitle.trim().toLowerCase(); if (!t) return
    const target = notes.find(n => (n.title || '').trim().toLowerCase() === t)
    if (!target) { toast(`No note titled "${rawTitle.trim()}"`); return }
    dive({ kind: 'note', id: target.id })
  }, [notes, toast])

  async function linkNoteToKR(noteId: string, krId: string) {
    try {
      const u = await notesDb.setRoadmapItem(noteId, krId)
      setNotes(prev => prev.map(n => n.id === noteId ? u : n))
      setKrNoteId(noteId); setLinkPickerOpen(false)
    } catch { toast('Could not link note') }
  }
  async function createNoteForKR(kr: RoadmapItem) {
    try {
      const created = await notesDb.create({ space_id: kr.space_id, roadmap_item_id: kr.id, title: '' })
      setNotes(prev => [...prev, created]); setKrNoteId(created.id); setLinkPickerOpen(false)
    } catch { toast('Could not create note') }
  }
  async function addKRAction(kr: RoadmapItem) {
    const t = krActionInput.trim(); if (!t) return
    try {
      const created = await actionsDb.create({ roadmap_item_id: kr.id, title: t, week_start: null })
      setActions(prev => [...prev, created]); setKrActionInput(''); setDeckAddKR(null)
    } catch { toast('Could not add action') }
  }
  async function scheduleAction(a: WeeklyAction, week: string) {
    setActions(prev => prev.map(x => x.id === a.id ? { ...x, week_start: week } : x))
    try { await actionsDb.update(a.id, { week_start: week }) }
    catch { toast('Could not schedule'); setActions(prev => prev.map(x => x.id === a.id ? a : x)) }
  }
  async function unscheduleAction(a: WeeklyAction) {
    setActions(prev => prev.map(x => x.id === a.id ? { ...x, week_start: null } : x))
    try { await actionsDb.update(a.id, { week_start: null }) }
    catch { toast('Could not move to backlog'); setActions(prev => prev.map(x => x.id === a.id ? a : x)) }
  }
  // ── Files on the KR (Drive-backed) ──
  const driveApiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY
  async function trackFileForKR(kr: RoadmapItem) {
    if (!driveGranted) { toast('Connect Drive first — Settings › Google & Drive'); return }
    if (!driveApiKey) { toast('File picking needs a Google API key in Vercel'); return }
    setFileBusy(true)
    try {
      const tracked = await trackViaPicker({ apiKey: driveApiKey, spaceId: kr.space_id, roadmapItemId: kr.id })
      if (tracked.length === 0) return
      setTrackedFiles(prev => {
        const ids = new Set(tracked.map(f => f.id))
        return [...tracked, ...prev.filter(t => !ids.has(t.id))]
      })
      toast(`Tracked ${tracked.length} file${tracked.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast(e instanceof Error && e.message ? `Could not track: ${e.message}` : 'Could not open the file picker')
    } finally {
      setFileBusy(false)
    }
  }
  async function unlinkFileFromKR(f: TrackedFile) {
    setTrackedFiles(prev => prev.map(t => t.id === f.id ? { ...t, roadmap_item_id: null } : t))
    try { await filesDb.update(f.id, { roadmap_item_id: null }) }
    catch { toast('Could not unlink'); setTrackedFiles(prev => prev.map(t => t.id === f.id ? f : t)) }
  }


  const headerSub = isCurrentWeek
    ? `${fmtRange(weekMonday)} · ${DOW_FULL[(new Date().getDay() + 6) % 7]} ${dayPart(new Date().getHours())}`
    : `${fmtRange(weekMonday)}`

  return (
    <div className={`home-deck stage${entered ? ' work-on' : ''}`}>
      <div className="layer survey">
      {/* header */}
      <div className="hd-row">
        <h1>{isCurrentWeek ? 'This week' : 'Week of'} <span className="sub">{headerSub}</span></h1>
        <div className="wknav">
          <button onClick={() => setWeekMonday(w => addWeeks(w, -1))} title="Previous week">‹</button>
          {!isCurrentWeek && <button className="today" onClick={() => setWeekMonday(getMonday())} title="This week">●</button>}
          <button onClick={() => setWeekMonday(w => addWeeks(w, 1))} title="Next week">›</button>
        </div>
      </div>

      {/* quote */}
      <div className="quote">
        <span className="mark">“</span>
        <span className="q">{quote.text}</span>
        <span className="by">— {quote.author}</span>
      </div>

      {/* shape of the week */}
      <div className="ribhead">
        <span className="label">Shape of the week</span>
        <span className="cap">meetings · all-day / holidays{googleConnected ? ' · from your calendars' : ''}</span>
        {!googleConnected && <span className="connect" onClick={onOpenCalendar}>Connect Google ↗</span>}
      </div>
      <div className="ribwrap">
        <div className="grid7">
          {nowLeftPct != null && (
            <div className="nowline" style={{ left: `${nowLeftPct}%` }}>
              <span className="nowcap">now</span><span className="nowdot" />
            </div>
          )}
          {weekDates.map((date, i) => {
            const isToday = date === todayStr
            const mtgs = busyByDate.get(date) ?? []
            const ads = allDayByDate.get(date) ?? []
            const MAX_M = 4, MAX_A = 2
            return (
              <div key={date} className={`day${isToday ? ' today' : ''}`}>
                <div className="dtop">
                  <span className="dname">{DOW[i]}{isToday ? ' · today' : ''}</span>
                  <span className="dnum">{parseDateLocal(date).getDate()}</span>
                </div>
                {ads.slice(0, MAX_A).map(e => (
                  <div key={e.id} className={`allday${/holiday/i.test(e.title) ? ' holiday' : ' ev'}`} title={e.title}>{e.title}</div>
                ))}
                {ads.length > MAX_A && <div className="dmore">+{ads.length - MAX_A} all-day</div>}
                {mtgs.slice(0, MAX_M).map(e => (
                  <div key={e.id} className="mtg" title={e.title}>
                    <span className="mdot" />
                    <span className="mt">{e.title}</span>
                    <span className="tm">{fmtMin(e.startMinute)}</span>
                  </div>
                ))}
                {mtgs.length > MAX_M && <div className="dmore">+{mtgs.length - MAX_M} more</div>}
              </div>
            )
          })}
        </div>
      </div>

      {/* space filter — narrows the board below (key actions, tasks, overdue, habits; not the ribbon) */}
      <div className="spacefilter">
        <button className={`spchip${spaceFilter === null ? ' on' : ''}`} onClick={() => setSpaceFilter(null)}>All</button>
        {orderedSpaces.map(sp => (
          <button
            key={sp.id}
            className={`spchip${spaceFilter === sp.id ? ' on' : ''}`}
            onClick={() => setSpaceFilter(prev => prev === sp.id ? null : sp.id)}
          >
            <span className="dot" style={{ background: spaceDisplayColor(sp) }} />{sp.name}
          </button>
        ))}
      </div>

      {/* body */}
      <div className="hd-body">
        {/* LEFT: KR board — the working backbone */}
        <section>
          {metricKRs.length > 0 && (
            <div className="kb-metrics">
              <div className="kb-band" style={{ marginTop: 4 }}><span className="label">Key metrics</span><span className="kb-hr" /></div>
              <div className="kb-mgrid">
                {metricKRs.map(kr => (
                  <MetricKPICard key={kr.id} kr={kr} checkins={metricCheckins} onTap={() => onLogMetric(kr.id)} />
                ))}
              </div>
            </div>
          )}
          <div className="kb-head">
            <span className="label">Key results · {spaceFilter ? (spaceById.get(spaceFilter)?.name ?? 'space') : 'all spaces'}</span>
            <div className="kb-headright">
              <div className="kb-qseg">
                <button className={quarterScope === 'current' ? 'on' : ''} onClick={() => setQuarterScope('current')}>This quarter</button>
                <button className={quarterScope === 'all' ? 'on' : ''} onClick={() => setQuarterScope('all')}>All</button>
              </div>
              <span className="kb-sum">
                {krBoard.inMotion.length > 0
                  ? <><b>{krBoard.inMotion.length}</b> in motion · {krBoard.totalKRs} active</>
                  : <>{krBoard.totalKRs} active key result{krBoard.totalKRs === 1 ? '' : 's'}</>}
              </span>
            </div>
          </div>

          {/* band — in motion this week */}
          <div className="kb-band"><span className="label">In motion this week</span><span className="kb-hr" /></div>
          {krBoard.inMotion.length === 0 ? (
            <div className="kb-hint">
              <span className="ic">◇</span>
              <span><b>Nothing scheduled this week yet.</b> Pull a key result into motion below — tap <span className="kb-mono">▸ this week</span> on a backlog item, or add an action.</span>
            </div>
          ) : krBoard.inMotion.map(({ kr, thisWeek, backlog }) => {
            const tone = healthTone(kr.health_status)
            const mc = kr.is_metric ? latestMetricByKR.get(kr.id) : null
            return (
              <div key={kr.id} className="kb-card">
                <div className="kb-top" style={{ borderLeftColor: colorForSpace(kr.space_id) }} onClick={() => dive({ kind: 'kr', id: kr.id })} title="Open this KR">
                  <span className="dot" style={{ background: colorForSpace(kr.space_id) }} />
                  <div className="kb-grow">
                    <div className="kb-name">{kr.title}</div>
                    <div className="kb-obj">{objById.get(kr.annual_objective_id ?? '')?.name ?? ''}</div>
                  </div>
                  {mc && <span className="kb-metric"><b>{fmtMetric(mc.value, kr.metric_unit)}</b></span>}
                  <span className={`kb-hpill ${tone.cls}`}><span className="pd" />{tone.label}</span>
                  <span className="kb-chev">›</span>
                </div>
                <div className="kb-actions" onClick={e => e.stopPropagation()}>
                  <div className="kb-asec">This week</div>
                  {thisWeek.map(a => (
                    <div key={a.id} className={`kb-arow${a.completed ? ' done' : ''}`}>
                      <button className={`kb-cb${a.completed ? ' done' : ''}`} onClick={() => toggleAction(a)} title={a.completed ? 'Mark not done' : 'Mark done'}>{a.completed ? '✓' : ''}</button>
                      <span className="kb-atitle">{a.title}</span>
                      {!a.completed && <button className="kb-sched" onClick={() => unscheduleAction(a)} title="Move to backlog">backlog</button>}
                    </div>
                  ))}
                  {backlog.length > 0 && <div className="kb-asec">Backlog · {backlog.length}</div>}
                  {backlog.map(a => (
                    <div key={a.id} className="kb-arow">
                      <button className="kb-cb" onClick={() => toggleAction(a)} title="Mark done" />
                      <span className="kb-atitle">{a.title}</span>
                      <button className="kb-sched pri" onClick={() => scheduleAction(a, weekMonday)} title="Schedule for this week">▸ this week</button>
                    </div>
                  ))}
                  {deckAddKR === kr.id ? (
                    <div className="kb-addrow">
                      <input autoFocus value={krActionInput} onChange={e => setKrActionInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addKRAction(kr); if (e.key === 'Escape') { setDeckAddKR(null); setKrActionInput('') } }}
                        placeholder="+ Add an action (lands in backlog)…" />
                    </div>
                  ) : (
                    <button className="kb-addbtn" onClick={() => { setDeckAddKR(kr.id); setKrActionInput('') }}>+ Add an action</button>
                  )}
                </div>
              </div>
            )
          })}

          {/* band — all key results, grouped by objective */}
          <div className="kb-band"><span className="label">All key results</span><span className="kb-hr" /></div>
          {krBoard.groups.length === 0 ? (
            <div className="empty">No active key results{spaceFilter ? ' in this space' : ''} yet.</div>
          ) : krBoard.groups.map(({ obj, krs }) => (
            <div key={obj.id} className="kb-objgrp">
              <div className="kb-objhead">
                <span className="dot" style={{ background: colorForSpace(obj.space_id) }} />
                <span className="kb-oname">{obj.name}</span>
                {spaceFilter === null && <span className="kb-ocrumb">{spaceById.get(obj.space_id)?.name ?? ''}</span>}
                <span className="kb-obar" />
              </div>
              {krs.map(({ kr, thisWeek, backlog }) => {
                const tone = healthTone(kr.health_status)
                const mc = kr.is_metric ? latestMetricByKR.get(kr.id) : null
                const openTW = thisWeek.filter(a => !a.completed).length
                return (
                  <div key={kr.id} className="kb-krwrap">
                    <div className={`kb-krrow${thisWeek.length > 0 ? ' inmotion' : ''}`} onClick={() => dive({ kind: 'kr', id: kr.id })} title="Open this KR">
                      <span className="dot" style={{ background: colorForSpace(kr.space_id) }} />
                      <span className="kb-kt">{kr.title}</span>
                      {mc && <span className="kb-metric"><b>{fmtMetric(mc.value, kr.metric_unit)}</b></span>}
                      <span className={`kb-hpill ${tone.cls}`}><span className="pd" />{tone.label}</span>
                      <span className="kb-meta">
                        {thisWeek.length > 0 && <span className="on">in motion · {openTW > 0 ? openTW : thisWeek.length}</span>}
                        {thisWeek.length > 0 && backlog.length > 0 && <span> · </span>}
                        {backlog.length > 0 && <span>backlog {backlog.length}</span>}
                        {thisWeek.length === 0 && backlog.length === 0 && <span>—</span>}
                      </span>
                      <button className="kb-add" onClick={e => { e.stopPropagation(); setDeckAddKR(kr.id); setKrActionInput('') }}>+ action</button>
                      <span className="kb-chev">›</span>
                    </div>
                    {deckAddKR === kr.id && (
                      <div className="kb-addrow rowadd">
                        <input autoFocus value={krActionInput} onChange={e => setKrActionInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addKRAction(kr); if (e.key === 'Escape') { setDeckAddKR(null); setKrActionInput('') } }}
                          placeholder="+ Add an action (lands in backlog)…" />
                      </div>
                    )}
                    {/* Backlog items show inline under their KR here (in-motion KRs
                        already list everything in the top card, so skip those). */}
                    {thisWeek.length === 0 && backlog.length > 0 && (
                      <div className="kb-sub">
                        {backlog.map(a => (
                          <div key={a.id} className="kb-arow">
                            <button className="kb-cb" onClick={() => toggleAction(a)} title="Mark done" />
                            <span className="kb-atitle">{a.title}</span>
                            <button className="kb-sched pri" onClick={() => scheduleAction(a, weekMonday)} title="Schedule for this week">▸ this week</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </section>

        {/* RIGHT rail */}
        <aside>
          {/* tasks due */}
          <div className="card">
            <div className="chead">
              <span><span className="label">Tasks due this week</span><span className="n">{dueThisWeek.length}</span></span>
            </div>
            {dueThisWeek.length === 0 ? (
              <div className="empty sm">Nothing due this week.</div>
            ) : <>
              {dueThisWeek.slice(0, 5).map(t => (
                <div key={t.id} className="trow">
                  <button className="cb" onClick={() => toggleTask(t)} title="Complete" />
                  <span className="dot" style={{ background: colorForSpace(t.space_id) }} />
                  <span className="tt">{t.title}</span>
                  <span className="tday">{shortDow(t.due_date!)}</span>
                </div>
              ))}
              {dueThisWeek.length > 5 && (
                <div className="more"><span className="link" onClick={onOpenTasks}>+{dueThisWeek.length - 5} more · open in Tasks ↗</span></div>
              )}
            </>}
          </div>

          {/* habits */}
          {habitKRs.length > 0 && (
            <div className="card">
              <div className="chead"><span className="label">Habits</span></div>
              <div className="hhead"><span /> {DOW.map((d, i) => <span key={i}>{d[0]}</span>)}</div>
              {habitKRs.map(kr => (
                <div key={kr.id} className="habit">
                  <span className="hn"><span className="dot" style={{ background: colorForSpace(kr.space_id) }} />{kr.title}</span>
                  {weekDates.map((date, i) => {
                    const hit = checkinSet.has(`${kr.id}:${date}`)
                    const isToday = date === todayStr
                    return <button key={i} className={`hc${hit ? ' hit' : ''}${isToday ? ' today' : ''}`} onClick={() => toggleHabit(kr.id, date)} title={`${kr.title} · ${date}`} />
                  })}
                </div>
              ))}
            </div>
          )}

          {/* notes (contextual) */}
          <div className="card">
            <div className="chead">
              <span className="label">Recent notes</span>
            </div>
            {recentNotes.length === 0 ? (
              <div className="notes-empty">No notes yet. Open a KR to start one.</div>
            ) : recentNotes.map(n => (
              <div key={n.id} className="note" onClick={() => dive({ kind: 'note', id: n.id })}>
                <span className="ntitle">{n.title?.trim() || 'Untitled'}</span>
                {(() => { const p = extractNoteText(n.body).slice(0, 80); return p ? <div className="nprev">{p}</div> : null })()}
              </div>
            ))}
          </div>

          {/* weekly close — passive, all-spaces; appears only when a close is due */}
          {anyOpen && (
            <div className="card closecard">
              <div className="chead"><span className="label">Weekly close</span></div>
              <div className="cs-chips">
                {closeRows.map(({ sp, wk, open, overdue }) => open ? (
                  <button key={sp.id} className={`cs-chip${overdue ? ' late' : ''}`} onClick={() => onCloseWeek(sp.id, wk)} title={`Close week of ${fmtRange(wk)}`}>
                    <span className="dot" style={{ background: spaceDisplayColor(sp) }} />{sp.name}
                    <span className="cs-act">{overdue ? 'overdue →' : 'close →'}</span>
                  </button>
                ) : (
                  <span key={sp.id} className="cs-chip done">
                    <span className="dot" style={{ background: spaceDisplayColor(sp) }} />{sp.name}
                    <span className="cs-ok">✓</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* needs attention — below the fold, overdue tasks only */}
      {overdue.length > 0 && (
        <div className="attn">
          <div className="ahead"><span className="label">Needs attention</span><span className="cap">overdue tasks only</span></div>
          {overdue.map(t => (
            <div key={t.id} className="arow">
              <button className="cb" onClick={() => toggleTask(t)} title="Complete" />
              <span className="dot" style={{ background: colorForSpace(t.space_id) }} />
              <span className="at">{t.title}</span>
              <span className="od">{daysBetween(t.due_date!, todayStr)}d overdue</span>
              <span className="acts">
                <button className="abtn" onClick={() => backlogTask(t)}>Backlog</button>
                <button className="abtn" onClick={() => snoozeTask(t)}>Snooze</button>
                <button className="abtn kill" onClick={() => killTask(t)}>Kill</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* FAB deferred — the global FastCapture + already occupies this corner;
          Home's 4-way quick-add (task/action/note/event) lands in the FAB
          follow-up, reconciled with FastCapture rather than stacked on it. */}
      </div>{/* /layer.survey */}

      {work && (() => {
        const workKR = work.kind === 'kr' ? krById.get(work.id) ?? null : null
        const workNote = work.kind === 'note' ? notes.find(n => n.id === work.id) ?? null : null
        const workTask = work.kind === 'task' ? tasks.find(t => t.id === work.id) ?? null : null
        const crumbSpace = (sid: string | null | undefined) => sid ? (spaceById.get(sid)?.name ?? 'Space') : 'Inbox'
        const breadcrumb = workKR ? `${crumbSpace(workKR.space_id)}  ›  Key result`
          : workNote ? `${crumbSpace(workNote.space_id)}  ›  Note`
          : workTask ? `${crumbSpace(workTask.space_id)}  ›  Task` : ''

        return (
          <div className="layer workview">
            <div className="cw-back">
              <button className="cw-backbtn" onClick={surface}><span className="chev">‹</span> Back to deck</button>
              <span className="cw-crumb">{breadcrumb}</span>
            </div>

            {/* ── KR work view ── reference shelf · editor · tasks ── */}
            {workKR && (() => {
              const kr = workKR
              const col = colorForSpace(kr.space_id)
              const krNotesList = notes.filter(n => n.roadmap_item_id === kr.id).sort(byPinned)
              const sel = krNotesList.find(n => n.id === krNoteId) ?? krNotesList[0] ?? null
              const wkActions = actions.filter(a => a.roadmap_item_id === kr.id && a.week_start === weekMonday)
              const backlogActions = actions.filter(a => a.roadmap_item_id === kr.id && a.week_start == null && !a.completed)
              const linkedTasks = tasks.filter(t => t.roadmap_item_id === kr.id && !t.parent_task_id)
              const krFiles = trackedFiles.filter(f => f.roadmap_item_id === kr.id && !f.archived)
              return (
                <section className="cw-pane">
                  <div className="cw-head">
                    <span className="cw-kdot" style={{ background: col }} />
                    <div className="cw-htext">
                      <span className="cw-keyb">{crumbSpace(kr.space_id)} · Key result</span>
                      <span className="cw-ktitle">{kr.title}</span>
                    </div>
                    {kr.health_status === 'off_track' && <span className="cw-chip off">off track</span>}
                    {kr.health_status === 'blocked' && <span className="cw-chip blocked">blocked</span>}
                  </div>
                  <div className={`cw-split${editorFull ? ' expanded' : ''}`}>
                    {/* reference shelf */}
                    <div className="cw-shelf">
                      <div className="cw-shelf-head"><span className="cw-lbl">Notes</span><span className="cw-n">· {krNotesList.length} linked</span></div>
                      <div className="cw-shelf-acts">
                        <button className="cw-sb pri" onClick={() => createNoteForKR(kr)}>+ New</button>
                        <button className="cw-sb" onClick={() => { setLinkPickerOpen(true); setLinkQuery('') }}>Link a note</button>
                      </div>
                      <div className="cw-shelf-scroll">
                        {krNotesList.length === 0 && <div className="cw-shelf-empty">No notes yet. Start one with <b>+ New</b>, or link an existing note.</div>}
                        {krNotesList.map(n => {
                          const prev = extractNoteText(n.body).slice(0, 70)
                          return (
                            <button key={n.id} className={`cw-nrow${sel?.id === n.id ? ' on' : ''}`} onClick={() => setKrNoteId(n.id)}>
                              <div className="cw-nr-top">
                                {n.pinned_at && <span className="cw-pin">📌</span>}
                                <span className="cw-nr-title" data-initial={(n.title || 'U').trim().slice(0, 1).toUpperCase() || 'U'}>{n.title?.trim() || 'Untitled'}</span>
                                <span className="cw-nr-date">{shortDate(n.updated_at)}</span>
                              </div>
                              {prev && <div className="cw-nr-prev">{prev}</div>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    {/* editor */}
                    <div className="cw-editor">
                      {sel ? (
                        <NoteEditor key={sel.id} note={sel} tags={tagsByNote.get(sel.id) ?? []}
                          spaces={spaces} roadmapItems={roadmapItems} notebooks={notebooks}
                          fullscreen={editorFull} onToggleFullscreen={() => setEditorFull(v => !v)}
                          onPatch={p => onUpdateNote(sel.id, p)} onSetTags={t => onSetNoteTags(sel.id, t)}
                          onOpenNoteByTitle={openNoteByTitle} onDelete={() => onDeleteNote(sel.id)} />
                      ) : (
                        <div className="cw-noeditor">
                          <p>No notes linked to this KR yet.</p>
                          <button className="cw-sb pri" onClick={() => createNoteForKR(kr)}>+ New note for this KR</button>
                        </div>
                      )}
                    </div>
                    {/* tasks */}
                    <div className="cw-tasks">
                      <div className="cw-tasks-sec"><span className="cw-lbl">This week’s actions</span></div>
                      {wkActions.length === 0 && <div className="cw-tasks-empty">Nothing scheduled this week. Pull from the backlog below.</div>}
                      {wkActions.map(a => (
                        <div key={a.id} className={`cw-trow${a.completed ? ' done' : ''}`} onClick={() => toggleAction(a)}>
                          <span className={`cw-cb${a.completed ? ' done' : ''}`}>{a.completed ? '✓' : ''}</span>
                          <span className="cw-tt">{a.title}</span>
                          {!a.completed && <button className="cw-sched" title="Move to backlog" onClick={e => { e.stopPropagation(); unscheduleAction(a) }}>backlog</button>}
                        </div>
                      ))}

                      <div className="cw-tasks-sec brd"><span className="cw-lbl">Backlog</span>{backlogActions.length > 0 && <span className="cw-n"> · {backlogActions.length}</span>}</div>
                      {backlogActions.map(a => (
                        <div key={a.id} className="cw-trow" onClick={() => toggleAction(a)}>
                          <span className="cw-cb" />
                          <span className="cw-tt">{a.title}</span>
                          <button className="cw-sched pri" title="Schedule for this week" onClick={e => { e.stopPropagation(); scheduleAction(a, weekMonday) }}>▸ this week</button>
                        </div>
                      ))}
                      <div className="cw-add">
                        <input value={krActionInput} onChange={e => setKrActionInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addKRAction(kr) }}
                          placeholder="+ Add an action (lands in backlog)…" />
                      </div>

                      <div className="cw-tasks-sec brd"><span className="cw-lbl">Linked tasks</span></div>
                      {linkedTasks.length === 0 && <div className="cw-tasks-empty">No linked tasks.</div>}
                      {linkedTasks.map(t => (
                        <div key={t.id} className={`cw-trow${t.completed_at ? ' done' : ''}`} onClick={() => toggleTask(t)}>
                          <span className={`cw-cb${t.completed_at ? ' done' : ''}`}>{t.completed_at ? '✓' : ''}</span>
                          <span className="cw-tt">{t.title}</span>
                        </div>
                      ))}

                      {/* files */}
                      <div className="cw-tasks-sec brd">
                        <span className="cw-lbl">Files</span>
                        {krFiles.length > 0 && <span className="cw-n"> · {krFiles.length}</span>}
                      </div>
                      {krFiles.length === 0 && <div className="cw-tasks-empty">No files linked. Track a client document below.</div>}
                      {krFiles.map(f => (
                        <div key={f.id} className="cw-frow">
                          <span className="cw-fglyph">{fileGlyph(f.mime_type)}</span>
                          <span className="cw-ft" title={f.name || 'Untitled'}>{f.name || 'Untitled'}</span>
                          <span className={`cw-fstatus ${f.status}`}>{FILE_STATUS_LABEL[f.status] ?? f.status}</span>
                          <a className="cw-fopen" href={`https://drive.google.com/open?id=${f.drive_file_id}`} target="_blank" rel="noreferrer" title="Open in Drive">↗</a>
                          <button className="cw-funlink" onClick={() => unlinkFileFromKR(f)} title="Unlink from this KR">×</button>
                        </div>
                      ))}
                      <div className="cw-fileacts">
                        <button className="cw-sb pri" onClick={() => trackFileForKR(kr)} disabled={fileBusy}>
                          {fileBusy ? 'Opening…' : '+ Track a file'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {linkPickerOpen && (
                    <div className="cw-pickback" onClick={() => setLinkPickerOpen(false)}>
                      <div className="cw-picker" onClick={e => e.stopPropagation()}>
                        <div className="cw-pick-h">
                          <div className="t">Link a note to this KR</div>
                          <div className="s">Attach an existing note — e.g. meeting notes — to “{kr.title}”.</div>
                        </div>
                        <input className="cw-pick-search" autoFocus value={linkQuery} onChange={e => setLinkQuery(e.target.value)} placeholder="Search your notes…" />
                        <div className="cw-pick-list">
                          {(() => {
                            const cands = notes
                              .filter(n => n.roadmap_item_id !== kr.id)
                              .filter(n => { const q = linkQuery.trim().toLowerCase(); return !q || (n.title || '').toLowerCase().includes(q) })
                              .sort((a, b) => (a.updated_at > b.updated_at ? -1 : 1))
                              .slice(0, 40)
                            if (cands.length === 0) return <div className="cw-pick-empty">No notes to link.</div>
                            return cands.map(n => (
                              <div key={n.id} className="cw-pick-row" onClick={() => linkNoteToKR(n.id, kr.id)}>
                                <span className="cw-pdot" style={{ background: colorForSpace(n.space_id) }} />
                                <div className="cw-pt">
                                  <div className="pn">{n.title?.trim() || 'Untitled'}</div>
                                  <div className="pm">{crumbSpace(n.space_id)} · {shortDate(n.updated_at)}</div>
                                </div>
                                <span className="cw-plink">Link</span>
                              </div>
                            ))
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )
            })()}

            {/* ── Note work view ── editor full width ── */}
            {workNote && (
              <section className="cw-pane">
                <div className="cw-noteonly">
                  <NoteEditor key={workNote.id} note={workNote} tags={tagsByNote.get(workNote.id) ?? []}
                    spaces={spaces} roadmapItems={roadmapItems} notebooks={notebooks}
                    fullscreen={editorFull} onToggleFullscreen={() => setEditorFull(v => !v)}
                    onPatch={p => onUpdateNote(workNote.id, p)} onSetTags={t => onSetNoteTags(workNote.id, t)}
                    onOpenNoteByTitle={openNoteByTitle} onDelete={() => onDeleteNote(workNote.id)} />
                </div>
              </section>
            )}

            {/* ── Task work view ── detail ── */}
            {workTask && (() => {
              const t = workTask
              const tkr = t.roadmap_item_id ? krById.get(t.roadmap_item_id) ?? null : null
              const subtasks = tasks.filter(s => s.parent_task_id === t.id)
              const meta = [
                t.due_date ? `Due ${shortDate(t.due_date)}` : null,
                t.deadline_date ? `Deadline ${shortDate(t.deadline_date)}` : null,
                t.estimated_minutes ? `~${t.estimated_minutes}m` : null,
              ].filter(Boolean).join('  ·  ')
              return (
                <section className="cw-pane">
                  <div className="cw-head">
                    <span className="cw-kdot" style={{ background: colorForSpace(t.space_id) }} />
                    <div className="cw-htext">
                      <span className="cw-keyb">{crumbSpace(t.space_id)} · Task</span>
                      <span className="cw-ktitle">{t.title}</span>
                    </div>
                    <button className={`cw-complete${t.completed_at ? ' done' : ''}`} onClick={() => toggleTask(t)}>
                      {t.completed_at ? '✓ Completed' : 'Mark complete'}
                    </button>
                  </div>
                  <div className="cw-taskbody">
                    {meta && <div className="cw-banner">{meta}</div>}
                    {t.description && <><div className="cw-lbl">Description</div><p className="cw-desc">{t.description}</p></>}
                    {tkr && <>
                      <div className="cw-lbl">Linked KR</div>
                      <button className="cw-krlink" onClick={() => dive({ kind: 'kr', id: tkr.id })}>
                        <span className="cw-pdot" style={{ background: colorForSpace(tkr.space_id) }} />{tkr.title}
                      </button>
                    </>}
                    <div className="cw-lbl">Subtasks</div>
                    {subtasks.length === 0 && <div className="cw-tasks-empty">No subtasks.</div>}
                    {subtasks.map(s => (
                      <div key={s.id} className={`cw-trow${s.completed_at ? ' done' : ''}`} onClick={() => toggleTask(s)}>
                        <span className={`cw-cb${s.completed_at ? ' done' : ''}`}>{s.completed_at ? '✓' : ''}</span>
                        <span className="cw-tt">{s.title}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })()}
          </div>
        )
      })()}

      <style>{`
        .home-deck{max-width:1640px;margin:0 auto;padding:8px 4px 90px;}
        .home-deck .label{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--nw-label);}
        .home-deck .muted{color:var(--navy-400);}
        .home-deck .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block;}
        .home-deck .empty{color:var(--navy-400);font-size:13px;padding:14px 4px;}
        .home-deck .empty.sm{padding:8px 4px;font-size:12px;}

        .hd-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
        .hd-row h1{margin:0;font-family:var(--font-display);font-size:28px;font-weight:700;letter-spacing:-.02em;display:flex;align-items:baseline;gap:13px;color:var(--navy-50);}
        .hd-row h1 .sub{font-size:14.5px;font-weight:500;color:var(--navy-400);letter-spacing:0;}
        .wknav button{width:36px;height:36px;border-radius:50%;background:var(--navy-800);border:1px solid var(--navy-600);color:var(--navy-200);font-size:15px;cursor:pointer;margin-left:8px;}
        .wknav button.today{font-size:9px;color:var(--accent);}
        .spacefilter{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 18px;}
        .spchip{display:inline-flex;align-items:center;gap:8px;padding:6px 13px;border-radius:999px;font-size:13px;font-family:inherit;background:var(--surface-2);color:var(--navy-200);border:1px solid var(--line);cursor:pointer;}
        .spchip:hover{border-color:var(--accent);}
        .spchip.on{border-color:var(--accent);background:var(--accent-dim);color:var(--navy-50);}
        .cs-chips{display:flex;gap:8px;flex-wrap:wrap;}
        .cs-chip{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;font-size:13px;font-family:inherit;border:1px solid var(--line);background:var(--surface-2);color:var(--navy-100);}
        button.cs-chip{cursor:pointer;}
        button.cs-chip:hover{border-color:var(--accent);}
        .cs-chip .cs-act{font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);}
        .cs-chip.late{border-color:var(--nw-caution-text,#f5b840);}
        .cs-chip.late .cs-act{color:var(--nw-caution-text,#f5b840);}
        .cs-chip.done{color:var(--navy-400);}
        .cs-chip.done .cs-ok{color:var(--nw-nominal-text,#7fe27a);font-weight:700;}

        .quote{position:relative;margin:18px 0 23px;padding:7px 0 7px 25px;border-left:3px solid var(--line-2);display:flex;align-items:center;justify-content:space-between;gap:20px;}
        .quote .mark{position:absolute;left:9px;top:-10px;font-size:35px;color:var(--line-strong);font-family:Georgia,serif;}
        .quote .q{font-size:22px;font-style:italic;color:var(--nw-cream);font-family:Georgia,'Times New Roman',serif;}
        .quote .by{font-family:var(--font-mono);font-size:13.5px;letter-spacing:.02em;color:var(--navy-300);white-space:nowrap;}

        .ribhead{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;}
        .ribhead .cap{font-size:12px;color:var(--navy-400);}
        .ribhead .connect{font-size:12px;color:var(--accent);cursor:pointer;margin-left:auto;}
        .ribwrap{border:1px solid var(--line);border-radius:14px;background:var(--navy-900);overflow:hidden;margin-bottom:24px;box-shadow:var(--card-shadow);}
        [data-theme="light"] .ribwrap{background:var(--surface);border-color:var(--line-2);}
        [data-theme="light"] .day{border-right-color:var(--line-2);}
        .grid7{position:relative;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));}
        .day{border-right:1px solid var(--line);padding:12px 13px 16px;min-height:122px;display:flex;flex-direction:column;gap:6px;}
        .day:last-child{border-right:none;}
        .day.today{background:rgba(74,143,255,.06);}
        .dtop{display:flex;align-items:baseline;justify-content:space-between;}
        .dname{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--navy-400);}
        .day.today .dname{color:var(--accent);font-weight:700;}
        .dnum{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:19px;font-weight:600;color:var(--navy-200);line-height:1;}
        .day.today .dnum{color:var(--accent);}
        .mtg{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--navy-200);}
        .mtg .mdot{width:6px;height:6px;border-radius:50%;background:var(--navy-500);flex-shrink:0;}
        .mtg .mt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .mtg .tm{font-family:var(--font-mono);color:var(--navy-400);font-variant-numeric:tabular-nums;flex-shrink:0;}
        .allday{font-size:11px;padding:3px 8px;border-radius:6px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid transparent;}
        .allday.ev{background:var(--accent-bg);color:var(--accent);border-color:var(--accent-line);}
        .allday.holiday{background:var(--warn-bg);color:var(--warn);border-color:var(--warn-bg);}
        .dmore{font-size:11px;color:var(--navy-400);padding:1px 0 0 2px;}

        .nowline{position:absolute;top:0;bottom:0;width:2px;background:#e8c060;box-shadow:0 0 8px rgba(232,192,96,.5);z-index:5;pointer-events:none;}
        .nowcap{position:absolute;top:0;left:50%;transform:translateX(-50%);background:#e8c060;color:#1a1406;font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.1em;padding:2px 6px;border-radius:0 0 5px 5px;text-transform:uppercase;}
        .nowdot{position:absolute;top:-3px;left:50%;width:7px;height:7px;border-radius:50%;background:#e8c060;transform:translateX(-50%);box-shadow:0 0 8px rgba(232,192,96,.5);}

        .hd-body{display:grid;grid-template-columns:1fr 380px;gap:26px;align-items:start;}
        @media (max-width:1100px){.hd-body{grid-template-columns:1fr;}}

        .kb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:14px;flex-wrap:wrap;}
        .kb-mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px;margin-bottom:8px;}
        .kb-headright{display:flex;align-items:center;gap:14px;}
        .kb-qseg{display:inline-flex;border:1px solid var(--line-2);border-radius:99px;overflow:hidden;}
        .kb-qseg button{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.04em;padding:5px 12px;background:var(--surface);color:var(--navy-400);border:none;cursor:pointer;}
        .kb-qseg button.on{background:var(--accent-bg);color:var(--accent-2);}
        .kb-sum{font-family:var(--font-mono);font-size:11px;color:var(--navy-400);font-variant-numeric:tabular-nums;}
        .kb-sum b{color:var(--nw-nominal-text,#7fe27a);font-weight:600;}
        .kb-band{display:flex;align-items:center;gap:10px;margin:22px 0 12px;}
        .kb-band:first-of-type{margin-top:8px;}
        .kb-hr{flex:1;height:1px;background:var(--line);}
        .kb-mono{font-family:var(--font-mono);color:var(--accent);}

        /* in-motion KR card */
        .kb-card{border:1px solid var(--line-2);border-radius:14px;background:var(--surface);margin-bottom:12px;overflow:hidden;}
        .kb-top{display:flex;align-items:center;gap:11px;padding:13px 16px;cursor:pointer;border-left:3px solid transparent;}
        .kb-top:hover{background:var(--hover);}
        .kb-grow{flex:1;min-width:0;}
        .kb-name{font-family:var(--font-display);font-size:15.5px;font-weight:600;color:var(--nw-cream);line-height:1.3;}
        .kb-obj{font-size:11px;color:var(--navy-400);margin-top:1px;}
        .kb-chev{color:var(--navy-500);font-size:20px;font-weight:300;flex-shrink:0;}
        .kb-top:hover .kb-chev,.kb-krrow:hover .kb-chev{color:var(--accent);}
        .kb-actions{padding:2px 16px 8px;border-top:1px solid var(--line);}
        .kb-asec{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--nw-label-dim);padding:9px 0 4px;}
        .kb-arow{display:flex;align-items:center;gap:10px;padding:5px 0;}
        .kb-cb{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--navy-500);flex-shrink:0;cursor:pointer;padding:0;
          display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:var(--navy-900);background:transparent;font-family:inherit;}
        .kb-cb.done{background:var(--nw-nominal-text,#7fe27a);border-color:var(--nw-nominal-text,#7fe27a);}
        .kb-atitle{flex:1;font-size:13.5px;color:var(--navy-100);}
        .kb-arow.done .kb-atitle{color:var(--navy-500);text-decoration:line-through;}
        .kb-sched{flex-shrink:0;font-family:var(--font-mono);font-size:10px;font-weight:600;padding:3px 9px;border-radius:6px;
          border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-400);cursor:pointer;opacity:0;transition:opacity .12s;}
        .kb-arow:hover .kb-sched{opacity:1;}
        .kb-sched.pri{opacity:1;border-color:var(--accent);background:var(--accent-dim);color:var(--accent);}
        .kb-addrow{padding:7px 0 4px;}
        .kb-addrow input{width:100%;background:var(--surface-2);border:1px solid var(--line-2);border-radius:8px;
          padding:7px 10px;color:var(--navy-100);font-family:inherit;font-size:12.5px;outline:none;}
        .kb-addrow input::placeholder{color:var(--navy-500);}
        .kb-addrow input:focus{border-color:var(--accent);}
        .kb-addrow.rowadd{padding:2px 0 8px 26px;}
        .kb-addbtn{font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--navy-400);background:none;border:none;
          cursor:pointer;padding:8px 0 4px;letter-spacing:.04em;}
        .kb-addbtn:hover{color:var(--accent);}

        /* health pill + metric readout */
        .kb-hpill{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
          padding:3px 8px;border-radius:99px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex-shrink:0;}
        .kb-hpill .pd{width:4px;height:4px;border-radius:99px;background:currentColor;}
        .kb-hpill.t-nominal{background:var(--nw-nominal-bg,#0a2014);color:var(--nw-nominal-text,#7fe27a);}
        .kb-hpill.t-alarm{background:var(--nw-alarm-bg,#2e0a08);color:var(--nw-alarm-text,#ff6452);}
        .kb-hpill.t-caution{background:var(--nw-caution-bg,#251a08);color:var(--nw-caution-text,#f5b840);}
        .kb-hpill.t-standby{background:var(--nw-standby-bg,#15191f);color:var(--nw-standby-text,#8e96a8);}
        .kb-metric{font-family:var(--font-mono);font-size:11px;color:var(--navy-300);flex-shrink:0;}
        .kb-metric b{color:var(--nw-cream);font-weight:600;font-size:13px;}

        /* in-motion empty hint */
        .kb-hint{border:1px dashed var(--line-strong);border-radius:12px;padding:15px 16px;color:var(--navy-400);font-size:13px;
          display:flex;align-items:center;gap:11px;background:var(--accent-bg);line-height:1.45;}
        .kb-hint .ic{font-size:18px;color:var(--accent-2);}
        .kb-hint b{color:var(--navy-100);font-weight:600;}

        /* all-KRs objective groups */
        .kb-objgrp{margin-bottom:6px;}
        .kb-objhead{display:flex;align-items:center;gap:9px;padding:14px 2px 8px;}
        .kb-oname{font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--navy-200);}
        .kb-ocrumb{font-size:11px;color:var(--navy-500);}
        .kb-obar{flex:1;height:1px;background:var(--line);}
        .kb-krwrap{margin-bottom:5px;}
        .kb-krrow{display:flex;align-items:center;gap:11px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;
          background:var(--surface);cursor:pointer;border-left:3px solid transparent;}
        .kb-krrow:hover{background:var(--hover);border-color:var(--line-2);}
        .kb-krrow.inmotion{border-left-color:var(--accent);}
        .kb-kt{flex:1;min-width:0;font-size:14px;color:var(--navy-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .kb-meta{font-family:var(--font-mono);font-size:10px;color:var(--navy-500);white-space:nowrap;flex-shrink:0;}
        .kb-meta .on{color:var(--accent-2);}
        .kb-add{opacity:0;transition:opacity .12s;font-family:var(--font-mono);font-size:10px;font-weight:600;
          padding:3px 8px;border-radius:6px;border:1px dashed var(--line-strong);background:transparent;color:var(--navy-400);cursor:pointer;flex-shrink:0;}
        .kb-krrow:hover .kb-add{opacity:1;}
        .kb-sub{padding:2px 0 6px 26px;}
        .kb-sub .kb-arow{padding:4px 0;}

        .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:var(--card-shadow);}
        .card + .card{margin-top:18px;}
        .chead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;}
        .chead .n{font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--navy-300);font-weight:700;margin-left:6px;font-size:12px;}
        .link{color:var(--accent);font-size:12px;cursor:pointer;}
        .trow{display:flex;align-items:center;gap:11px;padding:8px 2px;}
        .trow .cb{width:20px;height:20px;border-radius:50%;border:2px solid var(--line-strong);background:none;flex-shrink:0;cursor:pointer;}
        .trow .tt{flex:1;font-size:14px;color:var(--navy-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .trow .tday{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--nw-caution-text,#f5b840);flex-shrink:0;}
        .more{text-align:center;margin-top:8px;}

        .hhead{display:grid;grid-template-columns:1fr repeat(7,22px);gap:7px;margin:2px 0 8px;}
        .hhead span{font-family:var(--font-mono);font-size:10px;color:var(--navy-500);text-align:center;}
        .habit{display:grid;grid-template-columns:1fr repeat(7,22px);gap:7px;align-items:center;padding:6px 0;}
        .habit .hn{font-size:13.5px;color:var(--navy-200);display:flex;align-items:center;gap:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .hc{width:22px;height:22px;border-radius:50%;border:2px solid var(--line-strong);background:none;cursor:pointer;padding:0;}
        .hc.hit{background:var(--nw-nominal-text,#7fe27a);border-color:var(--nw-nominal-text,#7fe27a);}
        .hc.today{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-bg);}

        .notes-empty{font-size:13px;color:var(--navy-400);line-height:1.55;padding:18px 6px;text-align:center;}
        .notes-empty .di,.note-ctx .di{color:var(--accent);}
        .note-ctx{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--navy-300);margin-bottom:8px;}
        .note{padding:8px;border-radius:8px;cursor:pointer;border:1px solid transparent;}
        .note:hover{background:var(--hover);border-color:var(--line);}
        .note .ntitle{font-size:13px;color:var(--navy-100);font-weight:600;}

        .attn{margin-top:30px;}
        .attn .ahead{display:flex;align-items:center;gap:11px;margin-bottom:12px;}
        .attn .ahead .cap{font-size:12px;color:var(--navy-400);}
        .arow{display:flex;align-items:center;gap:13px;padding:11px 16px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;box-shadow:var(--card-inset);}
        .arow .cb{width:20px;height:20px;border-radius:50%;border:2px solid var(--line-strong);background:none;flex-shrink:0;cursor:pointer;padding:0;}
        .arow .at{flex:1;font-size:14.5px;color:var(--navy-100);}
        .arow .od{font-family:var(--font-mono);font-size:10.5px;font-weight:600;color:var(--nw-alarm-text,#ff6452);white-space:nowrap;}
        .acts{display:flex;gap:7px;}
        .abtn{font-size:12px;padding:6px 12px;border-radius:7px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-300);cursor:pointer;font-family:inherit;}
        .abtn:hover{background:var(--hover);color:var(--navy-100);}
        .abtn.kill{color:var(--navy-300);}
        .abtn.kill:hover{color:var(--nw-alarm-text,#ff6452);border-color:#3a1512;}

        /* ── Home cockpit: dive stage + work views ───────────────────── */
        .home-deck.stage{position:relative;}
        .home-deck .layer{transition:opacity .24s ease, transform .24s ease;}
        .home-deck .survey{position:relative;}
        .home-deck .workview{position:absolute;inset:0;opacity:0;transform:scale(.965);pointer-events:none;}
        .home-deck.work-on .survey{position:absolute;inset:0;opacity:0;transform:scale(1.012);pointer-events:none;}
        .home-deck.work-on .workview{position:relative;opacity:1;transform:scale(1);pointer-events:auto;}
        @media (prefers-reduced-motion: reduce){ .home-deck .layer{transition:opacity .12s ease;transform:none!important;} }
        .note .nprev{font-size:11.5px;color:var(--navy-400);margin-top:3px;line-height:1.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

        .cw-back{display:flex;align-items:center;gap:14px;padding:2px 4px 14px;}
        .cw-backbtn{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:13px;font-weight:600;color:var(--navy-200);background:var(--surface-2);border:1px solid var(--line-2);border-radius:8px;padding:7px 13px;cursor:pointer;}
        .cw-backbtn:hover{border-color:var(--accent);color:var(--navy-50);}
        .cw-backbtn .chev{font-size:17px;line-height:1;margin-top:-1px;}
        .cw-crumb{font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;color:var(--navy-400);text-transform:uppercase;}

        .cw-pane{border:1px solid var(--line);border-radius:14px;background:var(--surface);overflow:hidden;}
        .cw-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--line);}
        .cw-kdot{width:11px;height:11px;border-radius:50%;flex-shrink:0;}
        .cw-htext{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;}
        .cw-keyb{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--nw-label);}
        .cw-ktitle{font-family:var(--font-display);font-size:18px;font-weight:600;color:var(--navy-50);letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .cw-chip{font-size:10.5px;font-weight:600;font-family:var(--font-mono);letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:99px;flex-shrink:0;}
        .cw-chip.off{background:#2a1410;color:var(--nw-alarm-text,#ff6452);}
        .cw-chip.blocked{background:#2a2410;color:var(--warn,#f5b840);}

        .cw-split{display:grid;grid-template-columns:236px 1fr 372px;min-height:560px;transition:grid-template-columns .24s ease;}
        .cw-split.expanded{grid-template-columns:56px 1fr 0px;}

        .cw-shelf{border-right:1px solid var(--line);display:flex;flex-direction:column;background:var(--navy-900);overflow:hidden;}
        .cw-shelf-head{display:flex;align-items:baseline;gap:7px;padding:13px 14px 9px;}
        .cw-shelf-head .cw-lbl{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--nw-label);}
        .cw-n{font-family:var(--font-mono);font-size:10px;color:var(--navy-400);}
        .cw-shelf-acts{display:flex;gap:6px;padding:0 12px 10px;}
        .cw-sb{flex:1;font-family:inherit;font-size:11.5px;font-weight:600;text-align:center;padding:7px 6px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);color:var(--navy-200);cursor:pointer;}
        .cw-sb:hover{border-color:var(--accent);color:var(--navy-50);}
        .cw-sb.pri{border-color:var(--accent);background:var(--accent-dim);color:var(--accent);}
        .cw-shelf-scroll{overflow-y:auto;flex:1;}
        .cw-shelf-empty{padding:14px;font-size:12px;color:var(--navy-400);line-height:1.5;}
        .cw-nrow{display:block;width:100%;text-align:left;padding:10px 13px;border:none;border-top:1px solid var(--line);border-left:3px solid transparent;background:none;cursor:pointer;font-family:inherit;}
        .cw-nrow:hover{background:var(--hover);}
        .cw-nrow.on{background:var(--accent-dim);border-left-color:var(--accent);}
        .cw-nr-top{display:flex;align-items:baseline;gap:7px;}
        .cw-nr-title{font-size:13px;font-weight:600;color:var(--navy-100);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .cw-nrow.on .cw-nr-title{color:var(--navy-50);}
        .cw-nr-date{font-family:var(--font-mono);font-size:9.5px;color:var(--navy-400);flex-shrink:0;}
        .cw-nr-prev{font-size:11px;color:var(--navy-400);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .cw-pin{font-size:9px;margin-right:2px;}
        .cw-split.expanded .cw-shelf-head,.cw-split.expanded .cw-shelf-acts,.cw-split.expanded .cw-nr-prev,.cw-split.expanded .cw-nr-date,.cw-split.expanded .cw-pin{display:none;}
        .cw-split.expanded .cw-shelf{align-items:center;}
        .cw-split.expanded .cw-shelf-scroll{width:100%;}
        .cw-split.expanded .cw-nrow{padding:11px 0;text-align:center;border-left:none;}
        .cw-split.expanded .cw-nr-top{justify-content:center;}
        .cw-split.expanded .cw-nr-title{font-size:0;}
        .cw-split.expanded .cw-nr-title::before{content:attr(data-initial);font-size:12px;font-weight:700;color:var(--navy-300);}
        .cw-split.expanded .cw-nrow.on .cw-nr-title::before{color:var(--accent);}
        .cw-split.expanded .cw-tasks{display:none;}

        .cw-editor{display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--line);}
        .cw-editor > div{flex:1;min-height:0;}
        .cw-noeditor{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--navy-400);font-size:13px;}
        .cw-noteonly{min-height:600px;display:flex;flex-direction:column;}
        .cw-noteonly > div{flex:1;min-height:0;}

        .cw-tasks{display:flex;flex-direction:column;overflow-y:auto;padding-bottom:8px;}
        .cw-tasks-sec{padding:13px 16px 7px;}
        .cw-tasks-sec.brd{border-top:1px solid var(--line);margin-top:4px;}
        .cw-tasks .cw-lbl{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--nw-label);}
        .cw-tasks-empty{padding:2px 16px 8px;font-size:12px;color:var(--navy-500);}
        .cw-trow{display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer;}
        .cw-trow:hover{background:var(--hover);}
        .cw-cb{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line-strong);flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:var(--navy-900);}
        .cw-cb.done{background:var(--nw-nominal-text,#7fe27a);border-color:var(--nw-nominal-text,#7fe27a);}
        .cw-tt{font-size:13px;color:var(--navy-100);line-height:1.4;}
        .cw-trow.done .cw-tt{color:var(--navy-500);text-decoration:line-through;}
        .cw-sched{flex-shrink:0;font-family:inherit;font-size:10px;font-weight:600;padding:3px 8px;border-radius:6px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-400);cursor:pointer;opacity:0;transition:opacity .12s;}
        .cw-trow:hover .cw-sched{opacity:1;}
        .cw-sched:hover{color:var(--navy-50);border-color:var(--navy-400);}
        .cw-sched.pri{opacity:1;border-color:var(--accent);background:var(--accent-dim);color:var(--accent);}
        .cw-add{padding:10px 14px 4px;}
        .cw-add input{width:100%;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12.5px;color:var(--navy-50);font-family:inherit;outline:none;}
        .cw-add input:focus{border-color:var(--accent);}

        .cw-frow{display:flex;align-items:center;gap:9px;padding:7px 16px;}
        .cw-frow:hover{background:var(--hover);}
        .cw-fglyph{font-size:15px;color:var(--navy-300);flex-shrink:0;line-height:1;}
        .cw-ft{flex:1;font-size:12.5px;color:var(--navy-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .cw-fstatus{font-family:var(--font-mono);font-size:8.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:5px;flex-shrink:0;}
        .cw-fstatus.new_in{color:var(--accent);background:var(--accent-dim);}
        .cw-fstatus.editing{color:var(--warn,#f5b840);background:#2a2410;}
        .cw-fstatus.with_client{color:var(--navy-300);background:var(--surface-2);}
        .cw-fstatus.sent{color:var(--nw-nominal-text,#7fe27a);background:#0e2417;}
        .cw-fopen{font-size:13px;color:var(--accent);text-decoration:none;flex-shrink:0;padding:0 3px;}
        .cw-fopen:hover{color:var(--navy-50);}
        .cw-funlink{font-size:15px;line-height:1;color:var(--navy-500);background:none;border:none;cursor:pointer;flex-shrink:0;padding:0 3px;}
        .cw-funlink:hover{color:var(--nw-alarm-text,#ff6452);}
        .cw-fileacts{padding:9px 14px 4px;}
        .cw-fileacts .cw-sb{width:100%;}

        .cw-taskbody{padding:18px 22px 26px;max-width:760px;}
        .cw-banner{font-family:var(--font-mono);font-size:11.5px;color:var(--navy-300);background:var(--navy-900);border:1px solid var(--line);border-radius:8px;padding:9px 13px;margin-bottom:16px;}
        .cw-taskbody .cw-lbl{display:block;font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--nw-label);margin:14px 0 6px;}
        .cw-desc{font-size:13.5px;color:var(--navy-100);line-height:1.6;white-space:pre-wrap;margin:0;}
        .cw-krlink{display:inline-flex;align-items:center;gap:8px;font-family:inherit;font-size:13px;color:var(--accent);background:var(--accent-dim);border:1px solid var(--accent);border-radius:99px;padding:5px 12px;cursor:pointer;}
        .cw-pdot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
        .cw-complete{font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 14px;border-radius:8px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-200);cursor:pointer;flex-shrink:0;}
        .cw-complete:hover{border-color:var(--nw-nominal-text,#7fe27a);color:var(--navy-50);}
        .cw-complete.done{border-color:var(--nw-nominal-text,#7fe27a);color:var(--nw-nominal-text,#7fe27a);}

        .cw-pickback{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;}
        .cw-picker{width:480px;max-width:92vw;background:var(--navy-700);border:1px solid var(--navy-500);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden;}
        .cw-pick-h{padding:15px 18px 12px;border-bottom:1px solid var(--navy-600);}
        .cw-pick-h .t{font-family:var(--font-display);font-size:15px;font-weight:600;color:var(--navy-50);}
        .cw-pick-h .s{font-size:12px;color:var(--navy-400);margin-top:3px;line-height:1.45;}
        .cw-pick-search{margin:12px 16px;width:calc(100% - 32px);background:var(--navy-800);border:1px solid var(--navy-500);border-radius:9px;padding:10px 12px;font-size:13px;color:var(--navy-50);font-family:inherit;outline:none;}
        .cw-pick-search:focus{border-color:var(--accent);}
        .cw-pick-list{max-height:300px;overflow-y:auto;padding:0 8px 10px;}
        .cw-pick-empty{padding:14px;font-size:12.5px;color:var(--navy-400);}
        .cw-pick-row{display:flex;align-items:center;gap:10px;padding:10px;border-radius:9px;cursor:pointer;}
        .cw-pick-row:hover{background:var(--hover);}
        .cw-pick-row .cw-pt{flex:1;min-width:0;}
        .cw-pick-row .pn{font-size:13px;color:var(--navy-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .cw-pick-row .pm{font-size:11px;color:var(--navy-400);font-family:var(--font-mono);margin-top:1px;}
        .cw-plink{font-size:11px;font-weight:700;color:var(--accent);flex-shrink:0;}
      `}</style>
    </div>
  )
}

function fmtMin(min: number): string {
  let h = Math.floor(min / 60); const m = min % 60
  const ap = h < 12 ? 'a' : 'p'; h = h % 12; if (h === 0) h = 12
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`
}
