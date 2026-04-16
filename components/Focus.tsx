'use client'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, WeeklyAction } from '@/lib/types'
import { ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  weekStart: string
  setWeekStart: (fn: (s: string) => string) => void
  toast: (m: string) => void
}

export default function Focus({ objectives, roadmapItems, krs, actions, setActions, weekStart, setWeekStart, toast }: Props) {
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned' && !i.is_parked)
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const taskDone = weekActions.filter(a => a.completed).length
  const taskTotal = weekActions.length
  const taskPct = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0
  const allDone = taskTotal > 0 && taskDone === taskTotal

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    await supabase.from('weekly_actions').update({ completed: next }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: next } : a))
  }

  async function carryForward() {
    const nextWeek = addWeeks(weekStart, 1)
    const incomplete = weekActions.filter(a => !a.completed)
    if (!incomplete.length) { toast('Nothing incomplete to carry forward.'); return }
    const { data } = await supabase.from('weekly_actions')
      .insert(incomplete.map(a => ({ quarterly_kr_id: a.quarterly_kr_id, title: a.title, week_start: nextWeek, carried_over: true }))).select()
    if (data) { setActions(prev => [...prev, ...data]); toast(`${data.length} action${data.length > 1 ? 's' : ''} carried forward.`) }
  }

  // Build flat list of actions with their objective context
  const enriched = weekActions.map(action => {
    const kr = krs.find(k => k.id === action.quarterly_kr_id)
    const item = activeItems.find(i => i.id === kr?.roadmap_item_id)
    const obj = objectives.find(o => o.id === item?.annual_objective_id)
    return { action, obj }
  })

  const navBtnStyle: React.CSSProperties = {
    width: 34, height: 34, borderRadius: '50%',
    background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
    color: 'var(--navy-300)', fontSize: 18, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 2 }}>Focus this week</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 16 }}>Week of {formatWeek(weekStart)}</p>

      {/* Week bar */}
      <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-300)' }}>
            {taskTotal === 0 ? 'No actions yet' : allDone ? '✓ All done!' : `${taskDone} of ${taskTotal} done`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={navBtnStyle} onClick={() => setWeekStart(s => addWeeks(s, -1))}>‹</button>
            <button style={navBtnStyle} onClick={() => setWeekStart(s => addWeeks(s, 1))}>›</button>
          </div>
        </div>
        <div style={{ height: 5, background: 'var(--navy-600)', borderRadius: 3 }}>
          <div style={{ height: 5, borderRadius: 3, background: allDone ? 'var(--teal)' : 'var(--accent)', width: `${taskPct}%`, transition: 'width .3s, background .3s' }} />
        </div>
      </div>

      {/* Empty state */}
      {taskTotal === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>⚡</div>
          Tap the <strong style={{ color: 'var(--accent)' }}>+</strong> button to add your first action for this week.
        </div>
      )}

      {/* Action cards — clean and flat */}
      {enriched.map(({ action, obj }) => (
        <div key={action.id}
          style={{
            background: 'var(--navy-800)',
            border: '1px solid var(--navy-600)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            opacity: action.completed ? .55 : 1,
            transition: 'opacity .15s',
          }}>

          {/* Circle checkbox — only tappable element */}
          <button
            onClick={() => toggleAction(action)}
            style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${action.completed ? 'var(--teal)' : 'var(--navy-400)'}`,
              background: action.completed ? 'var(--teal)' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'all .15s', padding: 0,
            }}>
            {action.completed && (
              <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                <path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 15, fontWeight: 500,
              color: action.completed ? 'var(--navy-400)' : 'var(--navy-50)',
              textDecoration: action.completed ? 'line-through' : 'none',
              lineHeight: 1.35, marginBottom: 4,
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            }}>
              {action.title}
              {action.carried_over && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', flexShrink: 0 }}>carried</span>
              )}
            </div>
            {obj && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--navy-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.name}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Carry forward */}
      {taskTotal > 0 && taskDone < taskTotal && (
        <div style={{ paddingTop: 8 }}>
          <button onClick={carryForward} className="btn" style={{ fontSize: 13, width: '100%', justifyContent: 'center' }}>
            Carry incomplete to next week →
          </button>
        </div>
      )}
    </div>
  )
}
