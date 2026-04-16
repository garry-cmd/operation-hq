'use client'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog } from '@/lib/types'
import ObjectiveCard from './ObjectiveCard'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  weekStart: string
  links: ObjectiveLink[]
  logs: ObjectiveLog[]
  onAddLink: (link: ObjectiveLink) => void
  onDeleteLink: (id: string) => void
  onAddLog: (log: ObjectiveLog) => void
  onDeleteLog: (id: string) => void
  toast: (m: string) => void
}

export default function OKRs({ objectives, roadmapItems, setObjectives, setRoadmapItems, actions, setActions, weekStart, links, logs, onAddLink, onDeleteLink, onAddLog, onDeleteLog, toast }: Props) {
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack  = activeKRs.filter(i => i.health_status === 'on_track').length
  const offTrack = activeKRs.filter(i => i.health_status === 'off_track').length

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>My OKRs</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>What you're working on right now</p>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
        {[
          ['Key Results',      activeKRs.length,   'var(--accent)'],
          ['On track',         onTrack,             'var(--teal-text)'],
          ['Off track',        offTrack,            'var(--red-text)'],
        ].map(([l, v, c]) => (
          <div key={l as string} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '11px 13px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c as string }}>{v}</div>
          </div>
        ))}
      </div>

      {activeKRs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          No active key results yet.<br />
          <span style={{ fontSize: 13 }}>Add objectives and key results on the Roadmap.</span>
        </div>
      )}

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
              links={links}
              logs={logs}
              setRoadmapItems={setRoadmapItems}
              setObjectives={setObjectives}
              setActions={setActions}
              onAddLink={onAddLink}
              onDeleteLink={onDeleteLink}
              onAddLog={onAddLog}
              onDeleteLog={onDeleteLog}
              onEditKR={() => {}}
              toast={toast}
            />
          )
        })}
    </div>
  )
}
