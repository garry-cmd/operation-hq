'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction, HabitCheckin } from '@/lib/types'
import { ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'
import { calculateHabitProgress, getToday, formatDate } from '@/lib/habitUtils'
import PlanWeek from './PlanWeek'
import Modal from './Modal'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  habitCheckins: HabitCheckin[]
  setHabitCheckins: (fn: (h: HabitCheckin[]) => HabitCheckin[]) => void
  weekStart: string
  setWeekStart: (fn: (s: string) => string) => void
  toast: (m: string) => void
}

export default function Focus({ objectives, roadmapItems, actions, setActions, habitCheckins, setHabitCheckins, weekStart, setWeekStart, toast }: Props) {
  const [planning, setPlanning] = useState(false)
  const [editAction, setEditAction] = useState<WeeklyAction | null>(null)
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const habitKRs = activeKRs.filter(kr => kr.is_habit)
  const today = getToday()
  
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const taskDone = weekActions.filter(a => a.completed).length
  const taskTotal = weekActions.length
  const taskPct = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0
  const allDone = taskTotal > 0 && taskDone === taskTotal
  const unplanned = activeKRs.filter(kr =>
    !kr.is_habit && // Exclude habits from unplanned section
    !weekActions.some(a => a.roadmap_item_id === kr.id) &&
    (kr.health_status === 'on_track' || kr.health_status === 'off_track' || kr.health_status === 'blocked')
  )

  // Habit progress calculations - only show weekly/daily habits in Focus
  const habitProgress = habitKRs.map(kr => {
    const krCheckins = habitCheckins.filter(c => c.roadmap_item_id === kr.id)
    const progress = calculateHabitProgress(kr, krCheckins, weekStart)
    return {
      kr,
      progress
    }
  }).filter(h => h.progress.showInFocus) // Only show daily/weekly habits

  const habitsCompleteCount = habitProgress.filter(h => h.progress.status === 'on_track' || h.progress.status === 'ahead').length

  async function addHabitSession(krId: string) {
    console.log('Adding habit session for KR:', krId, 'date:', today)
    
    try {
      const { data, error } = await supabase
        .from('habit_checkins')
        .insert({ roadmap_item_id: krId, date: today })
        .select()
        .single()
      
      if (error) {
        console.error('Insert error:', error)
        return
      }
      
      if (data) {
        console.log('Session created:', data)
        setHabitCheckins(prev => [...prev, data])
        toast('Session logged!')
      }
    } catch (err) {
      console.error('addHabitSession error:', err)
    }
  }

  async function addHabitSessionForDate(krId: string, date: string) {
    console.log('Adding habit session for KR:', krId, 'date:', date)
    
    try {
      const { data, error } = await supabase
        .from('habit_checkins')
        .insert({ roadmap_item_id: krId, date })
        .select()
        .single()
      
      if (error) {
        console.error('Insert error:', error)
        toast('Could not log session - may already exist for this date')
        return
      }
      
      if (data) {
        console.log('Session created:', data)
        setHabitCheckins(prev => [...prev, data])
        toast('Session logged!')
      }
    } catch (err) {
      console.error('addHabitSessionForDate error:', err)
      toast('Error logging session')
    }
  }

  async function removeHabitSession(checkinId: string) {
    console.log('Removing habit session:', checkinId)
    
    try {
      const { error } = await supabase.from('habit_checkins').delete().eq('id', checkinId)
      if (error) {
        console.error('Delete error:', error)
        return
      }
      setHabitCheckins(prev => prev.filter(c => c.id !== checkinId))
      toast('Session removed')
    } catch (err) {
      console.error('removeHabitSession error:', err)
    }
  }

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    await supabase.from('weekly_actions').update({ completed: next }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: next } : a))
  }

  async function saveEdit(action: WeeklyAction, title: string) {
    await supabase.from('weekly_actions').update({ title }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, title } : a))
    setEditAction(null)
    toast('Action updated.')
  }

  async function deleteAction(id: string) {
    await supabase.from('weekly_actions').delete().eq('id', id)
    setActions(prev => prev.filter(a => a.id !== id))
    setEditAction(null)
    toast('Action deleted.')
  }

  async function goToWeek(dir: number) {
    const target = addWeeks(weekStart, dir)
    if (dir > 0) {
      // Auto-carry incomplete actions to an empty week
      const targetEmpty = !actions.some(a => a.week_start === target)
      if (targetEmpty) {
        const incomplete = actions.filter(a => a.week_start === weekStart && !a.completed)
        if (incomplete.length > 0) {
          const { data } = await supabase.from('weekly_actions')
            .insert(incomplete.map(a => ({ roadmap_item_id: a.roadmap_item_id, title: a.title, week_start: target, carried_over: true })))
            .select()
          if (data) {
            setActions(prev => [...prev, ...data])
            toast(`${data.length} incomplete action${data.length > 1 ? 's' : ''} carried forward`)
          }
        }
      }
    }
    setWeekStart(() => target)
  }

  const enriched = weekActions.map(action => {
    const kr = roadmapItems.find(i => i.id === action.roadmap_item_id)
    const obj = objectives.find(o => o.id === kr?.annual_objective_id)
    return { action, kr, obj }
  })

  const navBtn: React.CSSProperties = {
    width: 34, height: 34, borderRadius: '50%', background: 'var(--navy-700)',
    border: '1px solid var(--navy-500)', color: 'var(--navy-300)',
    fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      
      {planning && (
        <PlanWeek
          objectives={objectives}
          roadmapItems={roadmapItems}
          weekStart={weekStart}
          onClose={() => setPlanning(false)}
          onAddAction={action => setActions(prev => [...prev, action])}
        />
      )}

      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 2 }}>Focus this week</h1>
        <p style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 16 }}>Week of {formatWeek(weekStart)}</p>

        {/* Habits Section */}
        {habitProgress.length > 0 && (
          <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--navy-200)' }}>Today's Habits</h3>
              <div style={{ fontSize: 12, color: 'var(--navy-400)' }}>
                {habitsCompleteCount}/{habitProgress.length} on track
              </div>
            </div>
            
            {/* Habit list with bubbles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {habitProgress.map(({ kr, progress }) => (
                <div key={kr.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Habit title and status */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 14, color: 'var(--navy-50)', fontWeight: 500 }}>
                      {kr.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                      {progress.displayText}
                    </div>
                  </div>
                  
                  {/* Progress bubbles */}
                  {/* Weekly daily bubbles */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Days of the week */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel, dayIndex) => {
                        const date = new Date(weekStart)
                        date.setDate(date.getDate() + dayIndex)
                        const dateStr = date.toISOString().split('T')[0]
                        
                        // Check if there's a session for this day
                        const hasSession = progress.completedSessions.some(session => session.date === dateStr)
                        const isToday = dateStr === today
                        const isPastDay = date < new Date(today)
                        const isFutureDay = date > new Date(today)
                        
                        return (
                          <div key={dayIndex} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 }}>
                            {/* Day label */}
                            <div style={{ 
                              fontSize: 9, 
                              color: isToday ? 'var(--accent)' : 'var(--navy-400)', 
                              fontWeight: isToday ? 600 : 400,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>
                              {dayLabel}
                            </div>
                            
                            {/* Day bubble */}
                            <button
                              onClick={() => {
                                console.log(`Clicked ${dayLabel} (${dateStr}) for ${kr.title}`)
                                if (hasSession) {
                                  // Remove session for this day
                                  const sessionToRemove = progress.completedSessions.find(s => s.date === dateStr)
                                  if (sessionToRemove) {
                                    console.log('Removing session:', sessionToRemove.id)
                                    removeHabitSession(sessionToRemove.id)
                                  }
                                } else {
                                  // Add session for this day
                                  console.log('Adding session for date:', dateStr)
                                  addHabitSessionForDate(kr.id, dateStr)
                                }
                              }}
                              disabled={isFutureDay}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: '50%', // BUBBLE!
                                background: hasSession ? 'var(--teal)' : 'transparent',
                                border: `2px solid ${hasSession ? 'var(--teal)' : isToday ? 'var(--accent)' : 'var(--navy-500)'}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: isFutureDay ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s',
                                opacity: isFutureDay ? 0.3 : 1,
                                flexShrink: 0
                              }}
                            >
                              {hasSession && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                                  <path d="m9 12 2 2 4-4" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Week bar for actions */}
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '13px 15px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: taskTotal > 0 ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-300)' }}>
              {taskTotal === 0 ? 'No actions planned yet' : allDone ? '✓ All actions done!' : `${taskDone} of ${taskTotal} actions done`}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {taskTotal > 0 && (
                <button onClick={() => setPlanning(true)}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent-dim)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}>
                  Re-plan
                </button>
              )}
              <button style={navBtn} onClick={() => goToWeek(-1)}>‹</button>
              <button style={navBtn} onClick={() => goToWeek(1)}>›</button>
            </div>
          </div>
          {taskTotal > 0 && (
            <div style={{ height: 5, background: 'var(--navy-600)', borderRadius: 3 }}>
              <div style={{ height: 5, borderRadius: 3, background: allDone ? 'var(--teal)' : 'var(--accent)', width: `${taskPct}%`, transition: 'width .3s, background .3s' }} />
            </div>
          )}
        </div>

        {/* Empty — plan prompt */}
        {taskTotal === 0 && activeKRs.filter(kr => !kr.is_habit).length > 0 && (
          <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, padding: '24px 20px', textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🗓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 8 }}>Plan your week</div>
            <div style={{ fontSize: 13, color: 'var(--navy-400)', lineHeight: 1.6, marginBottom: 20 }}>
              Walk through each key result and decide what actions you're taking this week.
            </div>
            <button onClick={() => setPlanning(true)} className="btn-primary" style={{ width: '100%', fontSize: 14, marginBottom: 10 }}>
              Start planning →
            </button>
            <p style={{ fontSize: 12, color: 'var(--navy-500)' }}>Or use the <strong style={{ color: 'var(--accent)' }}>+</strong> to add actions manually</p>
          </div>
        )}

        {taskTotal === 0 && activeKRs.filter(kr => !kr.is_habit).length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚡</div>
            Add key results on the Roadmap, then plan your actions here.
          </div>
        )}

        {/* Action cards */}
        {taskTotal > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--navy-200)' }}>This Week's Actions</h3>
              <div style={{ fontSize: 12, color: 'var(--navy-400)' }}>
                {taskDone}/{taskTotal} complete
              </div>
            </div>
          </div>
        )}
        
        {enriched.map(({ action, kr, obj }) => (
          <div key={action.id} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '13px 15px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 13, opacity: action.completed ? .55 : 1, transition: 'opacity .15s' }}>
            <button onClick={() => toggleAction(action)}
              style={{ width: 26, height: 26, borderRadius: '6px', flexShrink: 0, padding: 0, border: `2px solid ${action.completed ? 'var(--teal)' : 'var(--navy-400)'}`, background: action.completed ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s' }}>
              {action.completed && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: action.completed ? 'var(--navy-400)' : 'var(--navy-50)', textDecoration: action.completed ? 'line-through' : 'none', lineHeight: 1.35, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {action.title}
                {action.carried_over && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', flexShrink: 0 }}>carried</span>}
              </div>
              {obj && kr && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--navy-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kr.title}</span>
                </div>
              )}
            </div>
            <button onClick={() => setEditAction(action)}
              style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="var(--navy-300)" strokeWidth="1.3" strokeLinejoin="round"/></svg>
            </button>
          </div>
        ))}

        {/* Edit action modal */}
        {editAction && (
          <EditActionModal
            action={editAction}
            onClose={() => setEditAction(null)}
            onSave={title => saveEdit(editAction, title)}
            onDelete={() => deleteAction(editAction.id)}
          />
        )}

        {/* Fallback: unplanned KRs */}
        {taskTotal > 0 && unplanned.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                {unplanned.length} key result{unplanned.length > 1 ? 's' : ''} with nothing planned
              </span>
            </div>
            {unplanned.map(kr => {
              const obj = objectives.find(o => o.id === kr.annual_objective_id)
              return (
                <UnplannedRow key={kr.id} kr={kr} objective={obj}
                  onAdd={async (title) => {
                    const { data } = await supabase.from('weekly_actions')
                      .insert({ roadmap_item_id: kr.id, title, week_start: weekStart }).select().single()
                    if (data) setActions(prev => [...prev, data])
                  }} />
              )
            })}
          </div>
        )}

      </div>
    </>
  )
}

function UnplannedRow({ kr, objective, onAdd }: { kr: RoadmapItem; objective?: AnnualObjective; onAdd: (t: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) ref.current?.focus() }, [open])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim() || saving) return
    setSaving(true)
    await onAdd(value.trim())
    setValue(''); setOpen(false); setSaving(false)
  }

  return (
    <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, marginBottom: 7, overflow: 'hidden' }}>
      <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {objective && <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 2 }}>{objective.name}</div>}
          <div style={{ fontSize: 13, color: 'var(--navy-200)', lineHeight: 1.35 }}>{kr.title}</div>
        </div>
        <button onClick={() => setOpen(o => !o)}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-dim)', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', flexShrink: 0 }}>
          {open ? 'Cancel' : '+ add action'}
        </button>
      </div>
      {open && (
        <form onSubmit={save} style={{ padding: '0 14px 12px', borderTop: '1px solid var(--navy-600)' }}>
          <input ref={ref} value={value} onChange={e => setValue(e.target.value)} placeholder="What are you doing about this?"
            className="input" style={{ marginTop: 10, marginBottom: 8, fontSize: 13 }} />
          <button type="submit" className="btn-primary" disabled={!value.trim() || saving} style={{ width: '100%', fontSize: 13 }}>
            {saving ? 'Adding…' : 'Add action'}
          </button>
        </form>
      )}
    </div>
  )
}

function EditActionModal({ action, onClose, onSave, onDelete }: {
  action: WeeklyAction
  onClose: () => void
  onSave: (title: string) => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(action.title)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    await onSave(title.trim())
    setSaving(false)
  }

  return (
    <Modal title="Edit Action" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onDelete}
          style={{ color: 'var(--red-text)', background: 'var(--red-bg)', border: 'none' }}>
          Delete
        </button>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </>}>
      <div className="field">
        <label>Action</label>
        <textarea className="input" rows={3} value={title}
          onChange={e => setTitle(e.target.value)} autoFocus />
      </div>
    </Modal>
  )
}
