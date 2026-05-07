'use client'
import { useState, useEffect } from 'react'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction } from '@/lib/types'

interface Props {
  // ALL spaces — Summary is the one screen that intentionally ignores the
  // active-space filter on the page. Click a title to leave summary mode;
  // click a checkbox to toggle done/complete in place.
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  // Title click handlers — both jump out of summary mode by switching the
  // active space on the page. See app/hq/page.tsx for the wired implementations.
  onOpenObjective: (spaceId: string, objectiveId: string) => void
  onOpenAction: (spaceId: string, action: WeeklyAction) => void
  // Checkbox-only handlers — toggle complete/done without leaving Summary.
  // Mirrors the Focus pattern: cb toggles, rest of row navigates. KR un-done
  // sets health_status back to 'on_track' (asymmetric — there's no prior
  // state to recover; Roadmap's edit modal can refine if needed).
  onToggleAction: (action: WeeklyAction) => void
  onToggleKR: (kr: RoadmapItem) => void
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

// Disclosure caret for collapse/expand on space bands. Rotates 90° rather
// than swapping shapes — keeps the eye anchored on a single moving element.
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      style={{
        flexShrink: 0,
        transition: 'transform .15s',
        transform: expanded ? 'none' : 'rotate(-90deg)',
      }}
    >
      <path
        d="M2 4l3 3 3-3"
        stroke="#fff"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// 25% gives the objective column ~95px at the smallest 380px-wide layout —
// enough for one or two short words. KRs and Actions split the remaining
// space evenly with `1fr` each, clamped at 130px so neither collapses to
// unreadable widths.
const GRID_COLS = 'minmax(120px, 25%) minmax(130px, 1fr) minmax(130px, 1fr)'

// The row used to be a single <button> covering the whole hit area. After
// splitting the click target (checkbox = toggle, title = open editor),
// the row is a <div> with two <button>s inside. Hover stays unified — the
// outer div paints the hover bg so the row still reads as one zone visually.
//
// Total horizontal padding (12 left + 4 right + 4 left + 12 right = 32) and
// the resulting 8px visual gap between checkbox and title both match the
// previous single-button row, so no shift in layout vs the prior version.
const rowDivStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  width: '100%',
  transition: 'background .12s',
}

const cbButtonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: '5px 4px 5px 12px',
  background: 'none',
  border: 'none',
  outline: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'flex-start',
  fontFamily: 'inherit',
  WebkitTapHighlightColor: 'transparent',
}

const titleButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '5px 12px 5px 4px',
  background: 'none',
  border: 'none',
  outline: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  WebkitTapHighlightColor: 'transparent',
}

export default function Summary({
  spaces,
  objectives,
  roadmapItems,
  actions,
  onOpenObjective,
  onOpenAction,
  onToggleAction,
  onToggleKR,
}: Props) {
  // Per-space collapse state. Persisted to localStorage so the user's last
  // arrangement survives a reload — same pattern as theme + weekStart in
  // page.tsx. Starts empty (everything expanded) on first paint to keep
  // SSR-safe; the saved set hydrates on mount.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const saved = localStorage.getItem('hq-summary-collapsed')
      if (saved) setCollapsed(new Set(JSON.parse(saved)))
    } catch {
      /* noop — corrupt storage shouldn't break the page */
    }
  }, [])

  function toggleCollapsed(spaceId: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(spaceId)) next.delete(spaceId)
      else next.add(spaceId)
      try {
        localStorage.setItem('hq-summary-collapsed', JSON.stringify([...next]))
      } catch {
        /* noop */
      }
      return next
    })
  }

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
        // Dedupe: an action carried forward creates a NEW row each week
        // (with carried_over=true) without removing the original — so the
        // same logical action can appear once per week it's been carried.
        // Collapse to one entry per (kr, title) keeping the most recent.
        // The historical originals stay in the DB for Reflect/History;
        // Summary just shows the live working item.
        const dedupedActions = (() => {
          const seen = new Map<string, WeeklyAction>()
          for (const a of actions) {
            if (!krIds.has(a.roadmap_item_id) || a.completed) continue
            const key = `${a.roadmap_item_id}::${a.title}`
            const existing = seen.get(key)
            if (!existing || a.week_start > existing.week_start) {
              seen.set(key, a)
            }
          }
          return [...seen.values()]
        })()
        const spaceActions = dedupedActions
          .sort((a, b) => b.week_start.localeCompare(a.week_start))

        const isCollapsed = collapsed.has(space.id)
        const krCount = spaceKRs.length
        const actionCount = spaceActions.length

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
            {/* Space band — clickable to collapse/expand. Saturated color
                from the COLORS palette, white text. Counts on the right
                stay visible whether collapsed or expanded so the band
                always tells you what's in the section. */}
            <button
              onClick={() => toggleCollapsed(space.id)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: space.color,
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                textAlign: 'left',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'inherit',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <Chevron expanded={!isCollapsed} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {space.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  // Slightly muted against #fff title — keeps counts a hair
                  // quieter than the name without going to a separate color.
                  opacity: 0.8,
                  letterSpacing: '0.4px',
                  textTransform: 'none',
                  flexShrink: 0,
                }}
              >
                {krCount} {krCount === 1 ? 'KR' : 'KRs'} · {actionCount} {actionCount === 1 ? 'action' : 'actions'}
              </span>
            </button>

            {!isCollapsed && (
              spaceObjs.length === 0 ? (
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
                        outline: 'none',
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
                        WebkitTapHighlightColor: 'transparent',
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
                          <div
                            key={kr.id}
                            style={rowDivStyle}
                            onMouseEnter={e =>
                              (e.currentTarget.style.background = 'var(--navy-600)')
                            }
                            onMouseLeave={e =>
                              (e.currentTarget.style.background = 'transparent')
                            }
                          >
                            <button
                              onClick={() => onToggleKR(kr)}
                              style={cbButtonStyle}
                              aria-label={done ? 'Un-mark done' : 'Mark done'}
                            >
                              <Checkbox checked={done} />
                            </button>
                            <button
                              onClick={() => onOpenObjective(space.id, obj.id)}
                              style={titleButtonStyle}
                            >
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
                                  display: 'block',
                                }}
                              >
                                {kr.title}
                              </span>
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    {/* Cell 3 — open actions only. */}
                    <div style={{ padding: '4px 0', minWidth: 0 }}>
                      {objActions.map(a => (
                        <div
                          key={a.id}
                          style={rowDivStyle}
                          onMouseEnter={e =>
                            (e.currentTarget.style.background = 'var(--navy-600)')
                          }
                          onMouseLeave={e =>
                            (e.currentTarget.style.background = 'transparent')
                          }
                        >
                          <button
                            onClick={() => onToggleAction(a)}
                            style={cbButtonStyle}
                            aria-label={a.completed ? 'Un-complete action' : 'Mark action complete'}
                          >
                            <Checkbox checked={a.completed} />
                          </button>
                          <button
                            onClick={() => onOpenAction(space.id, a)}
                            style={titleButtonStyle}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                color: a.completed ? 'var(--navy-400)' : 'var(--navy-200)',
                                textDecoration: a.completed ? 'line-through' : 'none',
                                lineHeight: 1.35,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                minWidth: 0,
                                display: 'block',
                              }}
                            >
                              {a.title}
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
