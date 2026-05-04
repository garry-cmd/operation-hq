'use client'
import { useState } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q, COLORS } from '@/lib/utils'
import { calculateRollingAggregate, calculateMetricAggregate } from '@/lib/habitUtils'
import { recentCheckins } from '@/lib/metricUtils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'
import ObjectiveCard from './ObjectiveCard'
import ObjectivePanel from './ObjectivePanel'
import Modal from './Modal'

// Naval-themed SVG Icons
const EditIcon = ({ size = 14, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

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
}

export default function OKRs({ objectives, roadmapItems, setObjectives, setRoadmapItems, actions, setActions, weekStart, links, logs, setLinks, setLogs, openObjectiveId, setOpenObjectiveId, activeSpaceId, habitCheckins, metricCheckins, toast, onLogMetric }: Props) {
  const [editingKR, setEditingKR] = useState<RoadmapItem | null>(null)
  const [editingObjective, setEditingObjective] = useState<AnnualObjective | null>(null)
  
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
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>My OKRs</h1>
        <p style={{ fontSize: 12, color: 'var(--navy-300)' }}>What you're working on right now</p>
      </div>

      {/* KPI Dashboard */}
      {(activeKRs.filter(kr => kr.is_habit).length > 0 || activeKRs.filter(kr => kr.is_metric).length > 0) && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', margin: '0 0 12px 0' }}>Key metrics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {/* Habit KPIs */}
            {activeKRs
              .filter(kr => kr.is_habit)
              .map(kr => {
                const aggregate = calculateRollingAggregate(kr, habitCheckins, 4)
                // Color thresholds: <50 red, 50–79 amber, ≥80 teal.
                const tone = aggregate.percent >= 80 ? 'teal'
                           : aggregate.percent >= 50 ? 'amber'
                           : 'red'
                return (
                  <div key={kr.id} style={{
                    background: `var(--${tone}-bg)`,
                    border: `1px solid var(--${tone}-text)`,
                    borderRadius: 8,
                    padding: '14px 16px',
                  }}>
                    <p style={{ fontSize: 12, color: `var(--${tone}-text)`, opacity: 0.85, margin: '0 0 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {kr.title}
                    </p>
                    <p style={{ fontSize: 24, fontWeight: 600, color: `var(--${tone}-text)`, margin: '0 0 3px 0' }}>
                      {aggregate.percent}%
                    </p>
                    <div style={{ fontSize: 11, color: `var(--${tone}-text)`, opacity: 0.7, margin: 0 }}>
                      {aggregate.sessions}/{aggregate.expected} sessions
                    </div>
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
                <div key={obj.id} style={{ marginBottom: 20, position: 'relative' }}>
                  {/* Edit button positioned over ObjectiveCard */}
                  <button
                    onClick={() => setEditingObjective(obj)}
                    style={{
                      position: 'absolute',
                      top: 12,
                      right: 48, // shifted left to clear the chevron at top:12, right:14
                      zIndex: 10,
                      background: 'var(--navy-700)',
                      border: '1px solid var(--navy-600)',
                      color: 'var(--navy-400)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '6px 8px',
                      borderRadius: 6
                    }}
                    title="Edit objective"
                  >
                    <EditIcon size={16} />
                  </button>

                  <ObjectiveCard
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
                    isActive={openObjectiveId === obj.id}
                    toast={toast}
                  />
                </div>
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

// KR edit modal with delete functionality
function EditKRModal({ kr, onClose, onSave, onDelete, toast }: {
  kr: RoadmapItem
  onClose: () => void
  onSave: (kr: Partial<RoadmapItem>) => void
  onDelete: () => void
  toast: (m: string) => void
}) {
  const [title, setTitle] = useState(kr.title)
  const [healthStatus, setHealthStatus] = useState(kr.health_status)
  const [saving, setSaving] = useState(false)

  // Metric fields. All stored as strings so inputs stay controlled even when
  // empty; parsed on save. A KR is either a metric, a habit, or neither —
  // turning is_metric on forces is_habit off.
  const [isMetric, setIsMetric] = useState(kr.is_metric)
  const [metricUnit, setMetricUnit] = useState(kr.metric_unit ?? '')
  const [metricDirection, setMetricDirection] = useState<'up' | 'down'>(kr.metric_direction ?? 'up')
  const [startValue, setStartValue] = useState<string>(kr.start_value != null ? String(kr.start_value) : '')
  const [targetValue, setTargetValue] = useState<string>(kr.target_value != null ? String(kr.target_value) : '')
  const [targetDate, setTargetDate] = useState<string>(kr.target_date ?? '')

  async function save() {
    if (!title.trim()) return
    if (isMetric) {
      // Require enough config to make the metric meaningful. These power the
      // auto-compute + dashboard; a metric KR without them is inert.
      if (!metricUnit.trim() || startValue === '' || targetValue === '') {
        toast('Metric KRs need a unit, start, and target.')
        return
      }
      const s = Number(startValue), t = Number(targetValue)
      if (Number.isNaN(s) || Number.isNaN(t)) { toast('Start and target must be numbers.'); return }
      if (s === t) { toast('Start and target can\'t be the same value.'); return }
    }
    setSaving(true)

    try {
      const updatedKR: Partial<RoadmapItem> = {
        title: title.trim(),
        health_status: healthStatus,
        is_metric: isMetric,
        // When metric is off, null out the metric-specific fields so stale
        // data doesn't resurface if the toggle gets flipped back on later.
        metric_unit:      isMetric ? metricUnit.trim() : null,
        metric_direction: isMetric ? metricDirection : null,
        start_value:      isMetric ? Number(startValue) : null,
        target_value:     isMetric ? Number(targetValue) : null,
        target_date:      isMetric ? (targetDate || null) : null,
      }
      // Metric and habit are mutually exclusive — if we're turning metric on,
      // force is_habit off so the KR doesn't show up in Focus bubbles.
      if (isMetric && kr.is_habit) {
        updatedKR.is_habit = false
      }

      await onSave(updatedKR)
    } catch (error) {
      console.error('Failed to update KR:', error)
      toast('Failed to update KR')
    }

    setSaving(false)
  }

  return (
    <Modal
      title="Edit Key Result"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onDelete}
            style={{ color: 'var(--red)', marginRight: 'auto' }}
          >
            Delete
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !title.trim()}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Title</label>
        <input
          className="input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
          placeholder="e.g. Lose 20 lbs"
        />
      </div>

      <div className="field">
        <label>Health Status</label>
        <select
          className="input"
          value={healthStatus}
          onChange={e => setHealthStatus(e.target.value as any)}
        >
          <option value="backlog">Backlog</option>
          <option value="on_track">On Track</option>
          <option value="off_track">Off Track</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>

      <div className="field">
        <label>Status</label>
        <select
          className="input"
          value={healthStatus}
          onChange={e => setHealthStatus(e.target.value as any)}
        >
          <option value="not_started">Not started</option>
          <option value="on_track">On track</option>
          <option value="off_track">Off track</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
      </div>

      {/* Metric KR config — collapsed behind a toggle to keep the modal light
          for normal outcome KRs. Only shows the detail fields when on. */}
      <div className="field" style={{ borderTop: '1px solid var(--navy-600)', paddingTop: 14, marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={isMetric}
            onChange={e => setIsMetric(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontWeight: 600, color: 'var(--navy-100)' }}>Track as a metric</span>
        </label>
        <div style={{ fontSize: 12, color: 'var(--navy-400)', marginLeft: 26 }}>
          Log a number each week (weight, net worth, revenue, etc.). Progress auto-computes.
        </div>
      </div>

      {isMetric && (
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, padding: '12px 14px', marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Unit</label>
              <input className="input" value={metricUnit} onChange={e => setMetricUnit(e.target.value)} placeholder="lbs, $, %" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Direction</label>
              <select className="input" value={metricDirection} onChange={e => setMetricDirection(e.target.value as 'up' | 'down')}>
                <option value="up">Up is better</option>
                <option value="down">Down is better</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Start value</label>
              <input className="input" type="number" inputMode="decimal" value={startValue} onChange={e => setStartValue(e.target.value)} placeholder="e.g. 215" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Target value</label>
              <input className="input" type="number" inputMode="decimal" value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="e.g. 190" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Target date <span style={{ color: 'var(--navy-500)', fontWeight: 400 }}>(optional)</span></label>
            <input className="input" type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
          </div>
        </div>
      )}
    </Modal>
  )
}

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
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    
    try {
      const updatedObjective = {
        name: name.trim(),
        color: color,
        status: status
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
            style={{ color: 'var(--red)', marginRight: 'auto' }}
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

  const current = latest12Desc[0]?.value != null ? Number(latest12Desc[0].value) : null
  const previous = latest12Desc[1]?.value != null ? Number(latest12Desc[1].value) : null
  const delta = current != null && previous != null ? current - previous : null

  // Direction-aware delta coloring: "good" = toward target.
  const deltaIsGood = delta == null || Math.abs(delta) < 0.0001
    ? null
    : kr.metric_direction === 'up' ? delta > 0 : delta < 0

  // Tint by progress, same thresholds as habits — unified language for the row
  // of cards. Null progress (under-configured KR) falls through to navy neutral.
  const tone: 'teal' | 'amber' | 'red' | 'neutral' =
    progressNum == null ? 'neutral'
    : progressNum >= 80 ? 'teal'
    : progressNum >= 50 ? 'amber'
    : 'red'

  // For the neutral case (under-configured / no data yet) use navy vars so the
  // card still reads like the others without false-signaling green/red.
  const tintBg   = tone === 'neutral' ? 'var(--navy-800)' : `var(--${tone}-bg)`
  const tintEdge = tone === 'neutral' ? 'var(--navy-600)' : `var(--${tone}-text)`
  const tintText = tone === 'neutral' ? 'var(--navy-100)' : `var(--${tone}-text)`

  return (
    <button onClick={onTap} style={{
      textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
      background: tintBg, border: `1px solid ${tintEdge}`, borderRadius: 8,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8,
      width: '100%',
    }}>
      <div style={{ fontSize: 12, color: tintText, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
        {kr.title}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        {current != null ? (
          <>
            <span style={{ fontSize: 24, fontWeight: 600, color: tintText, lineHeight: 1 }}>
              {isPrefixCurrency(unit) && unit.trim()}{formatMetricNumber(current)}
            </span>
            {isMeaningfulUnit(unit) && !isPrefixCurrency(unit) && <span style={{ fontSize: 13, color: tintText, opacity: 0.7 }}>{unit.trim()}</span>}
            {delta != null && (
              <span style={{
                fontSize: 11, fontWeight: 700, marginLeft: 4,
                color: deltaIsGood == null ? tintText : (deltaIsGood ? 'var(--teal-text)' : 'var(--red-text)'),
                opacity: deltaIsGood == null ? 0.6 : 1,
              }}>
                {delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : ''}
                {formatMetricNumber(Number(delta.toFixed(2)))}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 14, fontStyle: 'italic', color: tintText, opacity: 0.7 }}>
            No readings yet
          </span>
        )}
      </div>

      {(startNum != null || targetNum != null) && (
        <div style={{ fontSize: 10, color: tintText, opacity: 0.65 }}>
          {startNum != null && <>Start {formatMetricValue(startNum, unit)}</>}
          {startNum != null && targetNum != null && <> → </>}
          {targetNum != null && <>Target {formatMetricValue(targetNum, unit)}</>}
        </div>
      )}
    </button>
  )
}


