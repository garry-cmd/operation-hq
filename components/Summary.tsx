'use client'
import { useMemo, useState } from 'react'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, HealthStatus } from '@/lib/types'
import { ACTIVE_Q, getMonday } from '@/lib/utils'
import {
  getCurrentQuarterBuckets,
  getFutureQuarterBuckets,
  assignToBucket,
  assignKRToBucket,
  classifyQuarter,
  getNeighborQuarter,
  isUnplanned,
  getQuarterRange,
  type BucketDef,
} from '@/lib/dateBuckets'
import KRDateChip from '@/components/KRDateChip'
import EditKRModal from '@/components/EditKRModal'

interface Props {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  // Past-quarter retrospect routes objective clicks out to the OKR tab via
  // these handlers (KR clicks now open EditKRModal in-place, see onUpdateKR).
  onOpenObjective: (spaceId: string, objectiveId: string) => void
  onOpenAction: (spaceId: string, action: WeeklyAction) => void
  // Used by the "This week's actions" strip — checkbox-only, doesn't switch
  // space or screen. Kept in the prop signature even when the strip is empty
  // so page.tsx can continue passing it without conditional wiring.
  onToggleAction: (action: WeeklyAction) => void
  onToggleKR: (kr: RoadmapItem) => void
  // KR mutation — wired to krsDb.update + setRoadmapItems in page.tsx. The
  // EditKRModal opens in-place when a KR card is clicked; save/delete flow
  // through these props.
  onUpdateKR: (id: string, patch: Partial<RoadmapItem>) => Promise<void>
  onDeleteKR: (id: string) => Promise<void>
  toast: (m: string) => void
}

type StatusFilter = 'all' | 'unplanned' | 'off-track'

// Toolbar pins to the top of the page. The grid below uses its own inner-scroll
// container, so cell-level sticky offsets are now wrap-relative (handled inline).
const TOOLBAR_STICKY_TOP = 0

/**
 * Summary — the Overview screen (formerly "All Spaces").
 *
 * Swim lane grid: rows = spaces, columns = time buckets. Current quarter
 * shows one column per remaining calendar week (Mon → Sun) plus a trailing
 * Quarter-bound column for is_quarter_bound goals, multi-quarter spans
 * (end_date past quarter end), unplanned defaults, and date-less items.
 * Future quarter shows month columns; past quarter renders as a
 * retrospective stat view.
 *
 * The weekly column count varies — at quarter start ~13 weeks, at quarter
 * end ~1 week. The outer container handles horizontal scroll; the space
 * column is sticky-left and the header row is sticky-top.
 *
 * Quarter switcher lets you scrub forward (planning) or back (review). KRs
 * are scoped by the KR's `quarter` tag, not by raw end_date — so a 2Q-
 * tagged KR with an end_date in July still shows in 2Q's Quarter-bound
 * column with a "↗ Multi-Q" indicator, matching the user's planning unit.
 *
 * Persistent features:
 *  - Sticky toolbar + sticky column-header row for groom ergonomics
 *  - "This week's actions" strip below the grid (cross-space weekly visibility)
 *  - In-place KR edit via <EditKRModal> — click any KR card → modal opens
 *    without leaving the dashboard
 */
export default function Summary({
  spaces,
  objectives,
  roadmapItems,
  actions,
  onOpenObjective,
  onToggleAction,
  onUpdateKR,
  onDeleteKR,
  toast,
}: Props) {
  const today = useMemo(() => new Date(), [])
  const [viewedQuarter, setViewedQuarter] = useState<string>(ACTIVE_Q)
  const [filter, setFilter] = useState<StatusFilter>('all')
  // In-place KR editor. null = closed; a RoadmapItem = open on that KR.
  const [editingKR, setEditingKR] = useState<RoadmapItem | null>(null)

  const classification = classifyQuarter(viewedQuarter, today)

  // Full set for the viewed quarter: non-habit, not parked, not abandoned.
  // Includes done. Used by the past-quarter retrospect so the "X of Y hit"
  // stats can be computed correctly (denominator needs the total set).
  const allKRs = useMemo(
    () => roadmapItems.filter(kr =>
      kr.quarter === viewedQuarter
      && !kr.is_habit
      && !kr.is_parked
      && kr.status !== 'abandoned'
    ),
    [roadmapItems, viewedQuarter]
  )

  // Active set for the swim lane + toolbar counts: drops done KRs (May 22
  // — Garry: done items leaking into This Week with red overdue chips was
  // confusing; the chip color is driven by end_date, not status). Done KRs
  // belong in the past-quarter retrospect, not the current dashboard.
  const baseKRs = useMemo(
    () => allKRs.filter(kr => kr.health_status !== 'done'),
    [allKRs]
  )

  // Status filter narrows the active set. Counts for the toolbar always come
  // from baseKRs so the user sees the absolute numbers, not the filtered subset.
  const visibleKRs = useMemo(() => {
    if (filter === 'all') return baseKRs
    if (filter === 'unplanned') return baseKRs.filter(kr => isUnplanned(kr, viewedQuarter))
    if (filter === 'off-track') return baseKRs.filter(kr => kr.health_status === 'off_track')
    return baseKRs
  }, [baseKRs, filter, viewedQuarter])

  const unplannedCount = useMemo(
    () => baseKRs.filter(kr => isUnplanned(kr, viewedQuarter)).length,
    [baseKRs, viewedQuarter]
  )
  const offTrackCount = useMemo(
    () => baseKRs.filter(kr => kr.health_status === 'off_track').length,
    [baseKRs]
  )

  const buckets: BucketDef[] = useMemo(() => {
    if (classification === 'current') return getCurrentQuarterBuckets(today, viewedQuarter)
    if (classification === 'future') return getFutureQuarterBuckets(viewedQuarter)
    return []  // past quarter doesn't use buckets
  }, [classification, today, viewedQuarter])

  // Map: spaceId -> bucketKey -> KRs landing in that cell.
  // Overdue items lump into the FIRST bucket (the leftmost weekly column,
  // which IS "this week") so they stay in the user's eye-line. Their chip
  // color = red regardless. The KR-aware assignKRToBucket handles
  // quarter-bound routing (intentional Q-level goals, multi-quarter spans,
  // unplanned defaults, date-less items) so they land in the trailing
  // Quarter-bound column.
  const grid = useMemo(() => {
    const m: Record<string, Record<string, RoadmapItem[]>> = {}
    if (classification !== 'current') {
      // Future quarter uses the date-only legacy path (month buckets).
      for (const kr of visibleKRs) {
        const sid = kr.space_id
        if (!m[sid]) m[sid] = {}
        const bk = assignToBucket(kr.end_date, buckets, today) ?? buckets[0]?.key
        if (!bk) continue
        const targetKey = (bk === 'overdue' && buckets[0]) ? buckets[0].key : bk
        if (!m[sid][targetKey]) m[sid][targetKey] = []
        m[sid][targetKey].push(kr)
      }
      return m
    }
    // Current quarter — weekly model.
    for (const kr of visibleKRs) {
      const sid = kr.space_id
      if (!m[sid]) m[sid] = {}
      const bk = assignKRToBucket(kr, buckets, today, viewedQuarter)
      const targetKey = (bk === 'overdue' && buckets[0]) ? buckets[0].key : bk
      if (!m[sid][targetKey]) m[sid][targetKey] = []
      m[sid][targetKey].push(kr)
    }
    return m
  }, [visibleKRs, buckets, today, classification, viewedQuarter])

  const objById = useMemo(() => {
    const m = new Map<string, AnnualObjective>()
    objectives.forEach(o => m.set(o.id, o))
    return m
  }, [objectives])

  // "This week's actions" data — only for current-quarter view. Filter to
  // actions whose week_start matches the current calendar week, then group
  // by space via the roadmap_item_id → space_id map. Orphan actions (whose
  // KR has been deleted) are silently dropped.
  const currentWeekStart = useMemo(() => getMonday(today), [today])
  const itemToSpaceId = useMemo(() => {
    const m = new Map<string, string>()
    roadmapItems.forEach(item => m.set(item.id, item.space_id))
    return m
  }, [roadmapItems])
  const actionsBySpace = useMemo(() => {
    if (classification !== 'current') return []
    const weekActions = actions.filter(a => a.week_start === currentWeekStart)
    const bySpace = new Map<string, WeeklyAction[]>()
    for (const a of weekActions) {
      const sid = itemToSpaceId.get(a.roadmap_item_id)
      if (!sid) continue
      if (!bySpace.has(sid)) bySpace.set(sid, [])
      bySpace.get(sid)!.push(a)
    }
    return spaces
      .filter(s => bySpace.has(s.id))
      .map(space => ({ space, actions: bySpace.get(space.id)! }))
  }, [classification, actions, currentWeekStart, itemToSpaceId, spaces])

  function prevQuarter() {
    const prev = getNeighborQuarter(viewedQuarter, 'back')
    if (prev) setViewedQuarter(prev)
  }
  function nextQuarter() {
    const next = getNeighborQuarter(viewedQuarter, 'forward')
    if (next) setViewedQuarter(next)
  }

  return (
    <div>
      {/* Sticky toolbar — stays visible while scrolling spaces. Background
          masks any content sliding under it. The padding-bottom carries
          the spacing the inner Toolbar used to provide via marginBottom. */}
      <div style={{
        position: 'sticky',
        top: TOOLBAR_STICKY_TOP,
        zIndex: 20,
        background: 'var(--navy-900)',
        paddingTop: 4,
        paddingBottom: 12,
        marginBottom: 8,
      }}>
        <Toolbar
          viewedQuarter={viewedQuarter}
          classification={classification}
          onPrev={prevQuarter}
          onNext={nextQuarter}
          totalCount={baseKRs.length}
          unplannedCount={unplannedCount}
          offTrackCount={offTrackCount}
          filter={filter}
          onFilter={setFilter}
        />
      </div>

      {classification === 'past' ? (
        <PastQuarterView
          spaces={spaces}
          krs={allKRs}
          objById={objById}
          viewedQuarter={viewedQuarter}
          onOpenObjective={onOpenObjective}
        />
      ) : (
        <SwimLaneGrid
          spaces={spaces}
          objById={objById}
          buckets={buckets}
          grid={grid}
          viewedQuarter={viewedQuarter}
          onEditKR={setEditingKR}
        />
      )}

      {/* This week's actions — restores the cross-space weekly-actions
          visibility the old Summary had (Chunk 3 lost it). Current quarter
          only; future/past don't have meaningful "this week". */}
      {classification === 'current' && actionsBySpace.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{
            fontSize: 10, fontWeight: 500, letterSpacing: '.16em',
            textTransform: 'uppercase', color: 'var(--nw-label)',
            margin: '0 0 10px 2px',
          }}>
            This week&apos;s actions
          </h3>
          <div style={{
            background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
            borderRadius: 8, padding: '4px 0',
          }}>
            {actionsBySpace.map(({ space, actions: spaceActions }, i) => {
              const doneCount = spaceActions.filter(a => a.completed).length
              return (
                <div key={space.id} style={{
                  padding: '10px 14px',
                  borderBottom: i === actionsBySpace.length - 1 ? 'none' : '1px solid var(--navy-700)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--nw-cream)', letterSpacing: '-.1px' }}>
                      {space.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--navy-400)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                      {doneCount}/{spaceActions.length}
                    </span>
                  </div>
                  {spaceActions.map(a => (
                    <label key={a.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      padding: '4px 0', cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={a.completed}
                        onChange={() => onToggleAction(a)}
                        style={{ width: 14, height: 14, marginTop: 2, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{
                        fontSize: 12,
                        color: a.completed ? 'var(--navy-400)' : 'var(--navy-100)',
                        textDecoration: a.completed ? 'line-through' : 'none',
                        textDecorationColor: 'var(--navy-500)',
                        lineHeight: 1.4,
                      }}>
                        {a.title}
                      </span>
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Legend />

      {/* In-place KR editor — opened by clicking any KR card in the swim
          lane grid. onSave/onDelete close on success. */}
      {editingKR && (
        <EditKRModal
          kr={editingKR}
          onClose={() => setEditingKR(null)}
          onSave={async (patch) => {
            await onUpdateKR(editingKR.id, patch)
            setEditingKR(null)
          }}
          onDelete={async () => {
            await onDeleteKR(editingKR.id)
            setEditingKR(null)
          }}
          toast={toast}
        />
      )}
    </div>
  )
}

// ───────────────────────── Toolbar ─────────────────────────

function Toolbar({
  viewedQuarter,
  classification,
  onPrev,
  onNext,
  totalCount,
  unplannedCount,
  offTrackCount,
  filter,
  onFilter,
}: {
  viewedQuarter: string
  classification: 'past' | 'current' | 'future'
  onPrev: () => void
  onNext: () => void
  totalCount: number
  unplannedCount: number
  offTrackCount: number
  filter: StatusFilter
  onFilter: (f: StatusFilter) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      {/* Quarter switcher */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 8, padding: 4 }}>
        <button onClick={onPrev} aria-label="Previous quarter"
          style={{ background: 'none', border: 'none', color: 'var(--navy-300)', cursor: 'pointer', width: 26, height: 26, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}>‹</button>
        <span style={{ padding: '0 8px', fontSize: 13, fontWeight: 700, color: 'var(--nw-cream)', letterSpacing: '.04em', fontVariantNumeric: 'tabular-nums' }}>
          {viewedQuarter}
        </span>
        {classification === 'current' && (
          <span style={{ fontSize: 9, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '1px 6px', borderRadius: 4, letterSpacing: '.08em', fontWeight: 700, marginRight: 4 }}>CURRENT</span>
        )}
        {classification === 'past' && (
          <span style={{ fontSize: 9, color: 'var(--nw-label-dim)', background: 'var(--navy-700)', padding: '1px 6px', borderRadius: 4, letterSpacing: '.08em', fontWeight: 700, marginRight: 4 }}>PAST</span>
        )}
        {classification === 'future' && (
          <span style={{ fontSize: 9, color: 'var(--nw-label)', background: 'rgba(212, 160, 74, 0.15)', padding: '1px 6px', borderRadius: 4, letterSpacing: '.08em', fontWeight: 700, marginRight: 4 }}>PLAN</span>
        )}
        <button onClick={onNext} aria-label="Next quarter"
          style={{ background: 'none', border: 'none', color: 'var(--navy-300)', cursor: 'pointer', width: 26, height: 26, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' }}>›</button>
      </div>

      {/* Counts */}
      <div style={{ fontSize: 11, color: 'var(--navy-300)', letterSpacing: '.04em' }}>
        <strong style={{ color: 'var(--navy-100)' }}>{totalCount}</strong> active KR{totalCount !== 1 ? 's' : ''}
        {unplannedCount > 0 && (
          <> · <button onClick={() => onFilter('unplanned')}
            style={{ background: 'none', border: 'none', color: 'var(--nw-label)', textDecoration: 'underline', textDecorationColor: 'var(--nw-label-dim)', textUnderlineOffset: 2, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, padding: 0, letterSpacing: '.04em' }}>
            {unplannedCount} unplanned →
          </button></>
        )}
        {offTrackCount > 0 && (
          <> · <button onClick={() => onFilter('off-track')}
            style={{ background: 'none', border: 'none', color: 'var(--nw-alarm-text)', textDecoration: 'underline', textDecorationColor: 'rgba(255, 100, 82, .4)', textUnderlineOffset: 2, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, padding: 0, letterSpacing: '.04em' }}>
            {offTrackCount} off track →
          </button></>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'inline-flex', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 6, overflow: 'hidden' }}>
        {(['all', 'unplanned', 'off-track'] as const).map(f => (
          <button key={f} onClick={() => onFilter(f)}
            style={{
              background: filter === f ? 'var(--accent-dim)' : 'none',
              border: 'none',
              color: filter === f ? 'var(--accent)' : 'var(--navy-300)',
              fontSize: 11, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
              fontWeight: 500, letterSpacing: '.04em', textTransform: 'capitalize',
            }}>
            {f === 'off-track' ? 'Off track' : f}
          </button>
        ))}
      </div>
    </div>
  )
}

// ───────────────────────── Swim lane grid ─────────────────────────
// Layout: horizontal scroll wrapper holds a CSS grid with fixed column widths.
// Space column is sticky-left; header cells are sticky-top. Quarter-bound
// column is fixed-wider and gets a warm tinted background to distinguish it
// from weekly columns. Current-week column gets an accent under-border + cell
// tint to anchor "now" in the timeline.

const SPACE_COL_WIDTH = 220
const WEEK_COL_WIDTH = 280
const QB_COL_WIDTH = 320

function SwimLaneGrid({
  spaces,
  objById,
  buckets,
  grid,
  viewedQuarter,
  onEditKR,
}: {
  spaces: Space[]
  objById: Map<string, AnnualObjective>
  buckets: BucketDef[]
  grid: Record<string, Record<string, RoadmapItem[]>>
  viewedQuarter: string
  onEditKR: (kr: RoadmapItem) => void
}) {
  // Build the gridTemplateColumns string. Weekly columns are uniform width;
  // the trailing Quarter-bound column is wider for the multi-quarter chip +
  // longer titles.
  const cols = buckets.map(b => b.isQuarterBound ? `${QB_COL_WIDTH}px` : `${WEEK_COL_WIDTH}px`).join(' ')
  const gridTemplateColumns = `${SPACE_COL_WIDTH}px ${cols}`

  // The outer wrapper is the inner-scroll container for both axes.
  // Why not `overflow-x: auto` with the page handling vertical scroll:
  // setting overflow on ANY axis makes the element a scroll context for
  // BOTH axes (browsers normalize `visible` on the other axis to `auto`).
  // Sticky-positioned descendants then pin relative to THIS wrap, not the
  // viewport. With page-scroll, that means sticky-top headers ride along
  // with the wrap as the page scrolls and don't stay pinned to the viewport.
  // Fix: cap the wrap's height so the user scrolls inside it. Sticky cells
  // then pin correctly to the wrap's visible edges (which ARE the viewport
  // edges while the wrap is on-screen).
  return (
    <div style={{
      background: 'var(--navy-800)',
      border: '1px solid var(--navy-600)',
      maxHeight: 'calc(100vh - 180px)',
      overflow: 'auto',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns, minWidth: 'min-content' }}>
        {/* Top-left corner — sticky both top and left so it stays put during
            either scroll direction. Highest z so it covers either neighbor. */}
        <div style={{
          ...cellBase,
          background: 'var(--navy-700)',
          borderRight: '1px solid var(--navy-500)',
          borderBottom: '1px solid var(--navy-600)',
          padding: '14px 16px',
          minHeight: 'auto',
          position: 'sticky',
          top: 0,
          left: 0,
          zIndex: 12,
        }}>
          <span style={{ fontSize: 10, color: 'var(--nw-label-dim)', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>
            Space <span style={{ color: 'var(--accent)' }}>↓</span> · Time <span style={{ color: 'var(--accent)' }}>→</span>
          </span>
        </div>
        {/* Column headers — sticky-top only. The Quarter-bound header gets a
            distinct background. Current-week header gets accent text + a
            cobalt under-bar via pseudo (rendered as an absolute span). */}
        {buckets.map((b, i) => (
          <div key={b.key}
            style={{
              ...cellBase,
              background: b.isQuarterBound
                ? 'linear-gradient(180deg, var(--navy-700) 0%, var(--navy-800) 100%)'
                : b.isCurrentWeek
                  ? 'var(--navy-700)'
                  : 'var(--navy-800)',
              borderRight: i === buckets.length - 1 ? 'none' : '1px solid var(--navy-600)',
              borderBottom: '1px solid var(--navy-600)',
              padding: '14px 14px 12px',
              minHeight: 'auto',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, position: 'relative' }}>
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>
                {b.isQuarterBound ? 'Quarter-bound' : 'Week of'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: b.isCurrentWeek ? 'var(--accent)' : 'var(--navy-50)', letterSpacing: '-.1px' }}>
                {b.isQuarterBound ? b.rangeText : b.label.replace(/^Week of /, '')}
              </span>
              <span style={{ fontSize: 10, color: 'var(--navy-400)', fontVariantNumeric: 'tabular-nums', letterSpacing: '.04em' }}>
                {b.isQuarterBound ? 'By end of quarter · no specific week' : b.rangeText}
              </span>
              {b.isCurrentWeek && (
                <span style={{
                  display: 'inline-block', alignSelf: 'flex-start',
                  fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
                  color: 'var(--accent)', background: 'var(--accent-dim)',
                  padding: '1px 6px', borderRadius: 4, marginTop: 4,
                }}>This Week</span>
              )}
              {/* Accent under-bar for current-week column */}
              {b.isCurrentWeek && (
                <span style={{
                  position: 'absolute', left: -14, right: -14, bottom: -13, height: 2,
                  background: 'var(--accent)',
                }} />
              )}
            </div>
          </div>
        ))}

        {/* Data rows — one per space */}
        {spaces.map((space, rowIdx) => {
          const isLastRow = rowIdx === spaces.length - 1
          const spaceKRs = grid[space.id] ?? {}
          const spaceTotal = Object.values(spaceKRs).reduce((sum, arr) => sum + arr.length, 0)
          return (
            <SpaceRow
              key={space.id}
              space={space}
              spaceKRs={spaceKRs}
              spaceTotal={spaceTotal}
              objById={objById}
              buckets={buckets}
              viewedQuarter={viewedQuarter}
              isLastRow={isLastRow}
              onEditKR={onEditKR}
            />
          )
        })}
      </div>
    </div>
  )
}

function SpaceRow({
  space,
  spaceKRs,
  spaceTotal,
  objById,
  buckets,
  viewedQuarter,
  isLastRow,
  onEditKR,
}: {
  space: Space
  spaceKRs: Record<string, RoadmapItem[]>
  spaceTotal: number
  objById: Map<string, AnnualObjective>
  buckets: BucketDef[]
  viewedQuarter: string
  isLastRow: boolean
  onEditKR: (kr: RoadmapItem) => void
}) {
  const offTrackInRow = Object.values(spaceKRs).flat().filter(kr => kr.health_status === 'off_track').length

  return (
    <>
      {/* Space label — sticky-left so it stays anchored as the user scrolls
          horizontally through the weekly columns. The inner content is also
          sticky-top so the label stays visible while scrolling vertically
          through a tall row (KR-dense rows can be much taller than the
          viewport — without inner sticky-top, the label scrolls off-top
          long before the row's content does). */}
      <div style={{
        ...cellBase,
        background: 'var(--navy-800)',
        borderRight: '1px solid var(--navy-500)',
        borderBottom: isLastRow ? 'none' : '1px solid var(--navy-700)',
        padding: 0,
        position: 'sticky',
        left: 0,
        zIndex: 4,
      }}>
        <div style={{
          position: 'sticky',
          // Docks just below the grid header. The header cells max out around
          // 95-105px depending on whether the "This Week" pill renders, so
          // 105 covers both cases.
          top: 105,
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nw-cream)', display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '-.1px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
            {space.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--navy-400)', letterSpacing: '.04em' }}>
            {spaceTotal} dated{offTrackInRow > 0 && <> · <span style={{ color: 'var(--nw-alarm-text)' }}>{offTrackInRow} off track</span></>}
          </div>
        </div>
      </div>
      {buckets.map((b, i) => {
        const items = spaceKRs[b.key] ?? []
        const isLastCol = i === buckets.length - 1
        return (
          <div key={b.key}
            style={{
              ...cellBase,
              borderRight: isLastCol ? 'none' : '1px solid var(--navy-700)',
              borderBottom: isLastRow ? 'none' : '1px solid var(--navy-700)',
              background: b.isQuarterBound
                ? 'linear-gradient(180deg, var(--navy-900) 0%, rgba(40, 30, 12, 0.18) 100%)'
                : b.isCurrentWeek
                  ? 'rgba(74, 143, 255, 0.025)'
                  : undefined,
            }}>
            {items.length === 0 ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--navy-600)', fontSize: 16, fontWeight: 300 }}>—</div>
            ) : (
              items.map(kr => (
                <ItemCard
                  key={kr.id}
                  kr={kr}
                  objective={kr.annual_objective_id ? objById.get(kr.annual_objective_id) : undefined}
                  viewedQuarter={viewedQuarter}
                  onClick={() => onEditKR(kr)}
                />
              ))
            )}
          </div>
        )
      })}
    </>
  )
}

// ───────────────────────── Item card ─────────────────────────

function ItemCard({
  kr,
  objective,
  viewedQuarter,
  onClick,
}: {
  kr: RoadmapItem
  objective: AnnualObjective | undefined
  viewedQuarter: string
  onClick: () => void
}) {
  const isOffTrack = kr.health_status === 'off_track'
  // Use the renamed predicate — items the user flagged as quarter-bound are
  // NO LONGER unplanned (the dashed visual demotion was the old conflation).
  const isUnplannedItem = isUnplanned(kr, viewedQuarter)
  const objColor = objective?.color ?? 'var(--navy-500)'
  const borderColor = isOffTrack ? 'var(--nw-alarm-text)' : objColor

  return (
    <div onClick={onClick}
      style={{
        position: 'relative',
        padding: '7px 9px 7px 11px',
        borderRadius: 5,
        background: isUnplannedItem ? 'var(--navy-800)' : 'var(--navy-700)',
        marginBottom: 5,
        borderLeft: `2px solid ${borderColor}`,
        cursor: 'pointer',
        transition: 'background .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-600)' }}
      onMouseLeave={e => { e.currentTarget.style.background = isUnplannedItem ? 'var(--navy-800)' : 'var(--navy-700)' }}
    >
      <StatusDot status={kr.health_status} />
      <div style={{ marginBottom: 4 }}>
        <KRDateChip kr={kr} viewedQuarter={viewedQuarter} size="md" />
      </div>
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: isUnplannedItem ? 'var(--navy-200)' : 'var(--navy-100)',
        lineHeight: 1.3,
        marginBottom: 2,
        paddingRight: 12,
      }}>
        {kr.title}
      </div>
      {objective && (
        <div style={{ fontSize: 10, color: 'var(--navy-400)', letterSpacing: '.02em', lineHeight: 1.3 }}>
          {objective.name}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: HealthStatus }) {
  const color = (() => {
    switch (status) {
      case 'on_track': return 'var(--nw-nominal-text)'
      case 'off_track': return 'var(--nw-alarm-text)'
      case 'blocked': return 'var(--nw-caution-text)'
      case 'done': return 'var(--nw-nominal-text)'
      case 'waiting': return 'var(--navy-400)'
      default: return 'var(--navy-400)'
    }
  })()
  return <span style={{ position: 'absolute', top: 8, right: 7, width: 5, height: 5, borderRadius: '50%', background: color }} />
}

// ───────────────────────── Past quarter view ─────────────────────────

function PastQuarterView({
  spaces,
  krs,
  objById,
  viewedQuarter,
  onOpenObjective,
}: {
  spaces: Space[]
  krs: RoadmapItem[]
  objById: Map<string, AnnualObjective>
  viewedQuarter: string
  onOpenObjective: (spaceId: string, objectiveId: string) => void
}) {
  const qRange = getQuarterRange(viewedQuarter)
  const totalDone = krs.filter(k => k.health_status === 'done').length
  const totalMissed = krs.length - totalDone
  const hitRate = krs.length === 0 ? 0 : Math.round((totalDone / krs.length) * 100)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '20px 24px', display: 'flex', alignItems: 'baseline', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--nw-label-dim)', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500, marginBottom: 4 }}>
            {viewedQuarter} retrospective {qRange && `· ${qRange.start.slice(5)} → ${qRange.end.slice(5)}`}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--nw-label)', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
            {hitRate}%
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--navy-400)', marginLeft: 6 }}>/ 100%</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--navy-300)', display: 'flex', gap: 14, marginLeft: 'auto', letterSpacing: '.04em' }}>
          <span><strong style={{ color: 'var(--nw-nominal-text)' }}>{totalDone}</strong> done</span>
          <span><strong style={{ color: 'var(--nw-alarm-text)' }}>{totalMissed}</strong> not done</span>
          <span><strong style={{ color: 'var(--navy-100)' }}>{krs.length}</strong> total</span>
        </div>
      </div>

      {/* Per-space breakdown */}
      {spaces.map(space => {
        const spaceKRs = krs.filter(k => k.space_id === space.id)
        if (spaceKRs.length === 0) return null
        const done = spaceKRs.filter(k => k.health_status === 'done').length
        return (
          <div key={space.id} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '14px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: space.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--nw-cream)' }}>{space.name}</span>
              <span style={{ fontSize: 11, color: 'var(--navy-400)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                {done} of {spaceKRs.length} hit
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {spaceKRs.map(kr => {
                const obj = kr.annual_objective_id ? objById.get(kr.annual_objective_id) : undefined
                const isDone = kr.health_status === 'done'
                return (
                  <div key={kr.id} onClick={() => kr.annual_objective_id && onOpenObjective(kr.space_id, kr.annual_objective_id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: isDone ? 'var(--nw-nominal-text)' : 'var(--nw-alarm-text)', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: isDone ? 'var(--navy-300)' : 'var(--navy-100)', textDecoration: isDone ? 'line-through' : 'none', textDecorationColor: 'var(--navy-500)', flex: 1, minWidth: 0 }}>
                      {kr.title}
                    </span>
                    {obj && <span style={{ fontSize: 10, color: 'var(--navy-400)', letterSpacing: '.02em' }}>{obj.name}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────── Legend ─────────────────────────

function Legend() {
  return (
    <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 8, fontSize: 10, color: 'var(--navy-400)', letterSpacing: '.04em', flexWrap: 'wrap' }}>
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--accent)' }} />} label="This Week — act" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(212, 160, 74, 0.2)', border: '1px solid var(--nw-label)' }} />} label="Future week — plan" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--navy-700)', border: '1px solid var(--navy-500)' }} />} label="Quarter-bound" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--accent-dim)', border: '1px solid var(--accent)' }} />} label="Multi-quarter" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'transparent', border: '1px dashed var(--nw-label-dim)' }} />} label="Unplanned" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--nw-alarm-text)' }} />} label="Overdue / off track" />
      <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Habits + metrics not shown — they&apos;re ongoing</span>
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {swatch}
      {label}
    </span>
  )
}

// Shared base for grid cells — anchors min-height + vertical alignment.
const cellBase: React.CSSProperties = {
  padding: '12px 10px',
  minHeight: 100,
  verticalAlign: 'top',
}
