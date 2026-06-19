'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, DailyCheckin, WeeklyReview, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin, Task, TaskList, TaskSection, Notebook, Note } from '@/lib/types'
import { getMonday, ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'
import * as objectivesDb from '@/lib/db/objectives'
import * as krsDb from '@/lib/db/krs'
import * as actionsDb from '@/lib/db/actions'
import * as checkinsDb from '@/lib/db/checkins'
import * as reviewsDb from '@/lib/db/reviews'
import * as extrasDb from '@/lib/db/objectiveExtras'
import * as spacesDb from '@/lib/db/spaces'
import * as shareTokensDb from '@/lib/db/shareTokens'
import * as tasksDb from '@/lib/db/tasks'
import * as taskListsDb from '@/lib/db/taskLists'
import * as taskSectionsDb from '@/lib/db/taskSections'
import * as notebooksDb from '@/lib/db/notebooks'
import * as notesDb from '@/lib/db/notes'
import { extractNoteText } from '@/lib/noteText'
import Roadmap from '@/components/Roadmap'
import OKRs from '@/components/OKRs'
import Focus from '@/components/Focus'
import Reflect from '@/components/Reflect'
import ParkingLot from '@/components/ParkingLot'
import Summary from '@/components/Summary'
import Tasks from '@/components/Tasks'
import Notes from '@/components/Notes'
import Tags from '@/components/Tags'
import FastCapture from '@/components/FastCapture'
import Toast from '@/components/Toast'
import NavRail from '@/components/NavRail'
import CommandPalette from '@/components/CommandPalette'
import type { SearchEntry } from '@/lib/search'
import CloseWeekWizard from '@/components/CloseWeekWizard'
import MetricLogModal from '@/components/MetricLogModal'
import { useIsMobile } from '@/lib/useIsMobile'
import type { User } from '@supabase/supabase-js'

type Screen = 'reflect' | 'focus' | 'okr' | 'roadmap' | 'overview' | 'park' | 'tasks' | 'notes' | 'tags'


export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('okr')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  // Per-space Focus week. Each space tracks its own active week so closing
  // one space's week doesn't auto-advance the others (which was the prior
  // behaviour when this was a single string in localStorage `hq-week-start`).
  // Stored as `hq-week-start-by-space` (JSON object). The old single-string
  // key is read once on mount as a legacy fallback for spaces missing from
  // the record.
  const [weekStartBySpace, setWeekStartBySpaceRaw] = useState<Record<string, string>>({})
  const [legacyWeekStart, setLegacyWeekStart] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Mobile fallback (May 17): the NavRail collapses into a hamburger-triggered
  // slide-in drawer below 900px. Drawer state lives at the page level so the
  // mobile top bar (which owns the hamburger) and NavRail (which can close
  // itself on item-click) share it. Always closed on desktop — the rail is
  // already a permanent column.
  const isMobile = useIsMobile(900)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Notes "focus mode" — when on (desktop), the NavRail is hidden and Notes
  // collapses its own two panes so the editor gets the full viewport width.
  const [notesFocus, setNotesFocus] = useState(false)
  // Leaving Notes restores the chrome (NavRail back). Must live up here with
  // the other hooks — above the auth early-returns — to keep hook order stable.
  useEffect(() => { if (screen !== 'notes') setNotesFocus(false) }, [screen])

  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([])
  const [actions, setActions] = useState<WeeklyAction[]>([])
  const [checkins, setCheckins] = useState<DailyCheckin[]>([])
  const [habitCheckins, setHabitCheckins] = useState<HabitCheckin[]>([])
  const [metricCheckins, setMetricCheckins] = useState<MetricCheckin[]>([])
  const [reviews, setReviews] = useState<WeeklyReview[]>([])
  const [links, setLinks] = useState<ObjectiveLink[]>([])
  const [logs, setLogs] = useState<ObjectiveLog[]>([])
  // Tasks state (May 18). Lifted from Tasks.tsx so the NavRail badge can show
  // today+overdue counts and the global search can include task titles. The
  // Tasks component receives these as props plus the corresponding setters.
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskLists, setTaskLists] = useState<TaskList[]>([])
  const [taskSections, setTaskSections] = useState<TaskSection[]>([])
  const [tagsByTask, setTagsByTask] = useState<Map<string, string[]>>(new Map())
  // Notes state (Jun 2026). Lifted from Notes.tsx so global search can match
  // note titles and body text. Same pattern as the Tasks lift (May 18).
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [tagsByNote, setTagsByNote] = useState<Map<string, string[]>>(new Map())
  const [shareToken, setShareToken] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  const [closingWizard, setClosingWizard] = useState<string | null>(null)
  const [loggingMetricKRId, setLoggingMetricKRId] = useState<string | null>(null)
  // Currently-open action panel on the Focus tab. Lifted to page level so
  // <main> can widen its max-width when the panel is open (push-aside layout).
  const [openActionId, setOpenActionId] = useState<string | null>(null)
  // Currently-open objective panel on the OKRs tab. Same pattern as
  // openActionId — lifted to page level so <main> can widen for it.
  const [openObjectiveId, setOpenObjectiveId] = useState<string | null>(null)
  // Set when the command palette deep-links to a KR; OKRs/Roadmap consume it to
  // scroll the KR into view and flash it, then clear it.
  const [initialKRId, setInitialKRId] = useState<string | null>(null)
  // Cross-app jump targets. Set by Tags clicks; consumed (and cleared) by
  // the destination screen's mount effect so subsequent re-renders don't
  // re-select the item.
  const [tasksInitialId, setTasksInitialId] = useState<string | null>(null)
  const [notesInitialId, setNotesInitialId] = useState<string | null>(null)
  // Reverse direction: when clicking a tag chip on a task/note row,
  // prefill the Tags page with that tag selected.
  const [tagsInitialTag, setTagsInitialTag] = useState<string | null>(null)

  // Guards the once-per-space force-launch check. Reset when the user switches
  // spaces so a different space's unclosed last week can also trigger.
  const forceCheckDoneRef = useRef(false)
  useEffect(() => { forceCheckDoneRef.current = false }, [activeSpaceId])


  useEffect(() => {
    const saved = localStorage.getItem('hq-theme') as 'dark' | 'light' | null
    const initial = saved ?? 'light'
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  // Restore per-space Focus weeks on mount. Also read the legacy single
  // `hq-week-start` key — if a user upgrades from the old single-week model,
  // their last saved value becomes a fallback for any space the new record
  // doesn't already cover. Stale legacy values (in the past) are ignored,
  // matching the prior behaviour.
  useEffect(() => {
    const today = getMonday()
    try {
      const savedRecord = localStorage.getItem('hq-week-start-by-space')
      if (savedRecord) {
        const parsed = JSON.parse(savedRecord)
        if (parsed && typeof parsed === 'object') {
          // Drop stale entries (saved weeks in the past) on restore.
          const fresh: Record<string, string> = {}
          for (const [spaceId, value] of Object.entries(parsed)) {
            if (typeof value === 'string' && value >= today) fresh[spaceId] = value
          }
          setWeekStartBySpaceRaw(fresh)
        }
      }
    } catch { /* noop */ }
    try {
      const savedLegacy = localStorage.getItem('hq-week-start')
      if (savedLegacy && savedLegacy >= today) setLegacyWeekStart(savedLegacy)
    } catch { /* noop */ }
  }, [])

  // The active space's effective week. Falls back to the legacy single-value
  // key (one-time migration aid), then to today's Monday. Derived rather than
  // stored so it stays in sync with activeSpaceId.
  const weekStart = weekStartBySpace[activeSpaceId] ?? legacyWeekStart ?? getMonday()

  // Per-space setter wrapper: writes to `weekStartBySpace[activeSpaceId]` and
  // persists. Same `(prev: string) => string` updater signature as before so
  // downstream callers (Focus arrow nav, the wizard, openActionFromSummary)
  // don't have to change. We persist in the wrapper rather than via useEffect
  // for the same reason the old code did — useEffect on mount would race the
  // restore effect.
  const setWeekStart = (updater: (s: string) => string) => {
    setWeekStartForSpace(activeSpaceId, updater)
  }

  // Lower-level: write a specific space's weekStart. Needed when we know the
  // target space but `activeSpaceId` hasn't propagated yet (e.g. immediately
  // after `switchSpace` in cross-space jumps like openActionFromSummary).
  function setWeekStartForSpace(spaceId: string, updater: (s: string) => string) {
    if (!spaceId) return
    setWeekStartBySpaceRaw(prev => {
      const prevValue = prev[spaceId] ?? legacyWeekStart ?? getMonday()
      const next = updater(prevValue)
      const updated = { ...prev, [spaceId]: next }
      try { localStorage.setItem('hq-week-start-by-space', JSON.stringify(updated)) } catch { /* noop */ }
      return updated
    })
  }

  function switchSpace(spaceId: string) {
    setActiveSpaceId(spaceId)
    localStorage.setItem('hq-active-space', spaceId)
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('hq-theme', next)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    // Per-call fallbacks preserve the original behavior: if a single table
    // query fails, the app still loads with empty state for that table
    // rather than failing the whole boot. Errors that previously vanished
    // into supabase's `{data, error}` shape now surface in console.
    const fallback = <T,>(label: string, value: T) => (err: unknown): T => {
      console.error(`loadAll: ${label} failed:`, err)
      return value
    }
    const [o, r, a, ci, hc, mc, rv, lk, lg, sp, st, tk, tl, ts, nb, nt] = await Promise.all([
      objectivesDb.listAll().catch(fallback('objectives', [] as AnnualObjective[])),
      krsDb.listAll().catch(fallback('roadmap_items', [] as RoadmapItem[])),
      actionsDb.listAll().catch(fallback('weekly_actions', [] as WeeklyAction[])),
      checkinsDb.daily.listAll().catch(fallback('daily_checkins', [] as DailyCheckin[])),
      checkinsDb.habit.listAll().catch(fallback('habit_checkins', [] as HabitCheckin[])),
      checkinsDb.metric.listAll().catch(fallback('metric_checkins', [] as MetricCheckin[])),
      reviewsDb.listAll().catch(fallback('weekly_reviews', [] as WeeklyReview[])),
      extrasDb.links.listAll().catch(fallback('objective_links', [] as ObjectiveLink[])),
      extrasDb.logs.listAll().catch(fallback('objective_logs', [] as ObjectiveLog[])),
      spacesDb.listAll().catch(fallback('spaces', [] as Space[])),
      shareTokensDb.findActiveByLabel('Melissa').catch(fallback('share_tokens', null)),
      tasksDb.listAll().catch(fallback('tasks', [] as Task[])),
      taskListsDb.listAll().catch(fallback('task_lists', [] as TaskList[])),
      taskSectionsDb.listAll().catch(fallback('task_sections', [] as TaskSection[])),
      notebooksDb.listAll().catch(fallback('notebooks', [] as Notebook[])),
      notesDb.listAll().catch(fallback('notes', [] as Note[])),
    ])
    setObjectives(o)
    setRoadmapItems(r)
    setActions(a)
    setCheckins(ci)
    setHabitCheckins(hc)
    setMetricCheckins(mc)
    setReviews(rv)
    setLinks(lk)
    setLogs(lg)
    setSpaces(sp)
    if (st) setShareToken(st.token)
    setTasks(tk)
    setTaskLists(tl)
    setTaskSections(ts)
    setNotebooks(nb)
    setNotes(nt)
    // Tags follow tasks — a second query keyed by the loaded task ids. If
    // it fails we silently fall back to empty (tag-driven UI degrades to
    // "no tags," which is preferable to blocking task load).
    try {
      const tagRows = await tasksDb.listTagsForTasks(tk.map(t => t.id))
      const map = new Map<string, string[]>()
      for (const row of tagRows) {
        const arr = map.get(row.task_id) ?? []
        arr.push(row.tag)
        map.set(row.task_id, arr)
      }
      setTagsByTask(map)
    } catch (err) {
      console.error('loadAll: task_tags failed:', err)
      setTagsByTask(new Map())
    }
    // Note tags — same pattern as task_tags above.
    try {
      const noteTagRows = await notesDb.listTagsForNotes(nt.map(n => n.id))
      const map = new Map<string, string[]>()
      for (const row of noteTagRows) {
        const arr = map.get(row.note_id) ?? []
        arr.push(row.tag)
        map.set(row.note_id, arr)
      }
      setTagsByNote(map)
    } catch (err) {
      console.error('loadAll: note_tags failed:', err)
      setTagsByNote(new Map())
    }
    // Set active space from localStorage or default to first.
    const savedSpaceId = localStorage.getItem('hq-active-space')
    const validId = sp.find(s => s.id === savedSpaceId)?.id ?? sp[0]?.id ?? ''
    setActiveSpaceId(validId)
    setLoading(false)
  }, [])

  useEffect(() => { if (user) loadAll() }, [user, loadAll])

  // Forced launch of CloseWeekWizard when last week wasn't closed.
  // Runs once per space (reset on space switch). Fires only after data loads,
  // and only if the prior Monday had real activity in this space (planned
  // actions or habit checkins) AND no weekly_review exists for it. For stale
  // gaps of more than one week, the wizard's own carry-forward logic handles
  // landing carries in the current week on finish — so we only check the
  // immediately prior week; deeper gaps can be closed manually from Focus.
  useEffect(() => {
    if (loading || !activeSpaceId || forceCheckDoneRef.current) return
    if (closingWizard) return // already open (rare, but don't clobber)
    forceCheckDoneRef.current = true

    const lastMonday = addWeeks(getMonday(), -1)

    // Space-scope on the fly — cheap and avoids depending on derived state
    // that's recomputed later in this render.
    const spaceKRIds = new Set(
      roadmapItems.filter(i => i.space_id === activeSpaceId).map(i => i.id)
    )

    // Only a fully-closed review (closed_at set by commitFinish/skipWeek)
    // suppresses the re-prompt. A draft (Step 1 saved, Step 2 abandoned)
    // still triggers — the user wants to be brought back to finish closing.
    const hasClosedReview = reviews.some(
      r => r.space_id === activeSpaceId && r.week_start === lastMonday && r.closed_at != null
    )
    if (hasClosedReview) return

    const hadActions = actions.some(
      a => spaceKRIds.has(a.roadmap_item_id) && a.week_start === lastMonday
    )
    const hadHabits = habitCheckins.some(h => {
      if (!spaceKRIds.has(h.roadmap_item_id)) return false
      const hMonday = getMonday(new Date(h.date + 'T12:00:00'))
      return hMonday === lastMonday
    })
    if (!hadActions && !hadHabits) return

    setClosingWizard(lastMonday)
  }, [loading, activeSpaceId, reviews, actions, habitCheckins, objectives, roadmapItems, closingWizard])

  // Search index — a flat list of every searchable thing, rebuilt only when
  // its source state changes. The command palette ranks this in-memory.
  const searchEntries: SearchEntry[] = useMemo(() => {
    const spaceById = new Map(spaces.map(s => [s.id, s]))
    const spaceMeta = (id: string | null | undefined) => {
      const s = id ? spaceById.get(id) : undefined
      return { spaceName: s?.name, spaceColor: s?.color }
    }
    const spaceForKR = new Map(roadmapItems.map(i => [i.id, i.space_id]))
    const notebookName = new Map(notebooks.map(n => [n.id, n.name]))
    const today = getMonday()
    const weekStartFor = (spaceId: string | undefined) =>
      (spaceId && weekStartBySpace[spaceId]) || legacyWeekStart || today
    const recency = (iso?: string | null) => {
      if (!iso) return 0
      const days = (Date.now() - new Date(iso).getTime()) / 86400000
      return days < 0 ? 8 : Math.max(0, 8 - days / 12) // ~8 fresh, fading over ~3mo
    }

    const out: SearchEntry[] = []

    for (const o of objectives) {
      out.push({
        id: `obj:${o.id}`, kind: 'Objective', icon: '◎', title: o.name,
        ...spaceMeta(o.space_id), rec: recency(o.created_at),
        route: { screen: 'okr', spaceId: o.space_id, objectiveId: o.id },
      })
    }

    for (const i of roadmapItems) {
      const parked = i.is_parked
      out.push({
        id: `kr:${i.id}`, kind: 'Key Result', icon: '◇', title: i.title,
        ...spaceMeta(i.space_id), hint: parked ? 'parked' : undefined,
        rec: recency(i.created_at),
        route: parked
          ? { screen: 'park', spaceId: i.space_id }
          : { screen: i.quarter === ACTIVE_Q ? 'okr' : 'roadmap', spaceId: i.space_id, krId: i.id },
      })
    }

    // Dedup carry-forward actions: a recurring action spawns a fresh
    // weekly_actions row each week with the same (roadmap_item_id, title) — its
    // canonical identity. Collapse to one entry per identity: the this-week row
    // if it exists, otherwise the most recent week (week_start sorts lexically).
    const bestAction = new Map<string, WeeklyAction>()
    const isThisWeek = (a: WeeklyAction) => a.week_start === weekStartFor(spaceForKR.get(a.roadmap_item_id))
    for (const a of actions) {
      const key = `${a.roadmap_item_id}::${a.title}`
      const cur = bestAction.get(key)
      if (!cur) { bestAction.set(key, a); continue }
      const aThis = isThisWeek(a), curThis = isThisWeek(cur)
      if (aThis && !curThis) bestAction.set(key, a)
      else if (aThis === curThis && a.week_start > cur.week_start) bestAction.set(key, a)
    }
    for (const a of bestAction.values()) {
      const sid = spaceForKR.get(a.roadmap_item_id)
      const thisWeek = isThisWeek(a)
      out.push({
        id: `act:${a.id}`, kind: 'Action', icon: '▸', title: a.title,
        ...spaceMeta(sid), hint: thisWeek ? 'this week' : undefined,
        done: a.completed, rec: thisWeek ? 8 : 2,
        route: { screen: 'focus', spaceId: sid, weekStart: a.week_start, actionId: a.id },
      })
    }

    for (const t of tasks) {
      out.push({
        id: `task:${t.id}`, kind: 'Task', icon: '☑', title: t.title,
        body: t.description ?? undefined, tags: tagsByTask.get(t.id),
        ...spaceMeta(t.space_id), done: !!t.completed_at, rec: recency(t.updated_at),
        route: { screen: 'tasks', taskId: t.id },
      })
    }

    for (const n of notes) {
      out.push({
        id: `note:${n.id}`, kind: 'Note', icon: '▤', title: n.title || 'Untitled',
        body: extractNoteText(n.body), tags: tagsByNote.get(n.id),
        container: n.notebook_id ? notebookName.get(n.notebook_id) : undefined,
        ...spaceMeta(n.space_id), rec: recency(n.updated_at),
        route: { screen: 'notes', noteId: n.id },
      })
    }

    for (const r of reviews) {
      const text = [r.win, r.slipped, r.adjust_notes].filter(Boolean).join(' ')
      if (!text) continue
      out.push({
        id: `refl:${r.id}`, kind: 'Reflect', icon: '✶',
        title: `Reflection · ${formatWeek(r.week_start)}`, body: text,
        ...spaceMeta(r.space_id),
        route: { screen: 'reflect', spaceId: r.space_id, weekStart: r.week_start },
      })
    }

    for (const nb of notebooks) {
      out.push({
        id: `nb:${nb.id}`, kind: 'Notebook', icon: '❑', title: nb.name,
        ...spaceMeta(nb.space_id),
        route: { screen: 'notes', spaceId: nb.space_id },
      })
    }

    for (const s of spaces) {
      out.push({
        id: `space:${s.id}`, kind: 'Space', icon: '⬡', title: s.name,
        spaceColor: s.color,
        route: { screen: 'okr', spaceId: s.id },
      })
    }

    return out
  }, [objectives, roadmapItems, actions, tasks, notes, reviews, notebooks, spaces, tagsByTask, tagsByNote, weekStartBySpace, legacyWeekStart])

  // ⌘K / Ctrl-K opens the command palette from anywhere in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function copyShareLink() {
    if (!shareToken) {
      setToast('No share link configured yet')
      return
    }
    const link = `${window.location.origin}/share/${shareToken}`
    navigator.clipboard.writeText(link)
    setCopied(true); setToast('Share link copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  if (user === undefined) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-900)' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
    </div>
  )
  if (!user) return <LoginPage />

  const initials = user.email?.slice(0, 2).toUpperCase() ?? 'HQ'
  const parkedCount = roadmapItems.filter(i => i.is_parked).length

  // Click handlers fired from Summary. Both commit the target real space, then
  // route into the right tab and pop the corresponding panel — reusing the
  // openObjectiveId / openActionId plumbing that OKRs and Focus already wire
  // up for in-space clicks. setScreen implicitly leaves the Overview view
  // by switching to a per-space tab.
  function openObjectiveFromSummary(spaceId: string, objectiveId: string) {
    switchSpace(spaceId)
    setScreen('okr')
    setOpenObjectiveId(objectiveId)
    setOpenActionId(null)
  }
  function openActionFromSummary(spaceId: string, action: WeeklyAction) {
    switchSpace(spaceId)
    setScreen('focus')
    // Older open actions live on past weeks; jump to that week so Focus
    // actually surfaces the action. Use the explicit-spaceId variant —
    // `setWeekStart` would read the closure-captured activeSpaceId which
    // hasn't propagated yet from switchSpace, writing to the wrong record.
    setWeekStartForSpace(spaceId, () => action.week_start)
    setOpenActionId(action.id)
    setOpenObjectiveId(null)
  }

  // Route a command-palette pick. Reuses the same space-switch + panel-open
  // plumbing as the Summary jumps. Space-scoped screens (okr/focus/roadmap/
  // park/reflect) need the target's space committed first, or the screen would
  // render the wrong space's data.
  function handleSearchPick(entry: SearchEntry) {
    const r = entry.route
    if (r.spaceId) switchSpace(r.spaceId)
    if (r.taskId) setTasksInitialId(r.taskId)
    if (r.noteId) setNotesInitialId(r.noteId)
    if (r.objectiveId) { setOpenObjectiveId(r.objectiveId); setOpenActionId(null) }
    if (r.actionId) {
      // Actions on past/future weeks need their week committed so Focus surfaces
      // them. Use the explicit-space variant — activeSpaceId hasn't propagated
      // from switchSpace yet.
      if (r.spaceId && r.weekStart) setWeekStartForSpace(r.spaceId, () => r.weekStart!)
      setOpenActionId(r.actionId); setOpenObjectiveId(null)
    }
    if (r.screen === 'reflect' && r.spaceId && r.weekStart) {
      setWeekStartForSpace(r.spaceId, () => r.weekStart!)
    }
    if (r.krId) setInitialKRId(r.krId)
    goToScreen(r.screen as Screen)
    if (isMobile) setDrawerOpen(false)
  }

  async function toggleActionFromSummary(action: WeeklyAction) {
    try {
      const updated = await actionsDb.update(action.id, { completed: !action.completed })
      setActions(prev => prev.map(a => a.id === action.id ? updated : a))
    } catch (err) {
      console.error('toggleAction (Summary) failed:', err)
    }
  }
  async function toggleKRFromSummary(kr: RoadmapItem) {
    // Summary's done check is `status === 'done' || health_status === 'done'`,
    // so to truly un-done a KR we need to clear `status: 'done'` if set —
    // otherwise the OR keeps it visually checked. Marking done only touches
    // health_status to avoid stomping a `planned` or `abandoned` status that
    // some other flow set.
    const isDone = kr.health_status === 'done' || kr.status === 'done'
    const patch: Partial<RoadmapItem> = isDone
      ? { health_status: 'on_track', ...(kr.status === 'done' ? { status: 'active' as const } : {}) }
      : { health_status: 'done' }
    try {
      const updated = await krsDb.update(kr.id, patch)
      setRoadmapItems(prev => prev.map(i => i.id === kr.id ? updated : i))
    } catch (err) {
      console.error('toggleKR (Summary) failed:', err)
    }
  }

  // Space-scoped data — everything filters from the active space's objectives.
  // activeSpaceId always holds a real space; the Overview screen consumes the
  // un-scoped lists directly through Summary and doesn't read these slices.
  const activeSpace = spaces.find(s => s.id === activeSpaceId)
  const spaceObjectives = objectives.filter(o => o.space_id === activeSpaceId)
  const spaceObjectiveIds = new Set(spaceObjectives.map(o => o.id))
  const spaceRoadmapItems = roadmapItems.filter(i => i.space_id === activeSpaceId)
  const spaceRoadmapItemIds = new Set(spaceRoadmapItems.map(i => i.id))
  const spaceActions = actions.filter(a => spaceRoadmapItemIds.has(a.roadmap_item_id))
  const spaceCheckins = checkins.filter(c => spaceRoadmapItemIds.has(c.roadmap_item_id))
  const spaceHabitCheckins = habitCheckins.filter(h => spaceRoadmapItemIds.has(h.roadmap_item_id))
  const spaceMetricCheckins = metricCheckins.filter(m => spaceRoadmapItemIds.has(m.roadmap_item_id))
  const spaceLinks = links.filter(l => spaceObjectiveIds.has(l.objective_id))
  const spaceLogs = logs.filter(l => spaceObjectiveIds.has(l.objective_id))
  const spaceReviews = reviews.filter(r => r.space_id === activeSpaceId)
  // In-progress draft for this space (Step 1 saved, Step 2 abandoned).
  // Surfaced as the page-level banner below — the lighter parallel to the
  // forced-launcher overlay. Null when no draft, so the banner stays hidden.
  // Multiple drafts shouldn't exist in practice (unique constraint on
  // (space_id, week_start) + only commitFinish/skipWeek set closed_at), so
  // first match is fine.
  const draftReview = spaceReviews.find(r => r.closed_at == null) ?? null

  // Nav click handler. Just setScreen, plus a focus-week snap.
  //
  // Focus snap: if weekStart is in the past, advance it to today's Monday.
  // Past weeks are read-only territory for the Reflect tab; Focus from the
  // nav should land on "now," not wherever the user last walked backward to
  // with Focus's own ‹ button (which persisted to localStorage). Forward
  // weekStart values (e.g. pre-planned next week) are left alone. Other
  // entry points to Focus that intentionally target a specific week —
  // openActionFromSummary, the close-week wizard's commitFinish — set
  // weekStart directly without going through goToScreen, so they're
  // unaffected by this snap.
  function goToScreen(target: Screen) {
    if (target === 'focus') {
      const today = getMonday()
      if (weekStart < today) setWeekStart(() => today)
    }
    setScreen(target)
  }

  // Active-screen detection is now owned by NavRail; the bottom nav and its
  // NAV/navActive scaffolding were removed when the rail landed.

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--navy-900)' }}>
      {!(notesFocus && !isMobile) && (
      <NavRail
        screen={screen}
        onScreenChange={goToScreen}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        objectives={objectives}
        roadmapItems={roadmapItems}
        onSpaceSelect={switchSpace}
        onSpaceCreated={space => setSpaces(prev => [...prev, space])}
        onSpaceUpdated={space => setSpaces(prev => prev.map(s => s.id === space.id ? space : s))}
        focusOpenCount={spaceActions.filter(a => a.week_start === weekStart && !a.completed).length}
        tasksOverdueCount={(() => {
          // Matches the Tasks "Today" smart view filter: open tasks with a
          // due_date on or before today. Empty due_date is "Later" — doesn't
          // count toward this badge.
          const todayLocal = new Date()
          const today = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(todayLocal.getDate()).padStart(2, '0')}`
          return tasks.filter(t => !t.completed_at && t.due_date && t.due_date <= today).length
        })()}
        parkedCount={parkedCount}
        reviewsCount={spaceReviews.filter(r => r.closed_at != null).length}
        onOpenSearch={() => setPaletteOpen(true)}
        initials={initials}
        email={user?.email ?? ''}
        theme={theme}
        onToggleTheme={toggleTheme}
        onCopyShareLink={copyShareLink}
        onSignOut={() => supabase.auth.signOut()}
        isMobile={isMobile}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Mobile-only top bar — hamburger + brand. Hidden on desktop where
          NavRail is permanently visible. Sticky so it stays during scroll. */}
      {isMobile && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 25,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: 'var(--navy-800)',
          borderBottom: '1px solid var(--navy-600)',
          minHeight: 48,
        }}>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{
              width: 36, height: 36, borderRadius: 6,
              background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--navy-100)',
            }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--navy-50)' }}>
            Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
          </div>
        </div>
      )}
      {/* Tasks/Notes/Tags use full viewport width for their multi-pane layouts;
          all other screens get the standard centered main with conditional
          maxWidth (Roadmap/Summary/panels widen; otherwise narrow). */}
      {screen === 'tasks' && !loading ? (
        <Tasks
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          objectives={objectives}
          roadmapItems={roadmapItems}
          tasks={tasks}
          setTasks={setTasks}
          lists={taskLists}
          setLists={setTaskLists}
          sections={taskSections}
          setSections={setTaskSections}
          tagsByTask={tagsByTask}
          setTagsByTask={setTagsByTask}
          initialTaskId={tasksInitialId}
          onConsumeInitialTaskId={() => setTasksInitialId(null)}
          onJumpToTag={tag => { setTagsInitialTag(tag); setScreen('tags') }}
          toast={setToast}
        />
      ) : screen === 'notes' && !loading ? (
        <Notes
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          notebooks={notebooks}
          setNotebooks={setNotebooks}
          notes={notes}
          setNotes={setNotes}
          tagsByNote={tagsByNote}
          setTagsByNote={setTagsByNote}
          initialNoteId={notesInitialId}
          onConsumeInitialNoteId={() => setNotesInitialId(null)}
          onJumpToTag={tag => { setTagsInitialTag(tag); setScreen('tags') }}
          onFocusChange={setNotesFocus}
          toast={setToast}
        />
      ) : screen === 'tags' && !loading ? (
        <Tags
          spaces={spaces}
          initialTag={tagsInitialTag}
          onJumpToTask={(id) => { setTasksInitialId(id); setTagsInitialTag(null); setScreen('tasks') }}
          onJumpToNote={(id) => { setNotesInitialId(id); setTagsInitialTag(null); setScreen('notes') }}
          toast={setToast}
        />
      ) : (
      <main style={{ padding: isMobile ? '16px 14px' : '24px 28px', maxWidth: screen === 'overview' || screen === 'roadmap' || (screen === 'focus' && openActionId) || (screen === 'okr' && openObjectiveId) ? 1280 : 800, width: '100%', margin: '0 auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10, color: 'var(--navy-400)', fontSize: 13 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
            Loading…
          </div>
        ) : screen === 'overview' ? (
          <Summary
            spaces={spaces}
            objectives={objectives}
            roadmapItems={roadmapItems}
            actions={actions}
            onOpenObjective={openObjectiveFromSummary}
            onOpenAction={openActionFromSummary}
            onToggleAction={toggleActionFromSummary}
            onToggleKR={toggleKRFromSummary}
            onUpdateKR={async (id, patch) => {
              try {
                const updated = await krsDb.update(id, patch)
                setRoadmapItems(prev => prev.map(kr => kr.id === id ? updated : kr))
                setToast('Key Result updated')
              } catch (err) {
                console.error('updateKR (Summary) failed:', err)
                setToast('Failed to update KR')
              }
            }}
            onDeleteKR={async (id) => {
              try {
                await krsDb.remove(id)
                setRoadmapItems(prev => prev.filter(kr => kr.id !== id))
                setToast('Key Result deleted')
              } catch (err) {
                console.error('deleteKR (Summary) failed:', err)
                setToast('Failed to delete KR')
              }
            }}
            toast={setToast}
          />
        ) : (
          <>
            {draftReview && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '10px 14px', marginBottom: 16,
                background: 'var(--amber-bg)', border: '1px solid var(--amber-text)', borderRadius: 10,
              }}>
                <div style={{ fontSize: 13, color: 'var(--amber-text)', lineHeight: 1.4 }}>
                  <strong style={{ fontWeight: 600 }}>Close in progress</strong> — you started reflecting on the week of <strong style={{ fontWeight: 600 }}>{formatWeek(draftReview.week_start)}</strong> but haven&apos;t finished planning yet.
                </div>
                <button
                  onClick={() => setClosingWizard(draftReview.week_start)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999,
                    background: 'var(--amber-text)', color: 'var(--navy-900)', border: 'none',
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Resume →
                </button>
              </div>
            )}
            {screen === 'okr'     && <OKRs objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} actions={spaceActions} setActions={setActions} weekStart={weekStart} links={spaceLinks} logs={spaceLogs} setLinks={setLinks} setLogs={setLogs} openObjectiveId={openObjectiveId} setOpenObjectiveId={setOpenObjectiveId} activeSpaceId={activeSpaceId} habitCheckins={spaceHabitCheckins} metricCheckins={spaceMetricCheckins} toast={setToast} onLogMetric={krId => setLoggingMetricKRId(krId)} spaceName={activeSpace?.name ?? 'My OKRs'} initialKRId={initialKRId} onConsumeInitialKRId={() => setInitialKRId(null)} />}
            {screen === 'focus'   && <Focus objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} actions={spaceActions} setActions={setActions} habitCheckins={spaceHabitCheckins} setHabitCheckins={setHabitCheckins} weekStart={weekStart} setWeekStart={setWeekStart} toast={setToast} onRequestCloseWeek={week => setClosingWizard(week)} logs={spaceLogs} setLogs={setLogs} openActionId={openActionId} setOpenActionId={setOpenActionId} spaceName={activeSpace?.name ?? 'My OKRs'} />}
            {screen === 'roadmap' && <Roadmap objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} activeSpaceId={activeSpaceId} toast={setToast} initialKRId={initialKRId} onConsumeInitialKRId={() => setInitialKRId(null)} />}
            {screen === 'reflect' && <Reflect reviews={spaceReviews} setReviews={setReviews} toast={setToast} />}
            {screen === 'park'    && <ParkingLot objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} activeSpaceId={activeSpaceId} setRoadmapItems={setRoadmapItems} toast={setToast} />}
          </>
        )}
      </main>
      )}
      </div>

      {/* FastCapture — visible on every screen including Overview. Targets
          the currently active real space; suppressed only if there's no real
          space at all (no-op edge case for fresh users with zero spaces). */}
      {activeSpaceId && (
      <FastCapture
        objectives={spaceObjectives}
        roadmapItems={spaceRoadmapItems}
        weekStart={weekStart}
        activeSpaceId={activeSpaceId}
        setObjectives={setObjectives}
        setRoadmapItems={setRoadmapItems}
        setActions={setActions}
        toast={setToast}
      />
      )}

      {/* Close-week wizard — lifted to page level so forced launch can overlay
          any screen, not just Focus. Launched either by Focus's "Close week →"
          button (via onRequestCloseWeek) or by the forced-launch effect above. */}
      {closingWizard && (
        <CloseWeekWizard
          closingWeek={closingWizard}
          objectives={spaceObjectives}
          roadmapItems={spaceRoadmapItems}
          setRoadmapItems={setRoadmapItems}
          actions={spaceActions}
          setActions={setActions}
          habitCheckins={spaceHabitCheckins}
          metricCheckins={spaceMetricCheckins}
          setMetricCheckins={setMetricCheckins}
          reviews={spaceReviews}
          setReviews={setReviews}
          setWeekStart={setWeekStart}
          activeSpaceId={activeSpaceId}
          toast={setToast}
          onClose={() => setClosingWizard(null)}
        />
      )}

      {/* Metric log modal — lives at page level so any screen can open it.
          Today only triggered from OKR cards, but Reflect history / wizard
          nudges will hook in later without re-plumbing. */}
      {loggingMetricKRId && (() => {
        const kr = spaceRoadmapItems.find(i => i.id === loggingMetricKRId)
        if (!kr) return null
        return (
          <MetricLogModal
            kr={kr}
            checkins={spaceMetricCheckins}
            setMetricCheckins={setMetricCheckins}
            setRoadmapItems={setRoadmapItems}
            toast={setToast}
            onClose={() => setLoggingMetricKRId(null)}
          />
        )
      })()}

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        entries={searchEntries}
        onPick={handleSearchPick}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  )
}

// (Bottom-nav icons removed — NavRail.tsx ships its own desktop-rail icons.)

// ── Login ──────────────────────────────────────────────────────────
function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) setError(err.message)
    } else {
      const { error: err } = await supabase.auth.signUp({ email, password })
      if (err) setError(err.message)
      else setError('Account created — sign in below.')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-900)', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 20, padding: 32 }}>
        <div style={{ fontSize: 18, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--navy-50)', marginBottom: 4 }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--navy-400)', marginBottom: 24 }}>{mode === 'login' ? 'Sign in to your mission control' : 'Create your account'}</p>
        {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', fontSize: 12, padding: '8px 12px', borderRadius: 10, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></div>
          <div className="field"><label>Password</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <button className="btn-primary" style={{ width: '100%', padding: '11px', marginTop: 4 }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--navy-400)', textAlign: 'center', marginTop: 16 }}>
          {mode === 'login' ? 'New here? ' : 'Have an account? '}
          <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }} onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError('') }}>
            {mode === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
