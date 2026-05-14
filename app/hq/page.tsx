'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, DailyCheckin, WeeklyReview, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin } from '@/lib/types'
import { getMonday, ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'
import * as objectivesDb from '@/lib/db/objectives'
import * as krsDb from '@/lib/db/krs'
import * as actionsDb from '@/lib/db/actions'
import * as checkinsDb from '@/lib/db/checkins'
import * as reviewsDb from '@/lib/db/reviews'
import * as extrasDb from '@/lib/db/objectiveExtras'
import * as spacesDb from '@/lib/db/spaces'
import * as shareTokensDb from '@/lib/db/shareTokens'
import Roadmap from '@/components/Roadmap'
import OKRs from '@/components/OKRs'
import Focus from '@/components/Focus'
import Reflect from '@/components/Reflect'
import ParkingLot from '@/components/ParkingLot'
import Summary from '@/components/Summary'
import FastCapture from '@/components/FastCapture'
import Toast from '@/components/Toast'
import SpaceSwitcher from '@/components/SpaceSwitcher'
import CloseWeekWizard from '@/components/CloseWeekWizard'
import MetricLogModal from '@/components/MetricLogModal'
import type { User } from '@supabase/supabase-js'

type Screen = 'reflect' | 'focus' | 'okr' | 'roadmap' | 'park'

// MUST match the value in components/SpaceSwitcher.tsx. When the activeSpaceId
// equals this sentinel, page.tsx routes to Summary (cross-space view) instead
// of any of the regular tabs. The bottom nav and FastCapture stay visible —
// nav clicks pivot back into the last-used real space, and FastCapture targets
// that space too. (See goToScreen + fastCaptureSpaceId below.)
const ALL_SPACES_ID = '__all__'

interface SearchResult { label: string; sub: string; screen: Screen }

export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('okr')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [weekStart, setWeekStartRaw] = useState<string>(getMonday())
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)

  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([])
  const [actions, setActions] = useState<WeeklyAction[]>([])
  const [checkins, setCheckins] = useState<DailyCheckin[]>([])
  const [habitCheckins, setHabitCheckins] = useState<HabitCheckin[]>([])
  const [metricCheckins, setMetricCheckins] = useState<MetricCheckin[]>([])
  const [reviews, setReviews] = useState<WeeklyReview[]>([])
  const [links, setLinks] = useState<ObjectiveLink[]>([])
  const [logs, setLogs] = useState<ObjectiveLog[]>([])
  const [shareToken, setShareToken] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  // Most-recently-used real (non-sentinel) space. Tracked separately from
  // activeSpaceId so the bottom nav and FastCapture have a target when the
  // user is in All Spaces mode — clicking a nav tab from All Spaces switches
  // back into this space, and FastCapture writes here. Persisted so the
  // value survives a reload that lands directly on All Spaces.
  const [lastRealSpaceId, setLastRealSpaceId] = useState('')
  const [closingWizard, setClosingWizard] = useState<string | null>(null)
  const [loggingMetricKRId, setLoggingMetricKRId] = useState<string | null>(null)
  // Currently-open action panel on the Focus tab. Lifted to page level so
  // <main> can widen its max-width when the panel is open (push-aside layout).
  const [openActionId, setOpenActionId] = useState<string | null>(null)
  // Currently-open objective panel on the OKRs tab. Same pattern as
  // openActionId — lifted to page level so <main> can widen for it.
  const [openObjectiveId, setOpenObjectiveId] = useState<string | null>(null)

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

  // Restore the persisted Focus week on mount, but only if it's not stale.
  // Saved weeks in the past get ignored (you've been away too long; show
  // current week), saved weeks today-or-later get restored.
  useEffect(() => {
    const saved = localStorage.getItem('hq-week-start')
    const today = getMonday()
    if (saved && saved >= today) setWeekStartRaw(() => saved)
  }, [])

  // Persist alongside any state change. We do this in a setter wrapper rather
  // than a useEffect because useEffect fires on mount with the SSR/initial
  // state and would overwrite the saved value before the restore effect runs.
  const setWeekStart = (updater: (s: string) => string) => {
    setWeekStartRaw(prev => {
      const next = updater(prev)
      try { localStorage.setItem('hq-week-start', next) } catch { /* noop */ }
      return next
    })
  }

  function switchSpace(spaceId: string) {
    setActiveSpaceId(spaceId)
    localStorage.setItem('hq-active-space', spaceId)
    // Track last-real so All Spaces mode has a fallback for nav clicks and
    // FastCapture. The sentinel itself never becomes the "last real" target.
    if (spaceId !== ALL_SPACES_ID) {
      setLastRealSpaceId(spaceId)
      localStorage.setItem('hq-last-real-space-id', spaceId)
    }
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

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
    const [o, r, a, ci, hc, mc, rv, lk, lg, sp, st] = await Promise.all([
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
    // Set active space from localStorage or default to first.
    // The '__all__' sentinel isn't in `sp`, so handle it explicitly so
    // that "All Spaces" survives a reload like any real space.
    const savedSpaceId = localStorage.getItem('hq-active-space')
    let validId: string
    if (savedSpaceId === ALL_SPACES_ID) {
      validId = ALL_SPACES_ID
    } else {
      validId = sp.find(s => s.id === savedSpaceId)?.id ?? sp[0]?.id ?? ''
    }
    setActiveSpaceId(validId)
    // Hydrate last-real-space id. Falls back to the active id (when it's a
    // real space) and finally to the first space — so clicking a nav tab
    // from All Spaces always has somewhere to land, even on first run.
    const savedLastReal = localStorage.getItem('hq-last-real-space-id')
    const validLastReal =
      sp.find(s => s.id === savedLastReal)?.id
      ?? (validId !== ALL_SPACES_ID ? validId : sp[0]?.id)
      ?? ''
    setLastRealSpaceId(validLastReal)
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
    if (activeSpaceId === ALL_SPACES_ID) return // no single space to scope to
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

  // Search
  const searchResults: SearchResult[] = searchQuery.trim().length < 2 ? [] : (() => {
    const q = searchQuery.toLowerCase()
    const results: SearchResult[] = []
    objectives.forEach(o => { if (o.name.toLowerCase().includes(q)) results.push({ label: o.name, sub: 'Objective', screen: 'roadmap' }) })
    roadmapItems.filter(i => !i.is_parked).forEach(i => { if (i.title.toLowerCase().includes(q)) results.push({ label: i.title, sub: 'Key Result', screen: i.quarter === ACTIVE_Q ? 'okr' : 'roadmap' }) })
    actions.filter(a => a.week_start === weekStart).forEach(a => { if (a.title.toLowerCase().includes(q)) results.push({ label: a.title, sub: 'Action this week', screen: 'focus' }) })
    roadmapItems.filter(i => i.is_parked).forEach(i => { if (i.title.toLowerCase().includes(q)) results.push({ label: i.title, sub: 'Parking Lot', screen: 'park' }) })
    return results.slice(0, 6)
  })()

  function copyShareLink() {
    const link = `${window.location.origin}/share/${shareToken}`
    navigator.clipboard.writeText(link)
    setCopied(true); setAvatarOpen(false); setToast('Share link copied!')
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
  const isAllSpaces = activeSpaceId === ALL_SPACES_ID

  // Click handlers fired from Summary. Both flip out of all-spaces mode by
  // committing the target real space, then route into the right tab and
  // pop the corresponding panel — reusing the openObjectiveId / openActionId
  // plumbing that OKRs and Focus already wire up for in-space clicks.
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
    // actually surfaces the action. setWeekStart's wrapper persists it,
    // and the on-mount stale-week guard only runs once at boot.
    setWeekStart(() => action.week_start)
    setOpenActionId(action.id)
    setOpenObjectiveId(null)
  }

  // Checkbox handlers fired from Summary. Toggle in place; do NOT switch
  // space or screen. Keeps the user in the All Spaces overview while they
  // tick things off.
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
  // When in All Spaces mode these are all empty (no real space matches the
  // sentinel id), but Summary takes the un-scoped lists directly so it
  // doesn't matter. The space-scoped slices below stay safe to compute.
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

  // Nav click handler. From a real space, this is just setScreen. From All
  // Spaces, it pivots into the last-used real space first (per-screen tabs
  // assume a single space, so there's no useful "All Spaces Focus" view).
  // Fallback to first space if for some reason there's no last-real id.
  //
  // Focus snap: if weekStart is in the past, advance it to today's Monday.
  // Past weeks are read-only territory for the Reflect tab; Focus from the
  // bottom nav should land on "now," not wherever the user last walked
  // backward to with Focus's own ‹ button (which persisted to localStorage).
  // Forward weekStart values (e.g. pre-planned next week) are left alone.
  // Other entry points to Focus that intentionally target a specific week —
  // openActionFromSummary, the close-week wizard's commitFinish — set
  // weekStart directly without going through goToScreen, so they're
  // unaffected by this snap.
  function goToScreen(target: Screen) {
    if (isAllSpaces) {
      const fallbackId = lastRealSpaceId || spaces[0]?.id || ''
      if (fallbackId) switchSpace(fallbackId)
    }
    if (target === 'focus') {
      const today = getMonday()
      if (weekStart < today) setWeekStart(() => today)
    }
    setScreen(target)
  }

  // FastCapture target — uses the active space normally, falls back to the
  // last-used real space when in All Spaces. Empty string means "nothing to
  // target" (only possible for fresh users with zero spaces); in that case
  // the FastCapture FAB is suppressed entirely.
  const fastCaptureSpaceId = isAllSpaces ? lastRealSpaceId : activeSpaceId
  const fastCaptureObjectives = isAllSpaces
    ? objectives.filter(o => o.space_id === lastRealSpaceId)
    : spaceObjectives
  const fastCaptureRoadmapItems = isAllSpaces
    ? roadmapItems.filter(i => i.space_id === lastRealSpaceId)
    : spaceRoadmapItems

  // Nav — Reflect | Focus | OKRs⚡ | Roadmap | Parking. Active highlight is
  // suppressed in All Spaces (no tab is the "current" tab when the cross-
  // space view is active — the SpaceSwitcher's "All Spaces" entry carries
  // that visual instead).
  const navActive = (id: Screen) => !isAllSpaces && screen === id
  const NAV: { id: Screen; label: string; icon: React.ReactNode; fab?: boolean }[] = [
    { id: 'reflect',  label: 'Reflect',  icon: <ReflectIcon  active={navActive('reflect')} /> },
    { id: 'focus',    label: 'Focus',    icon: <FocusIcon    active={navActive('focus')} /> },
    { id: 'okr',      label: 'OKRs',     icon: <OKRIcon />, fab: true },
    { id: 'roadmap',  label: 'Roadmap',  icon: <RoadmapIcon  active={navActive('roadmap')} /> },
    { id: 'park',     label: 'Parking',  icon: <ParkIcon     active={navActive('park')} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--navy-900)' }}>
      {/* Topbar */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, height: 54, background: 'var(--navy-800)', borderBottom: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--navy-50)' }}>
            Op <span style={{ color: 'var(--accent)' }}>HQ</span>
          </div>
          {spaces.length > 0 && (
            <SpaceSwitcher
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              objectives={objectives}
              roadmapItems={roadmapItems}
              onSelect={switchSpace}
              onSpaceCreated={space => setSpaces(prev => [...prev, space])}
              onSpaceUpdated={space => setSpaces(prev => prev.map(s => s.id === space.id ? space : s))}
            />
          )}
        </div>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--navy-700)', border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--navy-500)'}`, borderRadius: 99, height: 34, padding: '0 12px', transition: 'border-color .15s' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}><circle cx="5.5" cy="5.5" r="4" stroke="var(--navy-400)" strokeWidth="1.4"/><path d="M9 9l2.5 2.5" stroke="var(--navy-400)" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search objectives, key results, actions…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: 'var(--navy-100)', fontFamily: 'inherit' }} />
            {searchQuery && <button onClick={() => setSearchQuery('')} style={{ color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>}
          </div>
          {searchFocused && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 12, overflow: 'hidden', zIndex: 50 }}>
              {searchResults.map((r, i) => (
                <button key={i} onMouseDown={() => { setScreen(r.screen); setSearchQuery(''); setSearchFocused(false) }}
                  style={{ width: '100%', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2, background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-600)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <span style={{ fontSize: 12, color: 'var(--navy-50)', fontWeight: 500 }}>{r.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>{r.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Avatar */}
        <div ref={avatarRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setAvatarOpen(o => !o)}
            style={{ width: 32, height: 32, borderRadius: '50%', background: avatarOpen ? 'var(--accent)' : 'var(--accent-dim)', color: avatarOpen ? '#fff' : 'var(--accent)', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {initials}
          </button>
          {avatarOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 12, overflow: 'hidden', minWidth: 190, zIndex: 50 }}>
              <button onClick={() => { toggleTheme(); setAvatarOpen(false) }}
                style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', fontSize: 12, color: 'var(--navy-100)', textAlign: 'left' }}>
                {theme === 'dark'
                  ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M7 1v1M7 12v1M1 7h1M12 7h1M2.9 2.9l.7.7M10.4 10.4l.7.7M10.4 2.9l-.7.7M2.9 10.4l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7.5A5 5 0 1 1 6.5 2a3.5 3.5 0 0 0 5.5 5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                }
                {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </button>
              <button onClick={copyShareLink}
                style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', fontSize: 12, color: 'var(--navy-100)', textAlign: 'left' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="10.5" cy="3" r="1.75" stroke="currentColor" strokeWidth="1.3"/><circle cx="3.5" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.3"/><circle cx="10.5" cy="11" r="1.75" stroke="currentColor" strokeWidth="1.3"/><path d="M5.1 6.1l3.7-2.1M5.1 7.9l3.7 2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                Share with Melissa
              </button>
              <button onClick={() => supabase.auth.signOut()}
                style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--navy-300)', textAlign: 'left' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2H11.5C12.05 2 12.5 2.45 12.5 3V11C12.5 11.55 12.05 12 11.5 12H9M5.5 9.5L2 7M2 7L5.5 4.5M2 7H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main — Roadmap and Summary both get a wider cap because their dense layouts use the room directly; other tabs stay narrow on purpose so their side-space can be claimed deliberately. The okr+objectivePanel and focus+actionPanel cases also widen so the panel has room on the right. */}
      <main style={{ flex: 1, padding: '20px 16px 100px', maxWidth: isAllSpaces || screen === 'roadmap' || (screen === 'focus' && openActionId) || (screen === 'okr' && openObjectiveId) ? 1280 : 800, width: '100%', margin: '0 auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10, color: 'var(--navy-400)', fontSize: 13 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
            Loading…
          </div>
        ) : isAllSpaces ? (
          <Summary
            spaces={spaces}
            objectives={objectives}
            roadmapItems={roadmapItems}
            actions={actions}
            onOpenObjective={openObjectiveFromSummary}
            onOpenAction={openActionFromSummary}
            onToggleAction={toggleActionFromSummary}
            onToggleKR={toggleKRFromSummary}
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
            {screen === 'okr'     && <OKRs objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} actions={spaceActions} setActions={setActions} weekStart={weekStart} links={spaceLinks} logs={spaceLogs} setLinks={setLinks} setLogs={setLogs} openObjectiveId={openObjectiveId} setOpenObjectiveId={setOpenObjectiveId} activeSpaceId={activeSpaceId} habitCheckins={spaceHabitCheckins} metricCheckins={spaceMetricCheckins} toast={setToast} onLogMetric={krId => setLoggingMetricKRId(krId)} />}
            {screen === 'focus'   && <Focus objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} actions={spaceActions} setActions={setActions} habitCheckins={spaceHabitCheckins} setHabitCheckins={setHabitCheckins} weekStart={weekStart} setWeekStart={setWeekStart} toast={setToast} onRequestCloseWeek={week => setClosingWizard(week)} logs={spaceLogs} setLogs={setLogs} openActionId={openActionId} setOpenActionId={setOpenActionId} />}
            {screen === 'roadmap' && <Roadmap objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} activeSpaceId={activeSpaceId} toast={setToast} />}
            {screen === 'reflect' && <Reflect reviews={spaceReviews} setReviews={setReviews} toast={setToast} />}
            {screen === 'park'    && <ParkingLot objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} activeSpaceId={activeSpaceId} setRoadmapItems={setRoadmapItems} toast={setToast} />}
          </>
        )}
      </main>

      {/* Footer nav — visible in every mode including All Spaces. From All
          Spaces, clicking a tab pivots into the last-used real space + that
          tab (per-screen tabs all assume a single space). The SpaceSwitcher
          pill remains the way to deliberately stay in All Spaces while
          changing tab context. */}
      <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 72, background: 'var(--navy-800)', borderTop: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 8px', zIndex: 40 }}>
        {NAV.map(item => item.fab ? (
          <button key={item.id} onClick={() => goToScreen(item.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', marginTop: -20 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', border: '3px solid var(--navy-800)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: !isAllSpaces && screen === item.id ? '0 0 0 3px var(--accent-dim)' : 'none', transition: 'box-shadow .2s' }}>
              {item.icon}
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: !isAllSpaces && screen === item.id ? 'var(--accent)' : 'var(--navy-400)' }}>{item.label}</span>
          </button>
        ) : (
          <button key={item.id} onClick={() => goToScreen(item.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: !isAllSpaces && screen === item.id ? 'var(--accent-dim)' : 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 12, minWidth: 56, position: 'relative', transition: 'background .15s' }}>
            {item.id === 'park' && parkedCount > 0 && (
              <span style={{ position: 'absolute', top: 2, right: 6, background: 'var(--amber)', color: '#0b1520', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, lineHeight: 1.4 }}>{parkedCount}</span>
            )}
            {item.icon}
            <span style={{ fontSize: 10, fontWeight: 600, color: !isAllSpaces && screen === item.id ? 'var(--accent)' : 'var(--navy-400)' }}>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* FastCapture — also visible in All Spaces, where it targets the
          last-used real space. Only suppressed if there's no real space at
          all (no-op edge case for fresh users with zero spaces). */}
      {fastCaptureSpaceId && (
      <FastCapture
        objectives={fastCaptureObjectives}
        roadmapItems={fastCaptureRoadmapItems}
        weekStart={weekStart}
        activeSpaceId={fastCaptureSpaceId}
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

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────────
function ReflectIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="8" stroke={c} strokeWidth="1.5"/><path d="M11 6v5l3 2" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function FocusIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 2.5L7 11h4l-1 8.5 5.5-9.5H12L11 2.5Z" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/></svg>
}
function OKRIcon() {
  return <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="10" stroke="white" strokeWidth="1.8"/><circle cx="13" cy="13" r="6" stroke="white" strokeWidth="1.8"/><circle cx="13" cy="13" r="2" fill="white"/></svg>
}
function RoadmapIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="5" width="5" height="13" rx="1.5" stroke={c} strokeWidth="1.5"/><rect x="9" y="3" width="5" height="17" rx="1.5" stroke={c} strokeWidth="1.5"/><rect x="16" y="7" width="5" height="10" rx="1.5" stroke={c} strokeWidth="1.5"/></svg>
}
function ParkIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="3" width="16" height="16" rx="4" stroke={c} strokeWidth="1.5"/><path d="M9 8h4a2.5 2.5 0 0 1 0 5H9V8Z" stroke={c} strokeWidth="1.5"/><path d="M9 13v4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>
}

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
