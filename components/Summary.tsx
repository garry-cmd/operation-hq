'use client'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, HabitCheckin, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'

interface Props {
  // ALL spaces — Summary is the one screen that intentionally ignores the
  // active-space filter on the page. Click a row to leave summary mode.
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  habitCheckins: HabitCheckin[]
  metricCheckins: MetricCheckin[]
  // Used to label "this week" vs older actions and to count habit checkins
  // for the current week's right-side stat.
  weekStart: string
  // Click handlers — both jump out of summary mode by switching the active
  // space on the page. See app/hq/page.tsx for the wired implementations.
  onOpenObjective: (spaceId: string, objectiveId: string) => void
  onOpenAction: (spaceId: string, action: WeeklyAction) => void
}

// Mirrors the on-track / blocked / off-track palette used elsewhere
// (Focus, OKRs, ObjectiveCard). Not-started / backlog / done fall back to
// muted navy so they read clearly without competing with active KRs.
const HEALTH_DOT: Record<string, string> = {
  on_track: 'var(--teal-text)',
  off_track: 'var(--red-text)',
  blocked: 'var(--amber-text)',
  done: 'var(--navy-300)',
  not_started: 'var(--navy-400)',
  backlog: 'var(--navy-400)',
}

// Re-uses Focus's TAG_STYLE values verbatim. If TAG_STYLE ever moves to
// lib/tagStyle.ts (per the audit backlog), update both call sites at once.
const TAG_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  doing:   { bg: 'var(--amber-bg)',  text: 'var(--amber-text)',  label: 'doing' },
  waiting: { bg: 'var(--indigo-bg)', text: 'var(--indigo-text)', label: 'waiting' },
  backlog: { bg: 'var(--navy-700)',  text: 'var(--navy-300)',    label: 'backlog' },
}

function formatWeekLabel(weekStart: string): string {
  // Always parse with a noon clock so the YYYY-MM-DD string doesn't drift
  // by a day in negative-UTC timezones (same fix as getMonday in lib/utils).
  const d = new Date(weekStart + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Count completed habit check-ins for a KR within the current week.
// Cheap O(N) over checkins per KR — fine at this scale; revisit only if a
// space ever crosses thousands of checkins.
function countHabitThisWeek(krId: string, checkins: HabitCheckin[], weekStart: string): number {
  const start = new Date(weekStart + 'T12:00:00').getTime()
  return checkins.filter(c => {
    if (c.roadmap_item_id !== krId || !c.completed) return false
    const t = new Date(c.date + 'T12:00:00').getTime()
    const diffDays = Math.floor((t - start) / 86_400_000)
    return diffDays >= 0 && diffDays < 7
  }).length
}

function latestMetric(krId: string, checkins: MetricCheckin[]): MetricCheckin | null {
  const filtered = checkins.filter(m => m.roadmap_item_id === krId)
  if (filtered.length === 0) return null
  return filtered.reduce((a, b) => (a.week_start > b.week_start ? a : b))
}

export default function Summary({
  spaces,
  objectives,
  roadmapItems,
  actions,
  habitCheckins,
  metricCheckins,
  weekStart,
  onOpenObjective,
  onOpenAction,
}: Props) {
  if (spaces.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--navy-400)', fontSize: 13 }}>
        No spaces yet. Create one from the space switcher to get started.
      </div>
    )
  }

  const sortedSpaces = [...spaces].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div
      style={{
        // 380px minmax → 1 column on mobile, 2 columns on desktop within the
        // 1080-cap <main>. Roadmap-style 4-up isn't desirable here — the
        // cards get too narrow for KR titles to breathe.
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        gap: 14,
      }}
    >
      {sortedSpaces.map(space => {
        const spaceObjs = objectives
          .filter(o => o.space_id === space.id && o.status !== 'abandoned')
          .sort((a, b) => a.sort_order - b.sort_order)
        const spaceKRs = getCurrentQuarterKRs(
          roadmapItems.filter(i => i.space_id === space.id),
          ACTIVE_Q
        )
        const spaceKRIds = new Set(spaceKRs.map(k => k.id))
        const krsByObj = new Map<string, RoadmapItem[]>()
        spaceKRs.forEach(kr => {
          const k = kr.annual_objective_id ?? '__none__'
          const arr = krsByObj.get(k) ?? []
          arr.push(kr)
          krsByObj.set(k, arr)
        })
        // All open (not-completed) actions across all weeks for this space.
        // Sorted newest-first so this-week's work surfaces above older
        // carries; the per-row "wk MMM DD" chip disambiguates non-current.
        const spaceOpenActions = actions
          .filter(a => spaceKRIds.has(a.roadmap_item_id) && !a.completed)
          .sort((a, b) => b.week_start.localeCompare(a.week_start))

        return (
          <div
            key={space.id}
            style={{
              background: 'var(--navy-700)',
              border: '1px solid var(--navy-600)',
              // Left rail in the space's color — same idea as ObjectiveCard
              // in OKRs, scaled down. 3px reads at a glance, doesn't shout.
              borderLeft: `3px solid ${space.color}`,
              borderRadius: 14,
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)' }}>{space.name}</span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>
                {spaceObjs.length} obj · {spaceKRs.length} KRs · {spaceOpenActions.length} open
              </span>
            </div>

            {spaceObjs.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--navy-400)', fontStyle: 'italic', padding: '4px 2px 12px' }}>
                No objectives.
              </div>
            ) : (
              spaceObjs.map(obj => {
                const krs = krsByObj.get(obj.id) ?? []
                return (
                  <div key={obj.id} style={{ marginBottom: 10 }}>
                    <button
                      onClick={() => onOpenObjective(space.id, obj.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 2px',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 10,
                          textTransform: 'uppercase',
                          letterSpacing: '0.6px',
                          color: 'var(--navy-300)',
                          fontWeight: 600,
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {obj.name}
                      </span>
                    </button>
                    {krs.length === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--navy-400)', fontStyle: 'italic', padding: '4px 8px 4px 14px' }}>
                        No active KRs this quarter.
                      </div>
                    ) : (
                      krs.map(kr => {
                        const dotColor = HEALTH_DOT[kr.health_status] ?? 'var(--navy-400)'
                        let rightLabel: string
                        if (kr.is_habit) {
                          const c = countHabitThisWeek(kr.id, habitCheckins, weekStart)
                          rightLabel = `${c} this wk`
                        } else if (kr.is_metric) {
                          const m = latestMetric(kr.id, metricCheckins)
                          if (m) {
                            const unit = kr.metric_unit ? ` ${kr.metric_unit}` : ''
                            rightLabel = `${m.value}${unit}`
                          } else {
                            rightLabel = '—'
                          }
                        } else {
                          rightLabel = `${kr.progress}%`
                        }
                        return (
                          <button
                            key={kr.id}
                            onClick={() => onOpenObjective(space.id, obj.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 9,
                              padding: '7px 8px',
                              borderRadius: 8,
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'left',
                              width: '100%',
                              transition: 'background .12s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-600)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >
                            <div
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: dotColor,
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 12,
                                color: 'var(--navy-100)',
                                flex: 1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {kr.title}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--navy-300)', flexShrink: 0 }}>
                              {rightLabel}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )
              })
            )}

            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                color: 'var(--navy-300)',
                fontWeight: 600,
                marginTop: 4,
                marginBottom: 6,
                padding: '0 2px',
              }}
            >
              Open actions
            </div>
            {spaceOpenActions.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--navy-400)', fontStyle: 'italic', padding: '4px 8px' }}>
                No open actions.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {spaceOpenActions.map(action => {
                  const isCurrentWeek = action.week_start === weekStart
                  const tagStyle = action.tag ? TAG_STYLE[action.tag] : null
                  return (
                    <button
                      key={action.id}
                      onClick={() => onOpenAction(space.id, action)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '7px 8px',
                        borderRadius: 8,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        transition: 'background .12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-600)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: 3,
                          border: '1.5px solid var(--navy-500)',
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--navy-100)',
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {action.title}
                      </span>
                      {action.carried_over && (
                        <span
                          style={{
                            fontSize: 9,
                            color: 'var(--amber-text)',
                            background: 'var(--amber-bg)',
                            padding: '1px 6px',
                            borderRadius: 4,
                            flexShrink: 0,
                          }}
                        >
                          carried
                        </span>
                      )}
                      {tagStyle && (
                        <span
                          style={{
                            fontSize: 9,
                            color: tagStyle.text,
                            background: tagStyle.bg,
                            padding: '1px 6px',
                            borderRadius: 4,
                            flexShrink: 0,
                          }}
                        >
                          {tagStyle.label}
                        </span>
                      )}
                      {!isCurrentWeek && (
                        <span style={{ fontSize: 9, color: 'var(--navy-400)', flexShrink: 0 }}>
                          wk {formatWeekLabel(action.week_start)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
