'use client'
import { Fragment, useState } from 'react'
import * as actionsDb from '@/lib/db/actions'
import * as checkinsDb from '@/lib/db/checkins'
import { AnnualObjective, RoadmapItem, WeeklyAction, ActionTag, ObjectiveLog, HabitCheckin } from '@/lib/types'
import { ACTIVE_Q, addWeeks, formatWeek, parseDateLocal } from '@/lib/utils'
import { calculateHabitProgress, getToday, formatDate } from '@/lib/habitUtils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'

// SVG Icons
const LightningIcon = ({ size = 48, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Per-tag color treatment. Single source of truth — used both by the inline
// pill on action rows and by the picker in EditActionModal so they always
// agree visually. Color choices are deliberately distinct from `carried`
// (which uses --amber-*) so the four states read at a glance.
const TAG_STYLE: Record<ActionTag, { bg: string; color: string; label: string }> = {
  backlog: { bg: 'var(--navy-600)', color: 'var(--navy-200)', label: 'backlog' },
  waiting: { bg: 'var(--indigo-bg)', color: 'var(--indigo-text)', label: 'waiting' },
  doing:   { bg: 'var(--teal-bg)',   color: 'var(--teal-text)',   label: 'doing' },
}


import PlanWeek from './PlanWeek'
import Modal from './Modal'
import ActionPanel from './ActionPanel'

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
  onRequestCloseWeek: (week: string) => void
  // ActionPanel-related props (commit 4a). Logs are scoped to the active
  // space upstream; openActionId is lifted to page level so <main> can
  // widen when the panel is open.
  logs: ObjectiveLog[]
  setLogs: (fn: (p: ObjectiveLog[]) => ObjectiveLog[]) => void
  openActionId: string | null
  setOpenActionId: (id: string | null) => void
}

export default function Focus({
  objectives, roadmapItems, actions, setActions,
  habitCheckins, setHabitCheckins,
  weekStart, setWeekStart, toast, onRequestCloseWeek,
  logs, setLogs, openActionId, setOpenActionId,
}: Props) {
  const [planning, setPlanning] = useState(false)
  const [editAction, setEditAction] = useState<WeeklyAction | null>(null)
  const activeKRs = getCurrentQuarterKRs(roadmapItems, ACTIVE_Q)
  const habitKRs = activeKRs.filter(kr => kr.is_habit)
  const today = getToday()

  // Resolve which action's panel is open (if any), plus its parent KR and
  // objective. The panel is only rendered if all three resolve — defensive
  // against orphans (deleted KR or objective with stale openActionId).
  const openAction = openActionId ? actions.find(a => a.id === openActionId) ?? null : null
  const openKR = openAction ? roadmapItems.find(k => k.id === openAction.roadmap_item_id) ?? null : null
  const openObj = openKR?.annual_objective_id ? objectives.find(o => o.id === openKR.annual_objective_id) ?? null : null
  const panelOpen = !!(openAction && openKR && openObj)
  
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const taskDone = weekActions.filter(a => a.completed).length
  const taskTotal = weekActions.length
  const taskPct = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0
  const allDone = taskTotal > 0 && taskDone === taskTotal

  // Habit progress calculations - only show weekly/daily habits in Focus
  const habitProgress = habitKRs.map(kr => {
    const krCheckins = habitCheckins.filter(c => c.roadmap_item_id === kr.id)
    const progress = calculateHabitProgress(kr, krCheckins, weekStart)
    return { kr, progress }
  }).filter(h => h.progress.showInFocus) // Only show daily/weekly habits

  async function addHabitSession(krId: string) {
    console.log('Adding habit session for KR:', krId, 'date:', today)

    try {
      const created = await checkinsDb.habit.create(krId, today)
      console.log('Session created:', created)
      setHabitCheckins(prev => [...prev, created])
      toast('Session logged!')
    } catch (err) {
      console.error('addHabitSession error:', err)
    }
  }

  async function addHabitSessionForDate(krId: string, date: string) {
    console.log('Adding habit session for KR:', krId, 'date:', date)

    try {
      const created = await checkinsDb.habit.create(krId, date)
      console.log('Session created:', created)
      setHabitCheckins(prev => [...prev, created])
      toast('Session logged!')
    } catch (err) {
      console.error('addHabitSessionForDate error:', err)
      // Most common failure here is the unique (krId, date) constraint —
      // surface the helpful hint to the user.
      toast('Could not log session - may already exist for this date')
    }
  }

  async function removeHabitSession(checkinId: string) {
    console.log('Removing habit session:', checkinId)

    try {
      await checkinsDb.habit.remove(checkinId)
      setHabitCheckins(prev => prev.filter(c => c.id !== checkinId))
      toast('Session removed')
    } catch (err) {
      console.error('removeHabitSession error:', err)
    }
  }

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    try {
      const updated = await actionsDb.update(action.id, { completed: next })
      setActions(prev => prev.map(a => a.id === action.id ? updated : a))
    } catch (err) {
      console.error('toggleAction failed:', err)
    }
  }

  async function saveEdit(action: WeeklyAction, title: string, isRecurring: boolean) {
    try {
      const updated = await actionsDb.update(action.id, { title, is_recurring: isRecurring })
      setActions(prev => prev.map(a => a.id === action.id ? updated : a))
      setEditAction(null)
      toast('Action updated.')
    } catch (err) {
      console.error('saveEdit failed:', err)
    }
  }

  async function deleteAction(id: string) {
    try {
      await actionsDb.remove(id)
      setActions(prev => prev.filter(a => a.id !== id))
      setEditAction(null)
      toast('Action deleted.')
    } catch (err) {
      console.error('deleteAction failed:', err)
    }
  }

  // Navigation is purely for browsing weeks. Carry-forward and recurring
  // re-spawn happen only via the explicit "Close week" flow below.
  function goToWeek(dir: number) {
    setWeekStart(s => addWeeks(s, dir))
  }

  // --- Close Week ---------------------------------------------------------
  // The Close Week button now opens CloseWeekWizard (a 2-step ceremony that
  // covers reflect → plan in one sitting). The actual carry/recur logic lives
  // inside the wizard; Focus just launches it.

  // Group week's actions two levels deep: objective → KR → actions.
  // Each objective entry carries its KR groups; orphan actions (whose KR or
  // objective is missing) bucket into header-less groups at the end.
  // Shouldn't trigger with FK constraints; defensive.
  type KRGroup = {
    kr: RoadmapItem | null
    actions: WeeklyAction[]
  }
  type ObjectiveGroup = {
    obj: AnnualObjective | null
    krGroups: KRGroup[]
  }
  const objectiveGroups: ObjectiveGroup[] = (() => {
    const byObj = new Map<string, { obj: AnnualObjective | null; byKr: Map<string, KRGroup> }>()
    for (const action of weekActions) {
      const kr = roadmapItems.find(i => i.id === action.roadmap_item_id) ?? null
      const obj = kr ? (objectives.find(o => o.id === kr.annual_objective_id) ?? null) : null
      const objKey = obj?.id ?? '__orphan_obj'
      const krKey = kr?.id ?? '__orphan_kr'
      let oEntry = byObj.get(objKey)
      if (!oEntry) {
        oEntry = { obj, byKr: new Map() }
        byObj.set(objKey, oEntry)
      }
      let kEntry = oEntry.byKr.get(krKey)
      if (!kEntry) {
        kEntry = { kr, actions: [] }
        oEntry.byKr.set(krKey, kEntry)
      }
      kEntry.actions.push(action)
    }
    return Array.from(byObj.values())
      .map(({ obj, byKr }) => ({
        obj,
        krGroups: Array.from(byKr.values()).sort((a, b) => {
          if (!a.kr) return 1
          if (!b.kr) return -1
          return a.kr.sort_order - b.kr.sort_order
        }),
      }))
      .sort((a, b) => {
        if (!a.obj) return 1
        if (!b.obj) return -1
        return a.obj.sort_order - b.obj.sort_order
      })
  })()

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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 2 }}>Focus this week</h1>
            <p style={{ fontSize: 12, color: 'var(--navy-400)', margin: 0 }}>Week of {formatWeek(weekStart)}</p>
          </div>
          <button onClick={() => onRequestCloseWeek(weekStart)}
            title="Close this week — reflect, then plan the next one"
            style={{ padding: '10px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
            Close week →
          </button>
        </div>

        {/* Habits Section — unified grid: one row of day labels at top,
            then each habit on a single row [title | 7 bubbles]. Replaces the
            previous per-habit stacked layout (title above its own day-label
            row above bubbles), which was ~3x taller for the same info. */}
        {habitProgress.length > 0 && (
          <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '12px 16px', marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: 1 }}>Habits</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr repeat(7, 28px)', columnGap: 8, rowGap: 6, alignItems: 'center' }}>
              {/* Day-label header row. The first cell is a spacer aligning with
                  the habit-title column underneath. */}
              <div></div>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayLabel, dayIndex) => {
                const date = parseDateLocal(weekStart)
                date.setDate(date.getDate() + dayIndex)
                const dateStr = formatDate(date)
                const isToday = dateStr === today
                return (
                  <div key={dayLabel} style={{
                    fontSize: 9,
                    textAlign: 'center',
                    color: isToday ? 'var(--accent)' : 'var(--navy-400)',
                    fontWeight: isToday ? 700 : 500,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}>
                    {dayLabel}
                  </div>
                )
              })}

              {/* One row per habit: title left, then 7 day bubbles aligned to
                  the columns above. */}
              {habitProgress.map(({ kr, progress }) => (
                <Fragment key={kr.id}>
                  <div style={{ fontSize: 13, color: 'var(--navy-50)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                    {kr.title}
                  </div>
                  {[0, 1, 2, 3, 4, 5, 6].map(dayIndex => {
                    // Same date math as before — parse weekStart locally to
                    // avoid the negative-UTC off-by-one that bit us in the
                    // earlier session.
                    const date = parseDateLocal(weekStart)
                    date.setDate(date.getDate() + dayIndex)
                    const dateStr = formatDate(date)
                    const todayDate = parseDateLocal(today)
                    const hasSession = progress.completedSessions.some(session => session.date === dateStr)
                    const isToday = dateStr === today
                    const isFutureDay = date > todayDate

                    return (
                      <div key={dayIndex} style={{ display: 'flex', justifyContent: 'center' }}>
                        <button
                          onClick={() => {
                            if (hasSession) {
                              const sessionToRemove = progress.completedSessions.find(s => s.date === dateStr)
                              if (sessionToRemove) removeHabitSession(sessionToRemove.id)
                            } else {
                              addHabitSessionForDate(kr.id, dateStr)
                            }
                          }}
                          disabled={isFutureDay}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: hasSession ? 'var(--teal)' : 'transparent',
                            border: `2px solid ${hasSession ? 'var(--teal)' : isToday ? 'var(--accent)' : 'var(--navy-500)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: isFutureDay ? 'not-allowed' : 'pointer',
                            transition: 'all 0.15s',
                            opacity: isFutureDay ? 0.3 : 1,
                            flexShrink: 0,
                            padding: 0,
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
                </Fragment>
              ))}
            </div>
          </div>
        )}

        <div style={panelOpen ? { display: 'flex', gap: 24, alignItems: 'flex-start' } : undefined}>
          <div style={panelOpen ? { flex: 1, maxWidth: 800, minWidth: 0 } : undefined}>

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
            <div style={{ marginBottom: 16 }}><LightningIcon size={48} /></div>
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
        
        {objectiveGroups.map(objGroup => {
          const objKey = objGroup.obj?.id ?? '__orphan_obj'
          return (
            <div key={objKey} style={{ marginBottom: 18 }}>
              {objGroup.obj && (
                <div style={{ padding: '4px 2px 10px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--navy-600)', marginBottom: 12 }}>
                  <div style={{ width: 4, height: 16, background: objGroup.obj.color, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--navy-50)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{objGroup.obj.name}</div>
                </div>
              )}
              {objGroup.krGroups.map(krGroup => {
                const krKey = krGroup.kr?.id ?? '__orphan_kr'
                const groupDone = krGroup.actions.filter(a => a.completed).length
                const groupTotal = krGroup.actions.length
                return (
                  <div key={krKey} style={{ marginBottom: 14 }}>
                    {krGroup.kr && (
                      <div style={{ padding: '0 4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--navy-200)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{krGroup.kr.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--navy-400)', fontWeight: 500, flexShrink: 0 }}>{groupDone}/{groupTotal}</div>
                      </div>
                    )}
                    {krGroup.actions.map(action => (
                      <div key={action.id} style={{ background: 'var(--navy-800)', border: `1px solid ${openActionId === action.id ? 'var(--accent)' : 'var(--navy-600)'}`, borderRadius: 14, padding: '13px 15px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 13, opacity: action.completed ? .55 : 1, transition: 'opacity .15s, border-color .12s' }}>
                        <button onClick={() => toggleAction(action)}
                          style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, padding: 0, border: `2px solid ${action.completed ? 'var(--teal)' : 'var(--navy-400)'}`, background: action.completed ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s' }}>
                          {action.completed && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                        <div onClick={() => setOpenActionId(openActionId === action.id ? null : action.id)}
                          style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 500, color: action.completed ? 'var(--navy-400)' : 'var(--navy-50)', textDecoration: action.completed ? 'line-through' : 'none', lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}>
                          {action.title}
                          {action.tag && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: TAG_STYLE[action.tag].bg, color: TAG_STYLE[action.tag].color, flexShrink: 0 }}>{TAG_STYLE[action.tag].label}</span>}
                          {action.carried_over && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', flexShrink: 0 }}>carried</span>}
                          {action.is_recurring && <span title="Repeats weekly" style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--accent-dim)', color: 'var(--accent)', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>↻ weekly</span>}
                        </div>
                        <button onClick={() => setEditAction(action)}
                          style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="var(--navy-300)" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )
        })}

          </div>
          {panelOpen && (
            <div style={{ flex: '0 0 420px', minWidth: 0 }}>
              <ActionPanel
                action={openAction!}
                parentKR={openKR!}
                parentObjective={openObj!}
                logs={logs}
                setActions={setActions}
                setLogs={setLogs}
                onClose={() => setOpenActionId(null)}
                toast={toast}
              />
            </div>
          )}
        </div>

        {/* Edit action modal */}
        {editAction && (
          <EditActionModal
            action={editAction}
            onClose={() => setEditAction(null)}
            onSave={(title, isRecurring) => saveEdit(editAction, title, isRecurring)}
            onDelete={() => deleteAction(editAction.id)}
          />
        )}

      </div>
    </>
  )
}

function EditActionModal({ action, onClose, onSave, onDelete }: {
  action: WeeklyAction
  onClose: () => void
  onSave: (title: string, isRecurring: boolean) => void
  onDelete: () => void
}) {
  const [title, setTitle] = useState(action.title)
  const [isRecurring, setIsRecurring] = useState(action.is_recurring)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    await onSave(title.trim(), isRecurring)
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
      <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
        onClick={() => setIsRecurring(v => !v)}>
        <button type="button" onClick={e => { e.stopPropagation(); setIsRecurring(v => !v) }}
          style={{
            width: 36, height: 20, borderRadius: 10, padding: 2, border: 'none',
            background: isRecurring ? 'var(--accent)' : 'var(--navy-600)',
            display: 'flex', alignItems: 'center', cursor: 'pointer',
            transition: 'background .15s', flexShrink: 0,
          }}>
          <div style={{
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            transform: isRecurring ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform .15s',
          }} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-50)' }}>Repeats weekly</div>
          <div style={{ fontSize: 11, color: 'var(--navy-400)', lineHeight: 1.4, marginTop: 2 }}>
            Re-spawns fresh every time you close the week, regardless of whether it was completed.
          </div>
        </div>
      </div>
    </Modal>
  )
}
