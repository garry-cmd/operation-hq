'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, DailyCheckin, WeeklyReview, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin, Notebook, Note, TrackedFile, FileVersion } from '@/lib/types'
import { getMonday, ACTIVE_Q, formatWeek } from '@/lib/utils'
import * as objectivesDb from '@/lib/db/objectives'
import * as krsDb from '@/lib/db/krs'
import * as actionsDb from '@/lib/db/actions'
import * as checkinsDb from '@/lib/db/checkins'
import * as reviewsDb from '@/lib/db/reviews'
import * as extrasDb from '@/lib/db/objectiveExtras'
import * as spacesDb from '@/lib/db/spaces'
import * as shareTokensDb from '@/lib/db/shareTokens'
import * as notebooksDb from '@/lib/db/notebooks'
import * as notesDb from '@/lib/db/notes'
import * as googleTokensDb from '@/lib/db/googleTokens'
import * as trackedFilesDb from '@/lib/db/trackedFiles'
import * as qrDb from '@/lib/db/quarterReviews'
import type { QuarterReview as QRType } from '@/lib/db/quarterReviews'
import { extractNoteText } from '@/lib/noteText'
import Roadmap from '@/components/Roadmap'
import ObjectivePanel from '@/components/ObjectivePanel'
import Reflect from '@/components/Reflect'
import ParkingLot from '@/components/ParkingLot'
import Home from '@/components/Home'
import Agent, { type ChatMsg } from '@/components/Agent'
import Notes from '@/components/Notes'
import Tags from '@/components/Tags'
import Settings from '@/components/Settings'
import Files from '@/components/Files'
import { ensurePushSubscription } from '@/lib/push/ensurePush'
import FastCapture from '@/components/FastCapture'
import Toast from '@/components/Toast'
import NavRail from '@/components/NavRail'
import CommandPalette from '@/components/CommandPalette'
import type { SearchEntry } from '@/lib/search'
import { ObjectiveIcon, KRIcon, ActionIcon, NoteIcon, ReflectIcon, SpaceIcon, SearchNotebookIcon } from '@/components/Icons'
import CloseWeekWizard from '@/components/CloseWeekWizard'
import QuarterCloseWizard from '@/components/QuarterCloseWizard'
import MetricLogModal from '@/components/MetricLogModal'
import { useIsMobile } from '@/lib/useIsMobile'
import type { User } from '@supabase/supabase-js'
import type { QuarterReview } from '@/lib/types'
import { checkIsTauri, onTauriEvent } from '@/lib/tauri'
import Tasks from '@/components/Tasks'
import * as tasksDb from '@/lib/db/tasks'
import type { Task, TaskTag } from '@/lib/types'

type Screen = 'home' | 'agent' | 'reflect' | 'roadmap' | 'park' | 'notes' | 'files' | 'tags' | 'settings' | 'tasks' | 'profile'


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
  const [captureRequest, setCaptureRequest] = useState<{ type: 'note'; key: number } | null>(null)

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
  const [quarterReviews, setQuarterReviews] = useState<QRType[]>([])
  const [habitSnapshots, setHabitSnapshots] = useState<import('@/lib/db/quarterReviews').QuarterHabitSnapshot[]>([])
  // 0 = show ACTIVE_Q window, 1 = show one quarter ahead (for post-close planning)
  const [roadmapPlanningOffset, setRoadmapPlanningOffset] = useState<number>(() => {
    try { const v = window.localStorage.getItem('hq-roadmap-offset'); return v !== null ? Number(v) : 0 } catch { return 0 }
  })
  useEffect(() => { try { window.localStorage.setItem('hq-roadmap-offset', String(roadmapPlanningOffset)) } catch {} }, [roadmapPlanningOffset])
  const [links, setLinks] = useState<ObjectiveLink[]>([])
  const [logs, setLogs] = useState<ObjectiveLog[]>([])
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
  const [tasks, setTasks] = useState<Task[]>([])
  const [tagsByTask, setTagsByTask] = useState<Record<string, string[]>>({})
  const [shareToken, setShareToken] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  const [closingWizard, setClosingWizard] = useState<{ spaceId: string; week: string } | null>(null)
  const [quarterClose, setQuarterClose] = useState<{ quarter: string; spaceId: string | null } | null>(null)
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
    const [o, r, a, ci, hc, mc, rv, qr, hs, lk, lg, sp, st, nb, nt, gstat, tf, fv] = await Promise.all([
      objectivesDb.listAll().catch(fallback('objectives', [] as AnnualObjective[])),
      krsDb.listAll().catch(fallback('roadmap_items', [] as RoadmapItem[])),
      actionsDb.listAll().catch(fallback('weekly_actions', [] as WeeklyAction[])),
      checkinsDb.daily.listAll().catch(fallback('daily_checkins', [] as DailyCheckin[])),
      checkinsDb.habit.listAll().catch(fallback('habit_checkins', [] as HabitCheckin[])),
      checkinsDb.metric.listAll().catch(fallback('metric_checkins', [] as MetricCheckin[])),
      reviewsDb.listAll().catch(fallback('weekly_reviews', [] as WeeklyReview[])),
      qrDb.listAll().catch(fallback('quarter_reviews', [] as QRType[])),
      qrDb.listAllHabitSnapshots().catch(fallback('quarter_habit_snapshots', [] as import('@/lib/db/quarterReviews').QuarterHabitSnapshot[])),
      extrasDb.links.listAll().catch(fallback('objective_links', [] as ObjectiveLink[])),
      extrasDb.logs.listAll().catch(fallback('objective_logs', [] as ObjectiveLog[])),
      spacesDb.listAll().catch(fallback('spaces', [] as Space[])),
      shareTokensDb.findActiveByLabel('Melissa').catch(fallback('share_tokens', null)),
      notebooksDb.listAll().catch(fallback('notebooks', [] as Notebook[])),
      notesDb.listAll().catch(fallback('notes', [] as Note[])),
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
    setQuarterReviews(qr)
    setHabitSnapshots(hs)
    setLogs(lg)
    setSpaces(sp)
    if (st) setShareToken(st.token)
    setNotebooks(nb)
    setNotes(nt)
    setGoogleConnected(gstat.connected)
    setDriveGranted(gstat.driveGranted)
    setTrackedFiles(tf)
    setFileVersions(fv)
    // Note tags:
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
    // Tasks + task tags
    try {
      const taskRows = await tasksDb.listAll()
      setTasks(taskRows)
      if (taskRows.length > 0) {
        const tagRows = await tasksDb.listTagsForTasks(taskRows.map(t => t.id))
        const tmap: Record<string, string[]> = {}
        for (const row of tagRows) {
          tmap[row.task_id] = [...(tmap[row.task_id] ?? []), row.tag]
        }
        setTagsByTask(tmap)
      }
    } catch (err) {
      console.error('loadAll: tasks failed:', err)
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
        id: `obj:${o.id}`, kind: 'Objective', icon: <ObjectiveIcon size={12}/>, title: o.name,
        ...spaceMeta(o.space_id), rec: recency(o.created_at),
        route: { screen: 'home', spaceId: o.space_id, objectiveId: o.id },
      })
    }

    for (const i of roadmapItems) {
      const parked = i.is_parked
      out.push({
        id: `kr:${i.id}`, kind: 'Key Result', icon: <KRIcon size={12}/>, title: i.title,
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
        id: `act:${a.id}`, kind: 'Action', icon: <ActionIcon size={12}/>, title: a.title,
        ...spaceMeta(sid), hint: thisWeek ? 'this week' : undefined,
        done: a.completed, rec: thisWeek ? 8 : 2,
        route: { screen: 'home', spaceId: sid, krId: a.roadmap_item_id },
      })
    }

    for (const n of notes) {
      out.push({
        id: `note:${n.id}`, kind: 'Note', icon: <NoteIcon size={12}/>, title: n.title || 'Untitled',
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
        id: `refl:${r.id}`, kind: 'Reflect', icon: <ReflectIcon size={12}/>,
        title: `Reflection · ${formatWeek(r.week_start)}`, body: text,
        ...spaceMeta(r.space_id),
        route: { screen: 'reflect', spaceId: r.space_id, weekStart: r.week_start },
      })
    }

    for (const nb of notebooks) {
      out.push({
        id: `nb:${nb.id}`, kind: 'Notebook', icon: <SearchNotebookIcon size={12}/>, title: nb.name,
        ...spaceMeta(nb.space_id),
        route: { screen: 'notes', spaceId: nb.space_id },
      })
    }

    for (const s of spaces) {
      out.push({
        id: `space:${s.id}`, kind: 'Space', icon: <SpaceIcon size={12}/>, title: s.name,
        spaceColor: s.color,
        route: { screen: 'home', spaceId: s.id },
      })
    }

    return out
  }, [objectives, roadmapItems, actions, notes, reviews, notebooks, spaces, tagsByNote, weekStartBySpace, legacyWeekStart])

  // Global keyboard layer:
  //   ⌘K  command palette
  //   ⌘T  new task   ·  ⌘N  new note   (PWA only — browser tabs reserve ⌘T/⌘N)
  //   g <key>  go-to nav:  h Home · n Notes · r Roadmap · s Scout · f Reflect · p Parking
  useEffect(() => {
    let gLeaderAt = 0
    const GO: Record<string, Screen> = {
      h: 'home', n: 'notes', r: 'roadmap', s: 'agent', f: 'reflect', p: 'park',
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
        if (k === 't') { e.preventDefault(); setCaptureRequest({ type: 'note', key: Date.now() }); return }
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

  // ── Tauri bridge ─────────────────────────────────────────────────────────
  // Detect Tauri on mount (so isTauri() is ready synchronously for pickers),
  // then listen for global-shortcut events from the Rust shell.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    checkIsTauri().then(detected => {
      if (!detected) return
      onTauriEvent('hq:capture', () => {
        setCaptureRequest({ type: 'note', key: Date.now() })
      }).then(fn => { unlisten = fn })
    })
    return () => { unlisten?.() }
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
      {!isMobile && !(notesFocus && !isMobile) && (
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
        onSpaceDeleted={spaceId => {
          // Collect KR ids in this space before wiping them, so actions can be purged too
          const deletedKRIds = new Set(roadmapItems.filter(i => i.space_id === spaceId).map(i => i.id))
          setSpaces(prev => {
            const remaining = prev.filter(s => s.id !== spaceId)
            if (activeSpaceId === spaceId && remaining.length > 0) switchSpace(remaining[0].id)
            return remaining
          })
          setObjectives(prev => prev.filter(o => o.space_id !== spaceId))
          setRoadmapItems(prev => prev.filter(i => i.space_id !== spaceId))
          setActions(prev => prev.filter(a => !deletedKRIds.has(a.roadmap_item_id)))
          setReviews(prev => prev.filter(r => r.space_id !== spaceId))
        }}

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
        isMobile={false}
        isOpen={false}
        onClose={() => {}}
      />
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : 0, paddingBottom: isMobile ? 'calc(84px + env(safe-area-inset-bottom, 0px))' : 0 }}>
      {/* Mobile-only bottom nav — replaces the hamburger/drawer on small screens.
          Five primary tabs; secondary screens (Reflect, Settings, etc.) accessible
          via NavRail which still renders as a slide-in drawer when triggered from
          the Agent or Settings gear. Hidden on desktop where NavRail is permanent. */}
      {isMobile && (() => {
        const overdueCount = tasks.filter(t => !t.completed_at && t.due_date && t.due_date < new Date().toISOString().slice(0, 10)).length
        const ICON_COLOR = (active: boolean) => active ? 'var(--accent)' : 'var(--navy-500)'
        const LABEL_COLOR = (active: boolean) => active ? 'var(--accent)' : 'var(--navy-500)'
        const tabs: { id: Screen; label: string; icon: React.ReactNode; badge?: number }[] = [
          { id: 'home', label: 'Home', icon: (
            <svg width="23" height="23" viewBox="0 0 24 24" fill={screen === 'home' ? 'var(--accent)' : 'none'} stroke={ICON_COLOR(screen === 'home')} strokeWidth="1.7">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            </svg>
          )},
          { id: 'notes', label: 'Notes', icon: (
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR(screen === 'notes')} strokeWidth="1.7">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          )},
          { id: 'tasks', label: 'Tasks', badge: overdueCount || undefined, icon: (
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR(screen === 'tasks')} strokeWidth="1.7">
              <polyline points="9 11 12 14 22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          )},
          { id: 'roadmap', label: 'Roadmap', icon: (
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR(screen === 'roadmap')} strokeWidth="1.7">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="9" y1="21" x2="9" y2="9"/>
            </svg>
          )},
          { id: 'agent', label: 'Agent', icon: (
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR(screen === 'agent')} strokeWidth="1.7">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          )},
          { id: 'profile', label: 'Me', icon: (
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={ICON_COLOR(screen === 'profile' || screen === 'settings' || screen === 'reflect' || screen === 'park' || screen === 'files' || screen === 'tags')} strokeWidth="1.7">
              <circle cx="12" cy="8" r="4"/>
              <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/>
            </svg>
          )},
        ]
        const profileSubs: Screen[] = ['profile', 'settings', 'reflect', 'park', 'files', 'tags']
        const isTabActive = (id: Screen) => id === 'profile' ? profileSubs.includes(screen) : screen === id
        return (
          <div style={{
            position: 'fixed',
            left: 14, right: 14,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
            zIndex: 50,
            height: 62,
            borderRadius: 999,
            background: theme === 'dark' ? 'rgba(16,21,33,.92)' : 'rgba(255,255,255,.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--navy-600)',
            boxShadow: '0 8px 32px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.2)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 6px',
          }}>
            {tabs.map(tab => {
              const active = isTabActive(tab.id)
              return (
                <button key={tab.id} style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 2, cursor: 'pointer', border: 'none',
                  background: 'transparent', position: 'relative', padding: 0,
                }} onClick={() => goToScreen(tab.id)}>
                  {tab.badge ? (
                    <div style={{ position: 'absolute', top: -3, right: 'calc(50% - 20px)', background: '#ff6452', color: '#fff', fontSize: 8, fontWeight: 700, minWidth: 14, height: 14, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', zIndex: 2 }}>
                      {tab.badge}
                    </div>
                  ) : null}
                  {/* tinted bubble behind active icon — Evernote-style */}
                  <div style={{
                    width: 52, height: 30, borderRadius: 999,
                    background: active ? 'var(--accent-dim, rgba(77,143,255,.16))' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background .15s',
                    color: ICON_COLOR(active),
                  }}>{tab.icon}</div>
                  <span style={{ fontSize: 9.5, fontWeight: active ? 600 : 500, color: LABEL_COLOR(active), letterSpacing: '.01em' }}>{tab.label}</span>
                </button>
              )
            })}
          </div>
        )
      })()}
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
            habitCheckins={habitCheckins}
            setHabitCheckins={setHabitCheckins}
            notes={notes}
            setNotes={setNotes}
            notebooks={notebooks}
            tagsByNote={tagsByNote}
            setTagsByNote={setTagsByNote}
            driveGranted={driveGranted}
            trackedFiles={trackedFiles}
            setTrackedFiles={setTrackedFiles}
            reviews={reviews}
            weekForSpace={weekForSpace}
            onCloseWeek={(spaceId, week) => setClosingWizard({ spaceId, week })}
            onOpenNote={id => { setNotesInitialId(id); setScreen('notes') }}
            onLogMetric={krId => setLoggingMetricKRId(krId)}
            setObjectives={setObjectives}
            setRoadmapItems={setRoadmapItems}
            onOpenObjective={setOpenObjectiveId}
            links={links}
            logs={logs}
            setLogs={setLogs}
            initialKRId={initialKRId}
            onConsumeInitialKRId={() => setInitialKRId(null)}
            onQuarterClose={(quarter, spaceId) => setQuarterClose({ quarter, spaceId })}
            quarterReviews={quarterReviews}
            toast={setToast}
          />
        </main>

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

      ) : screen === 'tasks' && !loading ? (
        <Tasks
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          roadmapItems={roadmapItems}
          tasks={tasks}
          setTasks={setTasks}
          tagsByTask={tagsByTask}
          toast={setToast}
        />
      ) : screen === 'profile' && !loading ? (
        <main style={{ padding: '20px 16px', width: '100%', maxWidth: 600, margin: '0 auto' }}>
          {/* Identity block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 19, fontWeight: 700, letterSpacing: '.02em',
            }}>{initials}</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)' }}>Garry</div>
              <div style={{ fontSize: 12, color: 'var(--navy-400)' }}>{user?.email ?? ''}</div>
            </div>
          </div>

          {/* Menu groups */}
          {([
            { label: 'Screens', items: [
              { label: 'Reflect', icon: '◷', action: () => goToScreen('reflect') },
              { label: 'Parking', icon: '⊟', action: () => goToScreen('park') },
              { label: 'Files', icon: '⊞', action: () => goToScreen('files') },
              { label: 'Tags', icon: '#', action: () => goToScreen('tags') },
            ]},
            { label: 'Preferences', items: [
              { label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme === 'dark' ? '☀' : '☾', action: toggleTheme },
              { label: 'Settings', icon: '⚙', action: () => goToScreen('settings') },
            ]},
            { label: 'Account', items: [
              { label: 'Copy share link', icon: '⧉', action: copyShareLink },
              { label: 'Sign out', icon: '→', action: () => supabase.auth.signOut(), danger: true },
            ]},
          ] as { label: string; items: { label: string; icon: string; action: () => void; danger?: boolean }[] }[]).map(group => (
            <div key={group.label} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--nw-label)', letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 8, paddingLeft: 2 }}>
                {group.label}
              </div>
              <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, overflow: 'hidden' }}>
                {group.items.map((item, i) => (
                  <button
                    key={item.label}
                    onClick={item.action}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      width: '100%', padding: '14px 16px',
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderTop: i > 0 ? '1px solid var(--navy-700)' : 'none',
                      fontSize: 14, color: item.danger ? '#ff6452' : 'var(--navy-100)',
                      fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 22, textAlign: 'center', fontSize: 15, color: item.danger ? '#ff6452' : 'var(--navy-400)' }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <span style={{ color: 'var(--navy-500)', fontSize: 13 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </main>
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
          roadmapItems={roadmapItems}
          setRoadmapItems={setRoadmapItems}
          spaces={spaces}
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
            {screen === 'roadmap' && <Roadmap objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} activeSpaceId={activeSpaceId} toast={setToast} initialKRId={initialKRId} onConsumeInitialKRId={() => setInitialKRId(null)} planningOffset={roadmapPlanningOffset} onSetPlanningOffset={setRoadmapPlanningOffset} />}
            {screen === 'reflect' && <Reflect reviews={reviews} setReviews={setReviews} quarterReviews={quarterReviews} habitSnapshots={habitSnapshots} spaces={spaces} weekForSpace={weekForSpace} onCloseWeek={(spaceId, week) => setClosingWizard({ spaceId, week })} onQuarterClose={(quarter, spaceId) => setQuarterClose({ quarter, spaceId })} roadmapItems={roadmapItems} metricCheckins={metricCheckins} habitCheckins={habitCheckins} onLogMetric={krId => setLoggingMetricKRId(krId)} toast={setToast} />}
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
            setHabitCheckins={setHabitCheckins}
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


      {/* Quarter-close ceremony — fullscreen overlay. Launched from Home header or Reflect.
          spaceId null means all-spaces view (runs across all objectives/KRs). */}
      {quarterClose && (() => {
        const qc = quarterClose
        const qcSpace = spaces.find(s => s.id === qc.spaceId) ?? null
        const qcItems = roadmapItems.filter(i =>
          i.quarter === qc.quarter &&
          (qc.spaceId === null || i.space_id === qc.spaceId) &&
          !i.is_parked
        )
        const qcObjs = objectives.filter(o =>
          qc.spaceId === null || o.space_id === qc.spaceId
        )
        return (
          <QuarterCloseWizard
            quarter={qc.quarter}
            space={qcSpace}
            spaces={spaces}
            objectives={qcObjs}
            roadmapItems={qcItems}
            setRoadmapItems={setRoadmapItems}
            habitCheckins={habitCheckins}
            toast={setToast}
            onClose={() => setQuarterClose(null)}
            onSeal={async () => {
              // Refresh the quarter reviews list so Reflect shows the new entry immediately.
              try {
                const [fresh, freshSnaps] = await Promise.all([
                  qrDb.listAll(),
                  qrDb.listAllHabitSnapshots(),
                ])
                setQuarterReviews(fresh)
                setHabitSnapshots(freshSnaps)
              } catch { /* non-fatal */ }
            }}
            onPlanNextQuarter={() => setScreen('roadmap')}
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
