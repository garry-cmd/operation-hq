'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction } from '@/lib/types'
import { ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'
import PlanWeek from './PlanWeek'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  weekStart: string
  setWeekStart: (fn: (s: string) => string) => void
  toast: (m: string) => void
}

export default function Focus({ objectives, roadmapItems, actions, setActions, weekStart, setWeekStart, toast }: Props) {
  const [planning, setPlanning] = useState(false)
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const taskDone = weekActions.filter(a => a.completed).length
  const taskTotal = weekActions.length
  const taskPct = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0
  const allDone = taskTotal > 0 && taskDone === taskTotal
  const unplanned = activeKRs.filter(kr => !weekActions.some(a => a.roadmap_item_id === kr.id))

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    await supabase.from('weekly_actions').update({ completed: next }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: next } : a))
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

        {/* Week bar */}
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '13px 15px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: taskTotal > 0 ? 10 : 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-300)' }}>
              {taskTotal === 0 ? 'Nothing planned yet' : allDone ? '✓ All done!' : `${taskDone} of ${taskTotal} done`}
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
        {taskTotal === 0 && activeKRs.length > 0 && (
          <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, padding: '24px 20px', textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🗓</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 8 }}>Plan your week</div>
            <div style={{ fontSize: 13, color: 'var(--navy-400)', lineHeight: 1.6, marginBottom: 20 }}>
              Walk through each key result and decide what you're doing about it this week.
            </div>
            <button onClick={() => setPlanning(true)} className="btn-primary" style={{ width: '100%', fontSize: 14, marginBottom: 10 }}>
              Start planning →
            </button>
            <p style={{ fontSize: 12, color: 'var(--navy-500)' }}>Or use the <strong style={{ color: 'var(--accent)' }}>+</strong> to add actions manually</p>
          </div>
        )}

        {taskTotal === 0 && activeKRs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚡</div>
            Add key results on the Roadmap, then plan your actions here.
          </div>
        )}

        {/* Action cards */}
        {enriched.map(({ action, kr, obj }) => (
          <div key={action.id} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '13px 15px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 13, opacity: action.completed ? .55 : 1, transition: 'opacity .15s' }}>
            <button onClick={() => toggleAction(action)}
              style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, padding: 0, border: `2px solid ${action.completed ? 'var(--teal)' : 'var(--navy-400)'}`, background: action.completed ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .15s' }}>
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
          </div>
        ))}

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
