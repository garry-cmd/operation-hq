'use client'
import { useState, useEffect } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q, COLORS } from '@/lib/utils'
import { calculateRollingAggregate, calculateMetricAggregate } from '@/lib/habitUtils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'
import { scrollToAndFlash } from '@/lib/scrollFlash'
import MetricKPICard from './MetricKPICard'
import ObjectiveCard from './ObjectiveCard'
import ObjectivePanel from './ObjectivePanel'
import Modal from './Modal'
import EditKRModal from './EditKRModal'
import EditObjectiveModal from './EditObjectiveModal'

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

