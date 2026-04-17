'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin } from '@/lib/types'
import { COLORS } from '@/lib/utils'
import { calculateRollingAggregate, calculateMetricAggregate } from '@/lib/habitUtils'
import ObjectiveCard from './ObjectiveCard'
import GuidedObjectiveBuilder from './GuidedObjectiveBuilder'
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
  links: ObjectiveLink[]
  logs: ObjectiveLog[]
  onAddLink: (link: ObjectiveLink) => void
  onDeleteLink: (id: string) => void
  onAddLog: (log: ObjectiveLog) => void
  onDeleteLog: (id: string) => void
  activeSpaceId: string
  habitCheckins: HabitCheckin[]
  metricCheckins: MetricCheckin[]
  toast: (m: string) => void
}

export default function OKRs({ objectives, roadmapItems, setObjectives, setRoadmapItems, actions, setActions, weekStart, links, logs, onAddLink, onDeleteLink, onAddLog, onDeleteLog, activeSpaceId, habitCheckins, metricCheckins, toast }: Props) {
  const [modal, setModal] = useState<'smart' | 'manual' | null>(null)
  const [editingKR, setEditingKR] = useState<RoadmapItem | null>(null)
  const [editingObjective, setEditingObjective] = useState<AnnualObjective | null>(null)
  
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack  = activeKRs.filter(i => i.health_status === 'on_track').length
  const offTrack = activeKRs.filter(i => i.health_status === 'off_track').length

  async function deleteKR(id: string) {
    try {
      const { error } = await supabase.from('roadmap_items').delete().eq('id', id)
      if (error) {
        console.error('Delete KR error:', error)
        toast('Failed to delete KR')
        return
      }
      
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
      const { error: krError } = await supabase.from('roadmap_items').delete().eq('annual_objective_id', id)
      if (krError) {
        console.error('Delete objective KRs error:', krError)
        toast('Failed to delete objective - could not remove key results')
        return
      }
      
      // Then delete the objective
      const { error: objError } = await supabase.from('annual_objectives').delete().eq('id', id)
      if (objError) {
        console.error('Delete objective error:', objError)
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>My OKRs</h1>
          <p style={{ fontSize: 12, color: 'var(--navy-300)' }}>What you're working on right now</p>
        </div>
        
        {/* Creation Buttons */}
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button 
            onClick={() => setModal('smart')} 
            className="btn-primary"
            style={{ fontSize: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M7 2L9 6h4l-3 3 1 4-4-2-4 2 1-4-3-3h4l2-4z" fill="currentColor"/>
            </svg>
            Smart Builder
          </button>
          
          <button 
            onClick={() => setModal('manual')} 
            className="btn"
            style={{ fontSize: 12, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            Manual
          </button>
        </div>
      </div>

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

      {/* KPI Dashboard */}
      {(activeKRs.filter(kr => kr.is_habit).length > 0 || activeKRs.filter(kr => (kr as any).metric_type).length > 0) && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', margin: '0 0 12px 0' }}>Key metrics (last 4 weeks)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {/* Habit KPIs */}
            {activeKRs
              .filter(kr => kr.is_habit)
              .map(kr => {
                const aggregate = calculateRollingAggregate(kr, habitCheckins, 4)
                let status = 'poor'
                if (aggregate.percent >= 80) status = 'good'
                else if (aggregate.percent >= 50) status = 'okay'
                
                return (
                  <div key={kr.id} style={{ 
                    background: 'var(--navy-800)', 
                    border: '1px solid var(--navy-600)', 
                    borderLeft: `3px solid ${status === 'good' ? 'var(--teal)' : status === 'okay' ? 'var(--accent)' : 'var(--red)'}`,
                    borderRadius: 8, 
                    padding: '14px 16px' 
                  }}>
                    <p style={{ fontSize: 12, color: 'var(--navy-400)', margin: '0 0 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {kr.title}
                    </p>
                    <p style={{ fontSize: 22, fontWeight: 500, color: 'var(--navy-50)', margin: '0 0 3px 0' }}>
                      {aggregate.percent}%
                    </p>
                    <div style={{ fontSize: 11, color: 'var(--navy-500)', margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{aggregate.sessions}/{aggregate.expected} sessions</span>
                    </div>
                  </div>
                )
              })}

            {/* Metric KPIs - Currently none since metric_type column doesn't exist yet */}
            {/* This section will show metric cards once you add metric_type to roadmap_items table */}
          </div>
        </div>
      )}

      {activeKRs.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          <div style={{ marginBottom: 16 }}><TargetIcon size={48} /></div>
          No active key results yet.<br />
          <span style={{ fontSize: 13 }}>Use Smart Builder or Manual creation above to get started.</span>
        </div>
      )}

      {objectives
        .filter(o => o.status !== 'abandoned')
        .map(obj => {
          const objKRs = activeKRs.filter(i => i.annual_objective_id === obj.id)
          return (
            <div key={obj.id} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--navy-200)' }}>
                  {obj.name}
                </h3>
                <button 
                  onClick={() => setEditingObjective(obj)}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'var(--navy-400)', 
                    cursor: 'pointer', 
                    fontSize: 14, 
                    padding: '4px 8px',
                    borderRadius: 4
                  }}
                  title="Edit objective"
                >
                  <EditIcon size={16} />
                </button>
              </div>

              <ObjectiveCard
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
                onEditKR={setEditingKR}
                toast={toast}
              />
            </div>
          )
        })}

      {/* Modals */}
      {modal === 'smart' && (
        <GuidedObjectiveBuilder
          objectives={objectives}
          activeSpaceId={activeSpaceId}
          onClose={() => setModal(null)}
          onSave={async (objective, keyResults) => {
            // Add objective to state
            setObjectives(prev => [...prev, objective])
            
            // Add key results to state (they're already created in DB by GuidedObjectiveBuilder)
            if (keyResults.length > 0) {
              const { data: createdKRs } = await supabase
                .from('roadmap_items')
                .select('*')
                .eq('annual_objective_id', objective.id)
              
              if (createdKRs) {
                setRoadmapItems(prev => [...prev, ...createdKRs])
              }
            }
            
            setModal(null)
            toast('Smart builder created your objective!')
          }}
        />
      )}

      {modal === 'manual' && (
        <ManualObjectiveBuilder
          objectives={objectives}
          activeSpaceId={activeSpaceId}
          onClose={() => setModal(null)}
          onSave={(objective) => {
            setObjectives(prev => [...prev, objective])
            setModal(null)
            toast('Objective created! Add key results on the Roadmap.')
          }}
        />
      )}

      {editingKR && (
        <EditKRModal
          kr={editingKR}
          onClose={() => setEditingKR(null)}
          onSave={async (updatedKR) => {
            try {
              const { error } = await supabase.from('roadmap_items').update(updatedKR).eq('id', editingKR.id)
              if (error) {
                console.error('Update KR error:', error)
                toast('Failed to update KR')
                return
              }
              
              setRoadmapItems(prev => prev.map(kr => kr.id === editingKR.id ? { ...kr, ...updatedKR } : kr))
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
              const { error } = await supabase.from('annual_objectives').update(updatedObjective).eq('id', editingObjective.id)
              if (error) {
                console.error('Update objective error:', error)
                toast('Failed to update objective')
                return
              }
              
              setObjectives(prev => prev.map(obj => obj.id === editingObjective.id ? { ...obj, ...updatedObjective } : obj))
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

// Simple manual objective creation
function ManualObjectiveBuilder({ objectives, activeSpaceId, onClose, onSave }: {
  objectives: AnnualObjective[]
  activeSpaceId: string
  onClose: () => void
  onSave: (objective: AnnualObjective) => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[objectives.length % COLORS.length])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    
    try {
      const { data } = await supabase.from('annual_objectives')
        .insert({ 
          name: name.trim(), 
          color, 
          sort_order: objectives.length, 
          status: 'active', 
          space_id: activeSpaceId 
        })
        .select()
        .single()
      
      if (data) onSave(data)
    } catch (error) {
      console.error('Failed to create objective:', error)
    }
    
    setSaving(false)
  }

  return (
    <Modal 
      title="New Objective" 
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary" 
            onClick={save} 
            disabled={saving || !name.trim()}
          >
            {saving ? 'Creating...' : 'Create Objective'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Objective</label>
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
      
      <div style={{
        background: 'var(--navy-700)',
        border: '1px solid var(--navy-600)',
        borderRadius: 8,
        padding: 12,
        fontSize: 12,
        color: 'var(--navy-400)',
        lineHeight: 1.4,
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start'
      }}>
        <LightbulbIcon size={16} />
        <div>
          <strong>Tip:</strong> After creating the objective, you can add key results on the Roadmap tab or use the Smart Builder for a complete setup.
        </div>
      </div>
    </Modal>
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
  const [status, setStatus] = useState(kr.status)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    
    try {
      const updatedKR = {
        title: title.trim(),
        health_status: healthStatus,
        status: status
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
          <option value="on_track">On Track</option>
          <option value="off_track">Off Track</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>

      <div className="field">
        <label>Status</label>
        <select 
          className="input" 
          value={status} 
          onChange={e => setStatus(e.target.value as any)}
        >
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>
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
