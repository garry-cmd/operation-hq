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
import Tasks from '@/components/Tasks'
import Notes from '@/components/Notes'
import Tags from '@/components/Tags'
import FastCapture from '@/components/FastCapture'
import Toast from '@/components/Toast'
import NavRail from '@/components/NavRail'
import CloseWeekWizard from '@/components/CloseWeekWizard'
import MetricLogModal from '@/components/MetricLogModal'
import type { User } from '@supabase/supabase-js'

type Screen = 'reflect' | 'focus' | 'okr' | 'roadmap' | 'park' | 'tasks' | 'notes' | 'tags'

// MUST match the value in components/SpaceSwitcher.tsx. When the activeSpaceId
// equals this sentinel, page.tsx routes to Summary (cross-space view) instead
// of any of the regular tabs. The NavRail stays visible — screen clicks pivot
// back into the last-used real space, and FastCapture targets that space too.
// (See goToScreen + fastCaptureSpaceId below.)
const ALL_SPACES_ID = '__all__'

interface SearchResult { label: string; sub: string; screen: Screen }

export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('okr')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [weekStart, setWeekStartRaw] = useState<string>(getMonday())
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [searchQuery, setSearchQuery] = useState('')

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

  // Active-screen detection is now owned by NavRail; the bottom nav and its
  // NAV/navActive scaffolding were removed when the rail landed.

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--navy-900)' }}>
      <NavRail
        screen={screen}
        isAllSpaces={isAllSpaces}
        onScreenChange={goToScreen}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        objectives={objectives}
        roadmapItems={roadmapItems}
        onSpaceSelect={switchSpace}
        onSpaceCreated={space => setSpaces(prev => [...prev, space])}
        onSpaceUpdated={space => setSpaces(prev => prev.map(s => s.id === space.id ? space : s))}
        focusOpenCount={spaceActions.filter(a => a.week_start === weekStart && !a.completed).length}
        parkedCount={parkedCount}
        reviewsCount={spaceReviews.filter(r => r.closed_at != null).length}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        initials={initials}
        email={user?.email ?? ''}
        theme={theme}
        onToggleTheme={toggleTheme}
        onCopyShareLink={copyShareLink}
        onSignOut={() => supabase.auth.signOut()}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Tasks/Notes/Tags use full viewport width for their multi-pane layouts;
          all other screens get the standard centered main with conditional
          maxWidth (Roadmap/Summary/panels widen; otherwise narrow). */}
      {screen === 'tasks' && !isAllSpaces && !loading ? (
        <Tasks
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          objectives={spaceObjectives}
          roadmapItems={spaceRoadmapItems}
          initialTaskId={tasksInitialId}
          onConsumeInitialTaskId={() => setTasksInitialId(null)}
          onJumpToTag={tag => { setTagsInitialTag(tag); setScreen('tags') }}
          toast={setToast}
        />
      ) : screen === 'notes' && !isAllSpaces && !loading ? (
        <Notes
          spaces={spaces}
          activeSpaceId={activeSpaceId}
          initialNoteId={notesInitialId}
          onConsumeInitialNoteId={() => setNotesInitialId(null)}
          onJumpToTag={tag => { setTagsInitialTag(tag); setScreen('tags') }}
          toast={setToast}
        />
      ) : screen === 'tags' && !isAllSpaces && !loading ? (
        <Tags
          spaces={spaces}
          initialTag={tagsInitialTag}
          onJumpToTask={(id) => { setTasksInitialId(id); setTagsInitialTag(null); setScreen('tasks') }}
          onJumpToNote={(id) => { setNotesInitialId(id); setTagsInitialTag(null); setScreen('notes') }}
          toast={setToast}
        />
      ) : (
      <main style={{ padding: '24px 28px', maxWidth: isAllSpaces || screen === 'roadmap' || (screen === 'focus' && openActionId) || (screen === 'okr' && openObjectiveId) ? 1280 : 800, width: '100%', margin: '0 auto' }}>
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
      )}
      </div>

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
