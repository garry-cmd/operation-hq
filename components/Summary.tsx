'use client'
import { useMemo, useState } from 'react'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, HealthStatus } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import {
  getCurrentQuarterBuckets,
  getFutureQuarterBuckets,
  assignToBucket,
  classifyQuarter,
  getNeighborQuarter,
  isDefaultDated,
  getQuarterRange,
  type BucketDef,
  type BucketKey,
} from '@/lib/dateBuckets'
import KRDateChip from '@/components/KRDateChip'

interface Props {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  // Title click handlers — both jump out of summary mode by switching the
  // active space on the page. See app/hq/page.tsx for the wired implementations.
  onOpenObjective: (spaceId: string, objectiveId: string) => void
  onOpenAction: (spaceId: string, action: WeeklyAction) => void
  // Checkbox-only handlers — toggle complete/done without leaving Summary.
  onToggleAction: (action: WeeklyAction) => void
  onToggleKR: (kr: RoadmapItem) => void
}

type StatusFilter = 'all' | 'unplanned' | 'off-track'

/**
 * Summary — the All Spaces dashboard.
 *
 * Renamed from the prior flat KR + action list (May 21 dated-KR rollout). The
 * new shape is a swim lane grid: rows = spaces, columns = time buckets (This
 * Week / Next Week / This Month / This Quarter when current; month columns
 * when future). Past quarters render as a retrospective stat view.
 *
 * Quarter switcher lets you scrub forward (planning) or back (review). KRs
 * are scoped by the KR's `quarter` tag, not by raw target_date — so a 2Q-
 * tagged KR with an end_date in July still shows in 2Q's "This Quarter"
 * column, matching the user's planning unit.
 *
 * The old onOpenAction / onToggleAction / onToggleKR callbacks are kept in
 * the prop signature (page.tsx still passes them) but unused here — the new
 * view doesn't touch weekly actions. Card click routes through onOpenObjective.
 */
export default function Summary({
  spaces,
  objectives,
  roadmapItems,
  onOpenObjective,
}: Props) {
  const today = useMemo(() => new Date(), [])
  const [viewedQuarter, setViewedQuarter] = useState<string>(ACTIVE_Q)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const classification = classifyQuarter(viewedQuarter, today)

  // Base set: non-habit KRs in viewed quarter, not parked, not abandoned.
  // Done KRs are included so green-dot retrospect items stay visible in
  // their bucket (e.g. "Hot Springs" still shows in This Week after Garry
  // ticks it done on Sunday).
  const baseKRs = useMemo(
    () => roadmapItems.filter(kr =>
      kr.quarter === viewedQuarter
      && !kr.is_habit
      && !kr.is_parked
      && kr.status !== 'abandoned'
    ),
    [roadmapItems, viewedQuarter]
  )

  // Status filter narrows the set. Counts for the toolbar always come from
  // baseKRs so the user sees the absolute numbers, not the filtered subset.
  const visibleKRs = useMemo(() => {
    if (filter === 'all') return baseKRs
    if (filter === 'unplanned') return baseKRs.filter(kr => isDefaultDated(kr.start_date, kr.end_date, viewedQuarter))
    if (filter === 'off-track') return baseKRs.filter(kr => kr.health_status === 'off_track')
    return baseKRs
  }, [baseKRs, filter, viewedQuarter])

  const unplannedCount = useMemo(
    () => baseKRs.filter(kr => isDefaultDated(kr.start_date, kr.end_date, viewedQuarter)).length,
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
  // Overdue items lump into the FIRST bucket (the leftmost visible column) so
  // they stay in the user's eye-line. Their chip color = red regardless.
  const grid = useMemo(() => {
    const m: Record<string, Record<string, RoadmapItem[]>> = {}
    for (const kr of visibleKRs) {
      const sid = kr.space_id
      if (!m[sid]) m[sid] = {}
      const bk = assignToBucket(kr.end_date, buckets, today) ?? 'this-quarter'
      // Overdue → first bucket
      const targetKey = (bk === 'overdue' && buckets[0]) ? buckets[0].key : bk
      if (!m[sid][targetKey]) m[sid][targetKey] = []
      m[sid][targetKey].push(kr)
    }
    return m
  }, [visibleKRs, buckets, today])

  const objById = useMemo(() => {
    const m = new Map<string, AnnualObjective>()
    objectives.forEach(o => m.set(o.id, o))
    return m
  }, [objectives])

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

      {classification === 'past' ? (
        <PastQuarterView
          spaces={spaces}
          krs={baseKRs}
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
          onOpenObjective={onOpenObjective}
        />
      )}

      <Legend />
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
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

function SwimLaneGrid({
  spaces,
  objById,
  buckets,
  grid,
  viewedQuarter,
  onOpenObjective,
}: {
  spaces: Space[]
  objById: Map<string, AnnualObjective>
  buckets: BucketDef[]
  grid: Record<string, Record<string, RoadmapItem[]>>
  viewedQuarter: string
  onOpenObjective: (spaceId: string, objectiveId: string) => void
}) {
  // 150px row-header col, then 1fr per bucket column.
  const cols = `150px repeat(${buckets.length}, 1fr)`

  return (
    <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols }}>
        {/* Header row */}
        <div style={{ ...cellBase, background: 'var(--navy-700)', borderRight: '1px solid var(--navy-600)', borderBottom: '1px solid var(--navy-600)', padding: '12px', minHeight: 'auto' }}>
          <span style={{ fontSize: 10, color: 'var(--nw-label-dim)', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500 }}>Space ↓ · Time →</span>
        </div>
        {buckets.map((b, i) => (
          <div key={b.key}
            style={{
              ...cellBase,
              background: 'var(--navy-700)',
              borderRight: i === buckets.length - 1 ? 'none' : '1px solid var(--navy-600)',
              borderBottom: '1px solid var(--navy-600)',
              padding: '12px',
              minHeight: 'auto',
            }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: b.key === 'this-week' ? 'var(--accent)' : 'var(--nw-label)' }}>
                {b.label}
              </span>
              <span style={{ fontSize: 10, color: 'var(--navy-300)', fontVariantNumeric: 'tabular-nums', letterSpacing: '.04em' }}>
                {b.rangeText}
              </span>
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
              onOpenObjective={onOpenObjective}
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
  onOpenObjective,
}: {
  space: Space
  spaceKRs: Record<string, RoadmapItem[]>
  spaceTotal: number
  objById: Map<string, AnnualObjective>
  buckets: BucketDef[]
  viewedQuarter: string
  isLastRow: boolean
  onOpenObjective: (spaceId: string, objectiveId: string) => void
}) {
  const offTrackInRow = Object.values(spaceKRs).flat().filter(kr => kr.health_status === 'off_track').length

  return (
    <>
      <div style={{
        ...cellBase,
        background: 'var(--navy-800)',
        borderRight: '1px solid var(--navy-600)',
        borderBottom: isLastRow ? 'none' : '1px solid var(--navy-700)',
        padding: '14px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nw-cream)', display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '-.1px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
          {space.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--navy-400)', letterSpacing: '.04em' }}>
          {spaceTotal} dated{offTrackInRow > 0 && ` · ${offTrackInRow} off track`}
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
              background: b.key === 'this-week' ? 'rgba(91, 141, 239, 0.03)' : undefined,
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
                  onClick={() => kr.annual_objective_id && onOpenObjective(kr.space_id, kr.annual_objective_id)}
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
  const isDefault = isDefaultDated(kr.start_date, kr.end_date, viewedQuarter)
  const objColor = objective?.color ?? 'var(--navy-500)'
  const borderColor = isOffTrack ? 'var(--nw-alarm-text)' : objColor

  return (
    <div onClick={onClick}
      style={{
        position: 'relative',
        padding: '7px 9px 7px 11px',
        borderRadius: 5,
        background: isDefault ? 'var(--navy-800)' : 'var(--navy-700)',
        marginBottom: 5,
        borderLeft: `2px solid ${borderColor}`,
        cursor: 'pointer',
        transition: 'background .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-600)' }}
      onMouseLeave={e => { e.currentTarget.style.background = isDefault ? 'var(--navy-800)' : 'var(--navy-700)' }}
    >
      <StatusDot status={kr.health_status} />
      <div style={{ marginBottom: 4 }}>
        <KRDateChip kr={kr} viewedQuarter={viewedQuarter} size="md" />
      </div>
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: isDefault ? 'var(--navy-200)' : 'var(--navy-100)',
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
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(212, 160, 74, 0.2)', border: '1px solid var(--nw-label)' }} />} label="Next Week — plan" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'transparent', border: '1px dashed var(--nw-label-dim)' }} />} label="Unplanned (default)" />
      <LegendItem swatch={<span style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--nw-alarm-text)' }} />} label="Overdue / off track" />
      <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Habits + metrics not shown — they're ongoing</span>
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
