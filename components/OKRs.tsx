'use client'
import { useState, useEffect, type CSSProperties } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q, COLORS, parseDateLocal } from '@/lib/utils'
import { calculateRollingAggregate, calculateMetricAggregate } from '@/lib/habitUtils'
import { recentCheckins, sparklineTrend } from '@/lib/metricUtils'
import { getQuarterRange } from '@/lib/dateBuckets'
import { getCurrentQuarterKRs } from '@/lib/krFilters'
import { scrollToAndFlash } from '@/lib/scrollFlash'
import ObjectiveCard from './ObjectiveCard'
import ObjectivePanel from './ObjectivePanel'
import Modal from './Modal'
import EditKRModal from './EditKRModal'

// Naval-themed SVG Icons
// (EditIcon removed May 21 — the inline edit button now lives inside
// ObjectiveCard's bottom toolbar with its SVG inlined there.)
const TargetIcon = ({ size = 36, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2"/>
    <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

const OnTrackIcon = ({ size = 14, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

const OffTrackIcon = ({ size = 14, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 9v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m12 17.02.01-.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const BlockedIcon = ({ size = 14, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <path d="m4.93 4.93 14.14 14.14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

const LightbulbIcon = ({ size = 14, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10 22h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  weekStart: string
  // Links + logs are full lists for the active space; ObjectivePanel filters
  // to the active objective internally. Setters are page-level (matches the
  // ActionPanel pattern in Focus.tsx) so the panel can update parent state
  // optimistically without per-callback prop wiring.
  links: ObjectiveLink[]
  logs: ObjectiveLog[]
  setLinks: (fn: (p: ObjectiveLink[]) => ObjectiveLink[]) => void
  setLogs: (fn: (p: ObjectiveLog[]) => ObjectiveLog[]) => void
  // Currently-open objective panel. Lifted to page level so <main> can widen
  // its max-width when the panel is open (push-aside layout, mirrors
  // openActionId for ActionPanel on Focus).
  openObjectiveId: string | null
  setOpenObjectiveId: (id: string | null) => void
  activeSpaceId: string
  habitCheckins: HabitCheckin[]
  metricCheckins: MetricCheckin[]
  toast: (m: string) => void
  onLogMetric: (krId: string) => void
  // Display name for the active space — drives the H1. Wired from page.tsx
  // as activeSpace.name; falls back to 'My OKRs' if a space lookup misses.
  spaceName: string
  // Set by the command palette to deep-link a KR; consumed on arrival to
  // scroll the KR into view and flash it.
  initialKRId?: string | null
  onConsumeInitialKRId?: () => void
}

export default function OKRs({ objectives, roadmapItems, setObjectives, setRoadmapItems, actions, setActions, weekStart, links, logs, setLinks, setLogs, openObjectiveId, setOpenObjectiveId, activeSpaceId, habitCheckins, metricCheckins, toast, onLogMetric, spaceName, initialKRId, onConsumeInitialKRId }: Props) {
  const [editingKR, setEditingKR] = useState<RoadmapItem | null>(null)
  const [editingObjective, setEditingObjective] = useState<AnnualObjective | null>(null)

  // Command-palette deep-link: scroll the targeted KR into view + flash it.
  // Consume only once scrollToAndFlash settles, so expandKRId stays live long
  // enough for a cross-space jump's owning card to mount and auto-expand.
  useEffect(() => {
    if (!initialKRId) return
    scrollToAndFlash(initialKRId, () => onConsumeInitialKRId?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKRId])
  
  // OKRs tab = "what you're working on right now" → only KRs in the active quarter.
  // Future-quarter KRs (status 'planned') live on the Roadmap until their quarter
  // becomes active.
  const activeKRs = getCurrentQuarterKRs(roadmapItems, ACTIVE_Q)
  const weekActions = actions.filter(a => a.week_start === weekStart)

  async function deleteKR(id: string) {
    try {
      await krsDb.remove(id)
      setRoadmapItems(prev => prev.filter(kr => kr.id !== id))
      toast('Key Result deleted')
    } catch (err) {
      console.error('deleteKR error:', err)
      toast('Failed to delete KR')
    }
  }

  async function deleteObjective(id: string) {
    try {
      // First delete all KRs for this objective
      try {
        await krsDb.removeByObjective(id)
      } catch (krErr) {
        console.error('Delete objective KRs error:', krErr)
        toast('Failed to delete objective - could not remove key results')
        return
      }

      // Then delete the objective
      try {
        await objectivesDb.remove(id)
      } catch (objErr) {
        console.error('Delete objective error:', objErr)
        toast('Failed to delete objective')
        return
      }

      // Update local state
      setRoadmapItems(prev => prev.filter(kr => kr.annual_objective_id !== id))
      setObjectives(prev => prev.filter(obj => obj.id !== id))
      toast('Objective deleted')
    } catch (err) {
      console.error('deleteObjective error:', err)
      toast('Failed to delete objective')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', marginBottom: 6 }}>Strategic · OKRs</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--navy-50)', margin: 0, letterSpacing: '-.02em' }}>{spaceName}</h1>
      </div>

      {/* KPI Dashboard */}
      {(activeKRs.filter(kr => kr.is_habit).length > 0 || activeKRs.filter(kr => kr.is_metric).length > 0) && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', margin: '0 0 12px 0' }}>Key metrics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {/* Habit KPIs */}
            {activeKRs
              .filter(kr => kr.is_habit)
              .map(kr => {
                const aggregate = calculateRollingAggregate(kr, habitCheckins, 4)
                // Tone: zero sessions yet → standby (don't shout "off track"
                // before there's any data). Otherwise: <50 alarm, 50–79
                // caution, ≥80 nominal. Night-watch token mapping.
                const tone = aggregate.sessions === 0 ? 'standby'
                           : aggregate.percent >= 80 ? 'nominal'
                           : aggregate.percent >= 50 ? 'caution'
                           : 'alarm'
                const heroColor = tone === 'nominal' ? 'var(--nw-nominal-text)'
                                : tone === 'caution' ? 'var(--nw-hero-amber)'
                                : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                                : 'var(--nw-standby-text)'
                const borderAccent = tone === 'nominal' ? 'var(--nw-nominal-text)'
                                   : tone === 'caution' ? 'var(--nw-caution-text)'
                                   : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                                   : 'var(--nw-standby-text)'
                return (
                  <div key={kr.id}
                    title={`${aggregate.sessions}/${aggregate.expected} sessions`}
                    style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderLeft: `3px solid ${borderAccent}`,
                    borderRadius: 14,
                    boxShadow: 'var(--card-shadow)',
                    padding: '14px 16px',
                  }}>
                    <p style={{ fontSize: 12, color: 'var(--nw-cream)', fontWeight: 500, margin: '0 0 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {kr.title}
                    </p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, color: heroColor, margin: 0, letterSpacing: '-.01em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {aggregate.percent}<span style={{ fontSize: 16 }}>%</span>
                    </p>
                  </div>
                )
              })}

            {/* Metric KPIs — tap to open log modal. Tinted by progress%
                (same thresholds as habits); sparkline inside shows 12-week trend. */}
            {activeKRs
              .filter(kr => kr.is_metric)
              .map(kr => (
                <MetricKPICard
                  key={kr.id}
                  kr={kr}
                  checkins={metricCheckins}
                  onTap={() => onLogMetric(kr.id)}
                />
              ))}
          </div>
        </div>
      )}

      {activeKRs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 16 }}><TargetIcon size={48} /></div>
          No active key results yet.<br />
          <span style={{ fontSize: 13 }}>Tap the + button to add your first objective.</span>
        </div>
      )}

      {/* Objectives section — mirrors the Key Metrics section above:
          amber instrument h2, hairline divider above to keep the two visually
          separate. Hidden when there are no active objectives so the empty
          state above doesn't get crowded by a dangling header. */}
      {objectives.some(o => o.status !== 'abandoned') && (
      <div style={{ borderTop: '1px solid var(--navy-700)', paddingTop: 18, marginTop: 4 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', margin: '0 0 12px 0' }}>Objectives</h2>
        {/* Two-column layout: card list on the left, ObjectivePanel sticky
            on the right when an objective is selected. Mirrors Focus.tsx's
            push-aside pattern for ActionPanel. <main> in page.tsx widens to
            1280 when openObjectiveId is set so this grid has the room. */}
        <div style={{
          display: openObjectiveId ? 'grid' : 'block',
          gridTemplateColumns: openObjectiveId ? 'minmax(0, 1fr) 480px' : undefined,
          gap: openObjectiveId ? 24 : undefined,
          alignItems: 'start',
        }}>
        <div>
          {objectives
            .filter(o => o.status !== 'abandoned')
            .map(obj => {
              const objKRs = activeKRs.filter(i => i.annual_objective_id === obj.id)
              return (
                <ObjectiveCard
                  key={obj.id}
                  obj={obj}
                  krs={objKRs}
                  actions={actions}
                  weekStart={weekStart}
                  metricCheckins={metricCheckins}
                  setRoadmapItems={setRoadmapItems}
                  setObjectives={setObjectives}
                  setActions={setActions}
                  onEditKR={setEditingKR}
                  onLogMetric={onLogMetric}
                  onObjectiveClick={setOpenObjectiveId}
                  onEditObjective={setEditingObjective}
                  isActive={openObjectiveId === obj.id}
                  toast={toast}
                  expandKRId={initialKRId}
                />
              )
            })}
        </div>

        {/* ObjectivePanel — appears in the right column when an objective is
            selected. Uses the activeSpace-scoped links/logs already in OKRs's
            props; filters them to the open objective. setLinks/setLogs are
            page-level setters threaded through. activeSpaceId comes along
            for completeness even though the panel doesn't need it directly. */}
        {openObjectiveId && (() => {
          const openObj = objectives.find(o => o.id === openObjectiveId)
          if (!openObj) return null
          const openObjKRs = activeKRs.filter(i => i.annual_objective_id === openObjectiveId)
          const openObjLinks = links.filter(l => l.objective_id === openObjectiveId)
          const openObjLogs = logs.filter(l => l.objective_id === openObjectiveId)
          // activeSpaceId still typed in props but unused below — silence the
          // lint for the destructure without dropping the prop.
          void activeSpaceId
          return (
            <ObjectivePanel
              objective={openObj}
              krs={openObjKRs}
              links={openObjLinks}
              logs={openObjLogs}
              setLinks={setLinks}
              setLogs={setLogs}
              onClose={() => setOpenObjectiveId(null)}
              toast={toast}
            />
          )
        })()}
      </div>
      </div>
      )}

      {/* Modals */}
      {editingKR && (
        <EditKRModal
          kr={editingKR}
          onClose={() => setEditingKR(null)}
          onSave={async (updatedKR) => {
            try {
              const updated = await krsDb.update(editingKR.id, updatedKR)
              setRoadmapItems(prev => prev.map(kr => kr.id === editingKR.id ? updated : kr))
              setEditingKR(null)
              toast('Key Result updated')
            } catch (err) {
              console.error('updateKR error:', err)
              toast('Failed to update KR')
            }
          }}
          onDelete={() => {
            deleteKR(editingKR.id)
            setEditingKR(null)
          }}
          toast={toast}
        />
      )}

      {editingObjective && (
        <EditObjectiveModal
          objective={editingObjective}
          onClose={() => setEditingObjective(null)}
          onSave={async (updatedObjective) => {
            try {
              const updated = await objectivesDb.update(editingObjective.id, updatedObjective)
              setObjectives(prev => prev.map(obj => obj.id === editingObjective.id ? updated : obj))
              setEditingObjective(null)
              toast('Objective updated')
            } catch (err) {
              console.error('updateObjective error:', err)
              toast('Failed to update objective')
            }
          }}
          onDelete={() => {
            deleteObjective(editingObjective.id)
            setEditingObjective(null)
          }}
          toast={toast}
        />
      )}
    </div>
  )
}

// EditKRModal moved to components/EditKRModal.tsx in Chunk 4 (May 21)
// so the All Spaces dashboard can open it in-place.


// Objective edit modal with delete functionality
function EditObjectiveModal({ objective, onClose, onSave, onDelete, toast }: {
  objective: AnnualObjective
  onClose: () => void
  onSave: (obj: Partial<AnnualObjective>) => void
  onDelete: () => void
  toast: (m: string) => void
}) {
  const [name, setName] = useState(objective.name)
  const [color, setColor] = useState(objective.color)
  const [status, setStatus] = useState(objective.status)
  const [startDate, setStartDate] = useState<string>(objective.start_date ?? '')
  const [endDate, setEndDate] = useState<string>(objective.end_date ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    if (startDate && endDate && endDate < startDate) {
      toast('End date can\'t be before start date.')
      return
    }
    setSaving(true)
    
    try {
      const updatedObjective = {
        name: name.trim(),
        color: color,
        status: status,
        start_date: startDate || null,
        end_date: endDate || null,
      }
      
      await onSave(updatedObjective)
    } catch (error) {
      console.error('Failed to update objective:', error)
      toast('Failed to update objective')
    }
    
    setSaving(false)
  }

  return (
    <Modal 
      title="Edit Objective" 
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onDelete}
            style={{ color: 'var(--red-text)', marginRight: 'auto' }}
          >
            Delete
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary" 
            onClick={save} 
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Objective Name</label>
        <textarea 
          className="input" 
          rows={3} 
          value={name} 
          onChange={e => setName(e.target.value)} 
          autoFocus
          placeholder="e.g. Get in amazing shape this year" 
        />
      </div>
      
      <div className="field">
        <label>Color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button 
              key={c} 
              onClick={() => setColor(c)}
              style={{ 
                width: 32, 
                height: 32, 
                borderRadius: '50%', 
                background: c, 
                border: color === c ? '3px solid var(--navy-50)' : '2px solid transparent', 
                cursor: 'pointer', 
                outline: color === c ? '2px solid ' + c : 'none', 
                outlineOffset: 2 
              }} 
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>Time window <span style={{ color: 'var(--nw-label-dim)', fontWeight: 400 }}>(optional)</span></label>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--nw-label-dim)' }}>Start</label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--nw-label-dim)' }}>End</label>
            <input
              className="input"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="field">
        <label>Status</label>
        <select 
          className="input" 
          value={status} 
          onChange={e => setStatus(e.target.value as any)}
        >
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>
    </Modal>
  )
}

// =========================================================================
// MetricKPICard — tinted card summarizing a metric KR, with 12-week sparkline.
// Tap anywhere on the card to open the log modal.
// =========================================================================

// Symbol-form currencies render before the number; everything else (kg, lb,
// sessions, %, USD, etc.) renders after. Numbers always get thousand separators.
// '#' is treated as "no unit" — it's a placeholder users sometimes type that
// reads as garbage in the UI.
const PREFIX_CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₹', '₩', '₽', '¢'])

function isMeaningfulUnit(unit: string): boolean {
  const trimmed = unit.trim()
  return trimmed.length > 0 && trimmed !== '#'
}

function isPrefixCurrency(unit: string): boolean {
  return PREFIX_CURRENCY_SYMBOLS.has(unit.trim())
}

function formatMetricNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatMetricValue(n: number, unit: string): string {
  const num = formatMetricNumber(n)
  if (!isMeaningfulUnit(unit)) return num
  if (isPrefixCurrency(unit)) return `${unit.trim()}${num}`
  return `${num} ${unit.trim()}`
}

function MetricKPICard({
  kr, checkins, onTap,
}: {
  kr: RoadmapItem
  checkins: MetricCheckin[]
  onTap: () => void
}) {
  const unit = kr.metric_unit ?? ''

  // Supabase returns `numeric` columns as strings — coerce here. Doing it at
  // the boundary means the rest of this component can trust JS number math.
  // (Same pattern should live at the page.tsx data-load layer eventually;
  // for now, card-local is enough.)
  const startNum  = kr.start_value  == null ? null : Number(kr.start_value)
  const targetNum = kr.target_value == null ? null : Number(kr.target_value)
  const progressNum = kr.progress == null ? null : Number(kr.progress)

  // Last 12 checkins, descending. Used for current + delta only.
  const latest12Desc = recentCheckins(checkins, kr.id, 12)

  // Quarter-scoped readings — weekly check-ins whose week_start falls inside
  // the active quarter, oldest → newest. Drives both the sparkline (values,
  // scaled to own min/max so movement is legible) and the flip-side list.
  const qRange = getQuarterRange(ACTIVE_Q)
  const qReadingsAsc = checkins
    .filter(c => c.roadmap_item_id === kr.id && (!qRange || (c.week_start >= qRange.start && c.week_start <= qRange.end)))
    .map(c => ({ week_start: c.week_start, value: Number(c.value) }))
    .filter(r => !Number.isNaN(r.value))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
  const quarterSeries = qReadingsAsc.map(r => r.value)
  const readingsDesc = [...qReadingsAsc].reverse()

  const current = latest12Desc[0]?.value != null ? Number(latest12Desc[0].value) : null
  const previous = latest12Desc[1]?.value != null ? Number(latest12Desc[1].value) : null
  const delta = current != null && previous != null ? current - previous : null

  // Direction-aware delta coloring: "good" = toward target.
  const deltaIsGood = delta == null || Math.abs(delta) < 0.0001
    ? null
    : kr.metric_direction === 'up' ? delta > 0 : delta < 0

  // Tint by progress, same thresholds as habits — unified language for the row
  // of cards. Standby covers both "under-configured" (no progress field) and
  // "no readings yet" — don't shout off-track before there's any data.
  const hasNoCheckins = latest12Desc.length === 0
  const tone: 'nominal' | 'caution' | 'alarm' | 'standby' =
    (progressNum == null || hasNoCheckins) ? 'standby'
    : progressNum >= 80 ? 'nominal'
    : progressNum >= 50 ? 'caution'
    : 'alarm'

  const heroColor = tone === 'nominal' ? 'var(--nw-nominal-text)'
                  : tone === 'caution' ? 'var(--nw-hero-amber)'
                  : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                  : 'var(--nw-standby-text)'
  const borderAccent = tone === 'nominal' ? 'var(--nw-nominal-text)'
                     : tone === 'caution' ? 'var(--nw-caution-text)'
                     : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                     : 'var(--nw-standby-text)'

  // Build a tooltip string from start / target so the context is still
  // discoverable on hover without consuming a card row. Empty string means
  // no tooltip — both bounds unset.
  const tooltipParts: string[] = []
  if (startNum != null) tooltipParts.push(`Start ${formatMetricValue(startNum, unit)}`)
  if (targetNum != null) tooltipParts.push(`Target ${formatMetricValue(targetNum, unit)}`)
  const tooltip = tooltipParts.join(' → ') || undefined

  const [flipped, setFlipped] = useState(false)
  const faceBase: CSSProperties = {
    position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
    background: 'var(--surface)', border: '1px solid var(--line)',
    borderLeft: `3px solid ${borderAccent}`, borderRadius: 14, boxShadow: 'var(--card-shadow)', display: 'flex', flexDirection: 'column',
  }
  const fmtRowVal = (v: number) => `${isPrefixCurrency(unit) ? unit.trim() : ''}${formatMetricNumber(v)}`
  const fmtShortDate = (d: string) => {
    const dt = parseDateLocal(d)
    return `${dt.toLocaleDateString('en-US', { month: 'short' })} ${dt.getDate()}`
  }

  return (
    <div style={{ perspective: 1200 }}>
      <div
        onClick={() => setFlipped(f => !f)}
        style={{
          position: 'relative', height: 168, cursor: 'pointer',
          transformStyle: 'preserve-3d', transition: 'transform .5s cubic-bezier(.4,0,.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'none',
        }}>

        {/* ── FRONT ── */}
        <div title={tooltip} style={{ ...faceBase, padding: '14px 16px', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--nw-cream)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
            {kr.title}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            {current != null ? (
              <>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, color: heroColor, lineHeight: 1, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums' }}>
                  {isPrefixCurrency(unit) && unit.trim()}{formatMetricNumber(current)}
                </span>
                {isMeaningfulUnit(unit) && !isPrefixCurrency(unit) && <span style={{ fontSize: 13, color: 'var(--nw-label-dim)' }}>{unit.trim()}</span>}
                {delta != null && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, marginLeft: 4,
                    color: deltaIsGood == null ? 'var(--nw-label-dim)' : (deltaIsGood ? 'var(--nw-nominal-text)' : 'var(--nw-alarm-text)'),
                  }}>
                    {delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : ''}
                    {formatMetricNumber(Number(delta.toFixed(2)))}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--nw-label-dim)' }}>
                No readings yet
              </span>
            )}
          </div>

          {quarterSeries.length >= 2 && (
            <MetricSparkline id={kr.id} values={quarterSeries} direction={kr.metric_direction} />
          )}

          <div style={{ position: 'absolute', right: 12, bottom: 9, display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--navy-400)' }}>
            ⟲ readings
          </div>
        </div>

        {/* ── BACK ── */}
        <div style={{ ...faceBase, transform: 'rotateY(180deg)', padding: '11px 12px 10px', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Readings</span>
            <span style={{ fontSize: 9.5, color: 'var(--navy-400)', fontVariantNumeric: 'tabular-nums' }}>
              {qReadingsAsc.length === 0 ? 'none yet' : `${qReadingsAsc.length} this quarter`}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', margin: '2px -4px 0', padding: '0 4px' }}>
            {readingsDesc.length === 0 ? (
              <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--nw-label-dim)', paddingTop: 8 }}>
                No readings logged yet.
              </div>
            ) : readingsDesc.map((r, i) => {
              const older = readingsDesc[i + 1]
              const d = older ? r.value - older.value : null
              const tone = d == null || Math.abs(d) < 1e-9 ? 'flat'
                         : ((d > 0) === (kr.metric_direction === 'up') ? 'good' : 'bad')
              const dColor = tone === 'good' ? 'var(--nw-nominal-text)' : tone === 'bad' ? 'var(--nw-alarm-text)' : 'var(--navy-400)'
              return (
                <div key={r.week_start} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', borderBottom: i === readingsDesc.length - 1 ? 'none' : '1px solid var(--navy-700)' }}>
                  <span style={{ fontSize: 11, color: 'var(--navy-300)', fontVariantNumeric: 'tabular-nums' }}>{fmtShortDate(r.week_start)}</span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--nw-cream)', fontVariantNumeric: 'tabular-nums' }}>{fmtRowVal(r.value)}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: dColor, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
                      {d == null ? 'start' : `${d > 0 ? '↑' : '↓'}${formatMetricNumber(Math.abs(Number(d.toFixed(2))))}`}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--navy-700)' }}>
            <button
              onClick={e => { e.stopPropagation(); onTap() }}
              style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
              + Log
            </button>
            <button
              onClick={e => { e.stopPropagation(); setFlipped(false) }}
              style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              ↩ back
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// MetricSparkline — quarter-trend line for a metric KPI card. Scaled to the
// series' own min/max so movement is visible; line + soft area fill, colored
// by whether the trend moves toward the KR's target (green) or away (red).
// Stretches to card width via preserveAspectRatio="none" with non-scaling
// strokes so the line stays crisp at any width. No end dot — a stretched
// circle distorts into an ellipse, and the trailing line end reads fine.
function MetricSparkline({ id, values, direction }: {
  id: string
  values: number[]
  direction: 'up' | 'down' | null
}) {
  const W = 100, H = 26, PAD = 3
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const n = values.length
  const xAt = (i: number) => (i / (n - 1)) * W
  const yAt = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const pts = values.map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
  const line = `M ${pts.join(' L ')}`
  const area = `${line} L ${W.toFixed(2)},${H} L 0,${H} Z`

  const trend = sparklineTrend(values, direction)
  const color = trend === 'improving' ? 'var(--nw-nominal-text)'
              : trend === 'declining' ? 'var(--nw-alarm-text)'
              : 'var(--nw-standby-text)'
  const gradId = `spark-${id}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}
      style={{ display: 'block', marginTop: 2 }} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}


