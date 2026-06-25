'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, DailyCheckin, WeeklyReview, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin, Task, TaskList, TaskSection, Notebook, Note, CapacityBlock, CalendarBlock, TrackedFile, FileVersion } from '@/lib/types'
import { getMonday, ACTIVE_Q, formatWeek } from '@/lib/utils'
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
import * as capacityDb from '@/lib/db/capacityBlocks'
import * as calBlocksDb from '@/lib/db/calendarBlocks'
import * as googleTokensDb from '@/lib/db/googleTokens'
import * as trackedFilesDb from '@/lib/db/trackedFiles'
import { extractNoteText } from '@/lib/noteText'
import Roadmap from '@/components/Roadmap'
import ObjectivePanel from '@/components/ObjectivePanel'
import Reflect from '@/components/Reflect'
import ParkingLot from '@/components/ParkingLot'
import Home from '@/components/Home'
import Agent, { type ChatMsg } from '@/components/Agent'
import Tasks from '@/components/Tasks'
import Notes from '@/components/Notes'
import Calendar from '@/components/Calendar'
import Tags from '@/components/Tags'
import Settings from '@/components/Settings'
import Files from '@/components/Files'
import { ensurePushSubscription } from '@/lib/push/ensurePush'
import FastCapture from '@/components/FastCapture'
import Toast from '@/components/Toast'
import NavRail from '@/components/NavRail'
import CommandPalette from '@/components/CommandPalette'
import type { SearchEntry } from '@/lib/search'
import CloseWeekWizard from '@/components/CloseWeekWizard'
import PlanWeek from '@/components/PlanWeek'
import MetricLogModal from '@/components/MetricLogModal'
import { useIsMobile } from '@/lib/useIsMobile'
import type { User } from '@supabase/supabase-js'

type Screen = 'home' | 'agent' | 'reflect' | 'roadmap' | 'park' | 'tasks' | 'notes' | 'calendar' | 'files' | 'tags' | 'settings'


export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('home')
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
  const [captureRequest, setCaptureRequest] = useState<{ type: 'task' | 'note'; key: number } | null>(null)

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
  const [capacityBlocks, setCapacityBlocks] = useState<CapacityBlock[]>([])
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([])
  const [googleConnected, setGoogleConnected] = useState(false)
  const [driveGranted, setDriveGranted] = useState(false)
  const [trackedFiles, setTrackedFiles] = useState<TrackedFile[]>([])
  const [fileVersions, setFileVersions] = useState<FileVersion[]>([])
  // Notes state (Jun 2026). Lifted from Notes.tsx so global search can match
  // note titles and body text. Same pattern as the Tasks lift (May 18).
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  // Chief of Staff conversation — lifted here so the thread + any in-flight
  // streamed reply persist across navigating away from the agent screen.
  const [agentMessages, setAgentMessages] = useState<ChatMsg[]>([])
  const [agentPending, setAgentPending] = useState(false)
  const [tagsByNote, setTagsByNote] = useState<Map<string, string[]>>(new Map())
  const [shareToken, setShareToken] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  const [closingWizard, setClosingWizard] = useState<{ spaceId: string; week: string } | null>(null)
  const [planningWizard, setPlanningWizard] = useState<{ spaceId: string; week: string } | null>(null)
  const [loggingMetricKRId, setLoggingMetricKRId] = useState<string | null>(null)
  // Currently-open objective panel (links/logs), opened from Home. Lifted to page level so
  // <main> can widen its max-width when the panel is open (push-aside layout).
  const [openObjectiveId, setOpenObjectiveId] = useState<string | null>(null)
  // Set when the command palette deep-links to a KR; Home/Roadmap consume it to
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

  // Same resolution for any space — used by Reflect's per-space close launcher.
  const weekForSpace = (spaceId: string) => weekStartBySpace[spaceId] ?? legacyWeekStart ?? getMonday()

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

  // Connect / disconnect Google. Connect fetches the consent URL (with our
  // Bearer so the route can identify us) then redirects the browser to Google.
  const connectGoogle = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/google/connect', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (!res.ok) { setToast('Could not start Google connect'); return }
    const { url } = await res.json()
    window.location.href = url
  }, [])

  const disconnectGoogle = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/google/disconnect', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) { setGoogleConnected(false); setToast('Google disconnected') }
    else setToast('Could not disconnect')
  }, [])

  // Surface the OAuth round-trip result (callback redirects to /hq?google=...),
  // and honor ?screen=<name> deep-links (e.g. push notification → Chief of Staff).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const g = params.get('google')
    const scr = params.get('screen')
    if (g === 'connected') { setGoogleConnected(true); setToast('Google Calendar connected') }
    else if (g === 'denied') setToast('Google connection cancelled')
    else if (g === 'error') setToast('Google connection failed — try again')
    if (scr === 'agent') setScreen('agent')
    if (g || scr) window.history.replaceState({}, '', '/hq')
  }, [])

  // Persist briefings without re-prompting: if notification permission is already
  // granted, silently (re)register the SW + subscription and sync it to the server
  // on every load. This is why "Turn on" is a one-time action per device.
  useEffect(() => { void ensurePushSubscription() }, [])

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
    const [o, r, a, ci, hc, mc, rv, lk, lg, sp, st, tk, tl, ts, nb, nt, cap, calb, gstat, tf, fv] = await Promise.all([
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
      capacityDb.listAll().catch(fallback('calendar_capacity_blocks', [] as CapacityBlock[])),
      calBlocksDb.listAll().catch(fallback('calendar_blocks', [] as CalendarBlock[])),
      googleTokensDb.getStatus().catch(fallback('google_status', { connected: false, driveGranted: false, hqCalendarId: null, readCalendarIds: [] })),
      trackedFilesDb.listAll().catch(fallback('tracked_files', [] as TrackedFile[])),
      trackedFilesDb.listAllVersions().catch(fallback('file_versions', [] as FileVersion[])),
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
    setCapacityBlocks(cap)
    setCalendarBlocks(calb)
    setGoogleConnected(gstat.connected)
    setDriveGranted(gstat.driveGranted)
    setTrackedFiles(tf)
    setFileVersions(fv)
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

  // Weekly-close prompting moved to Home's all-spaces close strip (passive,
  // glanceable, per-space) — replaces the old active-space-only auto-popup.



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
        route: { screen: 'home', spaceId: o.space_id, objectiveId: o.id },
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
          : { screen: i.quarter === ACTIVE_Q ? 'home' : 'roadmap', spaceId: i.space_id, krId: i.id },
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
      else if (aThis === curThis && (a.week_start ?? '') > (cur.week_start ?? '')) bestAction.set(key, a)
    }
    for (const a of bestAction.values()) {
      const sid = spaceForKR.get(a.roadmap_item_id)
      const thisWeek = isThisWeek(a)
      out.push({
        id: `act:${a.id}`, kind: 'Action', icon: '▸', title: a.title,
        ...spaceMeta(sid), hint: thisWeek ? 'this week' : undefined,
        done: a.completed, rec: thisWeek ? 8 : 2,
        route: { screen: 'home', spaceId: sid, krId: a.roadmap_item_id },
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
        route: { screen: 'home', spaceId: s.id },
      })
    }

    return out
  }, [objectives, roadmapItems, actions, tasks, notes, reviews, notebooks, spaces, tagsByTask, tagsByNote, weekStartBySpace, legacyWeekStart])

  // Global keyboard layer:
  //   ⌘K  command palette
  //   ⌘T  new task   ·  ⌘N  new note   (PWA only — browser tabs reserve ⌘T/⌘N)
  //   g <key>  go-to nav:  h Home · t Tasks · n Notes · r Roadmap
  //                        c Calendar · s Scout · f Reflect · p Parking
  useEffect(() => {
    let gLeaderAt = 0
    const GO: Record<string, Screen> = {
      h: 'home', t: 'tasks', n: 'notes', r: 'roadmap',
      c: 'calendar', s: 'agent', f: 'reflect', p: 'park',
    }
    function isTyping(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null
      if (!el || !el.tagName) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase()
      // ⌘/Ctrl combos fire anywhere (even mid-typing), so capture works from any field.
      if (e.metaKey || e.ctrlKey) {
        if (e.altKey || e.shiftKey) return
        if (k === 'k') { e.preventDefault(); setPaletteOpen(true); return }
        if (k === 't') { e.preventDefault(); setCaptureRequest({ type: 'task', key: Date.now() }); return }
        if (k === 'n') { e.preventDefault(); setCaptureRequest({ type: 'note', key: Date.now() }); return }
        return
      }
      // Bare keys are suppressed while typing in a field or the note editor.
      if (isTyping(e.target)) { gLeaderAt = 0; return }
      if (k === 'g') { gLeaderAt = Date.now(); return }
      if (gLeaderAt && Date.now() - gLeaderAt < 1200 && GO[k]) {
        e.preventDefault()
        setScreen(GO[k])
        gLeaderAt = 0
        return
      }
      gLeaderAt = 0
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

  // Route a command-palette pick. Reuses the same space-switch + panel-open
  // plumbing as the Summary jumps. Space-scoped screens (okr/focus/roadmap/
  // park/reflect) need the target's space committed first, or the screen would
  // render the wrong space's data.
  function handleSearchPick(entry: SearchEntry) {
    const r = entry.route
    if (r.spaceId) switchSpace(r.spaceId)
    if (r.taskId) setTasksInitialId(r.taskId)
    if (r.noteId) setNotesInitialId(r.noteId)
    if (r.objectiveId) setOpenObjectiveId(r.objectiveId)
    if (r.screen === 'reflect' && r.spaceId && r.weekStart) {
      setWeekStartForSpace(r.spaceId, () => r.weekStart!)
    }
    if (r.krId) setInitialKRId(r.krId)
    goToScreen(r.screen as Screen)
    if (isMobile) setDrawerOpen(false)
  }

  // Space-scoped data — everything filters from the active space's objectives.
  // activeSpaceId always holds a real space; the Overview screen consumes the
  // un-scoped lists directly through Summary and doesn't read these slices.
  const activeSpace = spaces.find(s => s.id === activeSpaceId)
  const spaceObjectives = objectives.filter(o => o.space_id === activeSpaceId)
  const spaceRoadmapItems = roadmapItems.filter(i => i.space_id === activeSpaceId)
  const spaceRoadmapItemIds = new Set(spaceRoadmapItems.map(i => i.id))
  const spaceCheckins = checkins.filter(c => spaceRoadmapItemIds.has(c.roadmap_item_id))
  const spaceReviews = reviews.filter(r => r.space_id === activeSpaceId)
  const spaceTasks = tasks.filter(t => t.space_id === activeSpaceId)
  // In-progress draft for this space (Step 1 saved, Step 2 abandoned).
  // Surfaced as the page-level banner below — the lighter parallel to the
  // forced-launcher overlay. Null when no draft, so the banner stays hidden.
  // Multiple drafts shouldn't exist in practice (unique constraint on
  // (space_id, week_start) + only commitFinish/skipWeek set closed_at), so
  // first match is fine.
  const draftReview = spaceReviews.find(r => r.closed_at == null) ?? null

  // Nav click handler — just setScreen now (the Focus week-snap was removed
  // along with the Focus screen).
  function goToScreen(target: Screen) {
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
        homeAttentionCount={(() => {
          const td = new Date()
          const today = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}`
          return tasks.filter(t => !t.completed_at && !t.parent_task_id && t.due_date && t.due_date < today).length
        })()}
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
        agentWorking={agentPending}
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
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 25,
          display: 'flex', alignItems: 'center', gap: 10,
          paddingTop: 'max(10px, env(safe-area-inset-top))',
          paddingBottom: 10,
          paddingLeft: 14,
          paddingRight: 14,
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
      {/* Spacer that compensates for the fixed mobile top bar height so content isn't hidden under it */}
      {isMobile && <div style={{ height: 'calc(48px + max(0px, env(safe-area-inset-top)))' }} />}
      {/* Tasks/Notes/Tags use full viewport width for their multi-pane layouts;
          all other screens get the standard centered main with conditional
          maxWidth (Roadmap/Summary/panels widen; otherwise narrow). */}
      {screen === 'home' && !loading ? (
        <main style={{ padding: isMobile ? '16px 14px' : '24px 28px', width: '100%' }}>
          <Home
            spaces={spaces}
            objectives={objectives}
            roadmapItems={roadmapItems}
            actions={actions}
            setActions={setActions}
            metricCheckins={metricCheckins}
            tasks={tasks}
            setTasks={setTasks}
            habitCheckins={habitCheckins}
            setHabitCheckins={setHabitCheckins}
            notes={notes}
            setNotes={setNotes}
            notebooks={notebooks}
            tagsByNote={tagsByNote}
            setTagsByNote={setTagsByNote}
            googleConnected={googleConnected}
            driveGranted={driveGranted}
            trackedFiles={trackedFiles}
            setTrackedFiles={setTrackedFiles}
            reviews={reviews}
            weekForSpace={weekForSpace}
            onCloseWeek={(spaceId, week) => setClosingWizard({ spaceId, week })}
            onOpenNote={id => { setNotesInitialId(id); setScreen('notes') }}
            onOpenTasks={() => setScreen('tasks')}
            onOpenCalendar={() => setScreen('calendar')}
            onLogMetric={krId => setLoggingMetricKRId(krId)}
            setObjectives={setObjectives}
            setRoadmapItems={setRoadmapItems}
            onOpenObjective={setOpenObjectiveId}
            logs={logs}
            setLogs={setLogs}
            initialKRId={initialKRId}
            onConsumeInitialKRId={() => setInitialKRId(null)}
            toast={setToast}
          />
        </main>
      ) : screen === 'tasks' && !loading ? (
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
          roadmapItems={roadmapItems}
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
      ) : screen === 'calendar' && !loading ? (
        <Calendar
          spaces={spaces}
          objectives={objectives}
          roadmapItems={roadmapItems}
          actions={actions}
          tasks={tasks}
          capacityBlocks={capacityBlocks}
          setCapacityBlocks={setCapacityBlocks}
          calendarBlocks={calendarBlocks}
          setCalendarBlocks={setCalendarBlocks}
          googleConnected={googleConnected}
          onConnectGoogle={connectGoogle}
          onDisconnectGoogle={disconnectGoogle}
          toast={setToast}
        />
      ) : screen === 'files' && !loading ? (
        <Files
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          roadmapItems={roadmapItems}
          trackedFiles={trackedFiles}
          setTrackedFiles={setTrackedFiles}
          fileVersions={fileVersions}
          setFileVersions={setFileVersions}
          driveGranted={driveGranted}
          onConnectGoogle={connectGoogle}
          toast={setToast}
        />
      ) : screen === 'agent' && !loading ? (
        <Agent
          tasks={tasks}
          setTasks={setTasks}
          roadmapItems={roadmapItems}
          setRoadmapItems={setRoadmapItems}
          spaces={spaces}
          setCalendarBlocks={setCalendarBlocks}
          notes={notes}
          setNotes={setNotes}
          objectives={objectives}
          setObjectives={setObjectives}
          onOpenNote={id => { setNotesInitialId(id); setScreen('notes') }}
          messages={agentMessages}
          setMessages={setAgentMessages}
          pending={agentPending}
          setPending={setAgentPending}
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
      ) : screen === 'settings' && !loading ? (
        <Settings toast={setToast} googleConnected={googleConnected} driveGranted={driveGranted} onConnectGoogle={connectGoogle} />
      ) : (
      <main style={{ padding: isMobile ? '16px 14px' : '24px 28px', maxWidth: screen === 'roadmap' ? 1280 : 800, width: '100%', margin: '0 auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10, color: 'var(--navy-400)', fontSize: 13 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
            Loading…
          </div>
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
                  onClick={() => setClosingWizard({ spaceId: draftReview.space_id, week: draftReview.week_start })}
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
            {screen === 'roadmap' && <Roadmap objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} activeSpaceId={activeSpaceId} toast={setToast} initialKRId={initialKRId} onConsumeInitialKRId={() => setInitialKRId(null)} />}
            {screen === 'reflect' && <Reflect reviews={reviews} setReviews={setReviews} spaces={spaces} weekForSpace={weekForSpace} onCloseWeek={(spaceId, week) => setClosingWizard({ spaceId, week })} onPlanWeek={(spaceId, week) => setPlanningWizard({ spaceId, week })} roadmapItems={roadmapItems} metricCheckins={metricCheckins} habitCheckins={habitCheckins} onLogMetric={krId => setLoggingMetricKRId(krId)} toast={setToast} />}
            {screen === 'park'    && <ParkingLot objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} activeSpaceId={activeSpaceId} setRoadmapItems={setRoadmapItems} toast={setToast} />}
          </>
        )}
      </main>
      )}
      </div>

      {/* Objective panel (links/logs) — opened from Home's objective cards.
          Page-level right drawer so it overlays any non-OKR screen. The OKR tab
          still renders its own inline panel. */}
      {openObjectiveId && (() => {
        const openObj = objectives.find(o => o.id === openObjectiveId)
        if (!openObj) return null
        const objKRs = roadmapItems.filter(i => i.annual_objective_id === openObjectiveId)
        return (
          <>
            <div onClick={() => setOpenObjectiveId(null)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300 }} />
            <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(520px, 94vw)', background: 'var(--surface)', borderLeft: '1px solid var(--line)', zIndex: 301, overflowY: 'auto', padding: '16px 18px', boxShadow: '-12px 0 40px rgba(0,0,0,.4)' }}>
              <ObjectivePanel
                objective={openObj}
                krs={objKRs}
                links={links.filter(l => l.objective_id === openObjectiveId)}
                logs={logs.filter(l => l.objective_id === openObjectiveId)}
                setLinks={setLinks}
                setLogs={setLogs}
                onClose={() => setOpenObjectiveId(null)}
                toast={setToast}
              />
            </div>
          </>
        )
      })()}

      {/* FastCapture — visible on every screen including Overview. Targets
          the currently active real space; suppressed only if there's no real
          space at all (no-op edge case for fresh users with zero spaces). */}
      {activeSpaceId && (
      <FastCapture
        spaces={spaces}
        objectives={objectives}
        roadmapItems={roadmapItems}
        weekStart={weekStart}
        activeSpaceId={activeSpaceId}
        setObjectives={setObjectives}
        setRoadmapItems={setRoadmapItems}
        setActions={setActions}
        setTasks={setTasks}
        setNotes={setNotes}
        toast={setToast}
        openRequest={captureRequest}
      />
      )}

      {/* Close-week wizard — lifted to page level so forced launch can overlay
          any screen. Launched by Focus's "Close week →", Reflect's per-space
          launcher, or the forced-launch effect. Data is re-derived for the
          target space so any space closes correctly, not just the active one. */}
      {closingWizard && (() => {
        const cs = closingWizard.spaceId
        const csKRs = roadmapItems.filter(i => i.space_id === cs)
        const csKRIds = new Set(csKRs.map(i => i.id))
        return (
          <CloseWeekWizard
            closingWeek={closingWizard.week}
            objectives={objectives.filter(o => o.space_id === cs)}
            roadmapItems={csKRs}
            setRoadmapItems={setRoadmapItems}
            actions={actions.filter(a => csKRIds.has(a.roadmap_item_id))}
            setActions={setActions}
            habitCheckins={habitCheckins.filter(h => csKRIds.has(h.roadmap_item_id))}
            metricCheckins={metricCheckins.filter(m => csKRIds.has(m.roadmap_item_id))}
            setMetricCheckins={setMetricCheckins}
            reviews={reviews.filter(r => r.space_id === cs)}
            setReviews={setReviews}
            setWeekStart={updater => setWeekStartForSpace(cs, updater)}
            logs={logs.filter(l => csKRIds.has(l.roadmap_item_id ?? ""))}
            activeSpaceId={cs}
            toast={setToast}
            onClose={() => setClosingWizard(null)}
          />
        )
      })()}

      {/* Plan-week wizard — same per-space launch model as the close wizard.
          Launched from Reflect's launcher (or Focus's own copy until it's
          deleted). Re-derives the target space's objectives/KRs. */}
      {planningWizard && (() => {
        const ps = planningWizard.spaceId
        return (
          <PlanWeek
            objectives={objectives.filter(o => o.space_id === ps)}
            roadmapItems={roadmapItems.filter(i => i.space_id === ps)}
            weekStart={planningWizard.week}
            onAddAction={a => setActions(prev => [...prev, a])}
            onClose={() => setPlanningWizard(null)}
          />
        )
      })()}

      {/* Metric log modal — lives at page level so any screen can open it.
          Today only triggered from OKR cards, but Reflect history / wizard
          nudges will hook in later without re-plumbing. */}
      {loggingMetricKRId && (() => {
        const kr = roadmapItems.find(i => i.id === loggingMetricKRId)
        if (!kr) return null
        return (
          <MetricLogModal
            kr={kr}
            checkins={metricCheckins}
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
