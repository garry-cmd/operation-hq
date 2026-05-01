'use client'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction } from '@/lib/types'

interface Props {
  // ALL spaces — Summary is the one screen that intentionally ignores the
  // active-space filter on the page. Click a row to leave summary mode.
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  // Click handlers — both jump out of summary mode by switching the active
  // space on the page. See app/hq/page.tsx for the wired implementations.
  onOpenObjective: (spaceId: string, objectiveId: string) => void
  onOpenAction: (spaceId: string, action: WeeklyAction) => void
}

// Square checkbox-style bullet shared by both KR rows and action rows.
// Visually unifies the two — per the screenshot, the user's intuition is
// that everything trackable looks the same. Done state uses the accent color
// rather than a per-status palette so the page reads at a glance.
function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        flexShrink: 0,
        borderRadius: 3,
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--navy-400)'}`,
        background: checked ? 'var(--accent)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2, // align with first line of text
      }}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 9 9">
          <path
            d="M1.5 4.5 L3.5 6.5 L7.5 2.5"
            stroke="var(--navy-900)"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

// 25% gives the objective column ~95px at the smallest 380px-wide layout —
// enough for one or two short words. KRs and Actions split the remaining
// space evenly with `1fr` each, clamped at 130px so neither collapses to
// unreadable widths.
const GRID_COLS = 'minmax(120px, 25%) minmax(130px, 1fr) minmax(130px, 1fr)'

const rowButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '5px 12px',
  width: '100%',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background .12s',
  fontFamily: 'inherit',
}

export default function Summary({
  spaces,
  objectives,
  roadmapItems,
  actions,
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
        border: '1px solid var(--navy-600)',
        borderRadius: 12,
        overflow: 'hidden',
        // No solid fill here — each space's wrapper paints its own tinted
        // background, and the header row + space bands paint their own.
        // Empty objective rows pick up the tint of their space.
      }}
    >
      {/* Header row — the only place we name the columns. Sticky would be
          nice on long pages; deferring until we see how long this gets in
          real use, since `position: sticky` inside an overflow:hidden parent
          is a known footgun. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID_COLS,
          background: 'var(--navy-600)',
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--navy-100)',
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}
      >
        <div style={{ padding: '8px 12px' }}>Objective</div>
        <div style={{ padding: '8px 12px', borderLeft: '1px solid var(--navy-500)' }}>
          Key Results
        </div>
        <div style={{ padding: '8px 12px', borderLeft: '1px solid var(--navy-500)' }}>
          Open Actions
        </div>
      </div>

      {sortedSpaces.map(space => {
        const spaceObjs = objectives
          .filter(o => o.space_id === space.id && o.status !== 'abandoned')
          .sort((a, b) => a.sort_order - b.sort_order)
        // ALL non-parked, non-abandoned KRs (any quarter, any status — done
        // KRs render with strikethrough, mirroring the screenshot). This is
        // a wider net than getCurrentQuarterKRs on purpose: Summary is the
        // one place that should show the whole working set across quarters.
        const spaceKRs = roadmapItems
          .filter(i => i.space_id === space.id && !i.is_parked && i.status !== 'abandoned')
          .sort((a, b) => a.sort_order - b.sort_order)
        const krIds = new Set(spaceKRs.map(k => k.id))
        // All open actions across all weeks (per design call). Sorted
        // newest-first so this-week's work tends to surface above older
        // carries within each KR's row group.
        const spaceActions = actions
          .filter(a => krIds.has(a.roadmap_item_id) && !a.completed)
          .sort((a, b) => b.week_start.localeCompare(a.week_start))

        return (
          <div
            key={space.id}
            style={{
              // Faint wash of the space's own color through the body rows
              // so each space reads as its own zone — saturated band on top,
              // ~12% tint underneath. Hex `1f` ≈ 12.2% alpha. Visible enough
              // to color-zone in light mode, still readable in dark mode.
              // Header row, hover, and the band itself paint over this so
              // none of them are affected.
              background: `${space.color}1f`,
            }}
          >
            {/* Space band — saturated color from the COLORS palette, white
                text. The palette is designed to work in both submarine dark
                and battleship light, so a hardcoded #fff label is safe. */}
            <div
              style={{
                padding: '8px 12px',
                background: space.color,
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              {space.name}
            </div>

            {spaceObjs.length === 0 ? (
              <div
                style={{
                  padding: '14px',
                  fontSize: 12,
                  color: 'var(--navy-400)',
                  fontStyle: 'italic',
                  borderTop: '1px solid var(--navy-600)',
                }}
              >
                No objectives in this space.
              </div>
            ) : (
              spaceObjs.map(obj => {
                const objKRs = spaceKRs.filter(k => k.annual_objective_id === obj.id)
                const objKRIds = new Set(objKRs.map(k => k.id))
                const objActions = spaceActions.filter(a => objKRIds.has(a.roadmap_item_id))

                return (
                  <div
                    key={obj.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID_COLS,
                      borderTop: '1px solid var(--navy-600)',
                    }}
                  >
                    {/* Cell 1 — objective name with a small color stripe in
                        the objective's own color (keeps a cross-reference
                        to OKRs/Roadmap where the same colors anchor the
                        objective cards). */}
                    <button
                      onClick={() => onOpenObjective(space.id, obj.id)}
                      style={{
                        padding: '10px 12px',
                        background: 'none',
                        border: 'none',
                        borderRight: '1px solid var(--navy-600)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--navy-50)',
                        lineHeight: 1.35,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-600)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <div
                        style={{
                          width: 3,
                          alignSelf: 'stretch',
                          borderRadius: 2,
                          background: obj.color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{obj.name}</span>
                    </button>

                    {/* Cell 2 — KRs only. Empty cells render blank rather
                        than a dash; the row's natural height is set by
                        whichever of the three cells has the most content. */}
                    <div
                      style={{
                        padding: '4px 0',
                        minWidth: 0,
                        borderRight: '1px solid var(--navy-600)',
                      }}
                    >
                      {objKRs.map(kr => {
                        // Treat status='done' OR health_status='done' as
                        // done. The two fields drift in the existing data
                        // and either signal is enough for this view.
                        const done = kr.status === 'done' || kr.health_status === 'done'
                        return (
                          <button
                            key={kr.id}
                            onClick={() => onOpenObjective(space.id, obj.id)}
                            style={rowButtonStyle}
                            onMouseEnter={e =>
                              (e.currentTarget.style.background = 'var(--navy-600)')
                            }
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >
                            <Checkbox checked={done} />
                            <span
                              style={{
                                fontSize: 13,
                                color: done ? 'var(--navy-400)' : 'var(--navy-100)',
                                textDecoration: done ? 'line-through' : 'none',
                                lineHeight: 1.35,
                                // Preserve newlines if the title contains
                                // them (some users paste multi-line KR
                                // titles; the screenshot shows this style).
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                minWidth: 0,
                              }}
                            >
                              {kr.title}
                            </span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Cell 3 — open actions only. */}
                    <div style={{ padding: '4px 0', minWidth: 0 }}>
                      {objActions.map(a => (
                        <button
                          key={a.id}
                          onClick={() => onOpenAction(space.id, a)}
                          style={rowButtonStyle}
                          onMouseEnter={e =>
                            (e.currentTarget.style.background = 'var(--navy-600)')
                          }
                          onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                          <Checkbox checked={false} />
                          <span
                            style={{
                              fontSize: 13,
                              color: 'var(--navy-200)',
                              lineHeight: 1.35,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              minWidth: 0,
                            }}
                          >
                            {a.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )
      })}
    </div>
  )
}
