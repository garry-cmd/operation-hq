'use client'
import { useState, useRef, useEffect } from 'react'
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
  const taskTotal = weekActions.length
  const taskDone = weekActions.filter(a => a.completed).length
  const taskPct = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    await supabase.from('weekly_actions').update({ completed: next }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: next } : a))
  }

  async function addAction(krId: string, title: string) {
    if (!title.trim()) return
    const { data } = await supabase.from('weekly_actions')
      .insert({ quarterly_kr_id: krId, title, week_start: weekStart }).select().single()
    if (data) setActions(prev => [...prev, data])
  }

  async function carryForward() {
    const nextWeek = addWeeks(weekStart, 1)
    const incomplete = weekActions.filter(a => !a.completed)
    if (!incomplete.length) { toast('No incomplete actions to carry forward.'); return }
    const { data } = await supabase.from('weekly_actions')
      .insert(incomplete.map(a => ({ quarterly_kr_id: a.quarterly_kr_id, title: a.title, week_start: nextWeek, carried_over: true }))).select()
    if (data) { setActions(prev => [...prev, ...data]); toast(`${data.length} action${data.length > 1 ? 's' : ''} carried forward.`) }
  }

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Focus this week</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Actions driving your active KRs</p>

      {/* Week header */}
      <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-50)' }}>Week of {formatWeek(weekStart)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--navy-600)', border: '1px solid var(--navy-500)', color: 'var(--navy-200)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={() => setWeekStart(s => addWeeks(s, -1))}>‹</button>
            <button style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--navy-600)', border: '1px solid var(--navy-500)', color: 'var(--navy-200)', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              onClick={() => setWeekStart(s => addWeeks(s, 1))}>›</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--navy-600)', borderRadius: 3 }}>
            <div style={{ height: 6, borderRadius: 3, background: taskDone === taskTotal && taskTotal > 0 ? 'var(--teal)' : 'var(--accent)', width: `${taskPct}%`, transition: 'width .3s, background .3s' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-300)', flexShrink: 0, minWidth: 60, textAlign: 'right' }}>{taskDone}/{taskTotal} done</span>
        </div>
      </div>

      {activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>⚡</div>
          Add objectives on the Roadmap, then build your weekly actions here.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        const itemActions = weekActions.filter(a => itemKrs.some(k => k.id === a.quarterly_kr_id))
        const groupDone = itemActions.filter(a => a.completed).length

        return (
          <div key={item.id} style={{ background: 'var(--navy-700)', borderRadius: 16, marginBottom: 12, overflow: 'hidden', border: '1px solid var(--navy-600)', borderLeft: `4px solid ${obj?.color ?? 'var(--accent)'}` }}>
            {/* Group header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--navy-600)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Breadcrumb */}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {obj?.name}
                </div>
                {/* Objective title */}
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', lineHeight: 1.35 }}>
                  {item.title}
                </div>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: groupDone > 0 ? 'var(--teal-text)' : 'var(--navy-400)', flexShrink: 0, background: 'var(--navy-600)', padding: '3px 8px', borderRadius: 8 }}>
                {groupDone}/{itemActions.length}
              </span>
            </div>

            {/* Actions */}
            {itemActions.length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--navy-400)', fontStyle: 'italic' }}>
                No actions yet — add one below
              </div>
            )}

            {itemActions.map(action => {
              const kr = krs.find(k => k.id === action.quarterly_kr_id)
              return (
                <div key={action.id}
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 14, borderBottom: '1px solid var(--navy-600)', minHeight: 56 }}>
                  {/* Checkbox circle */}
                  <button onClick={() => toggleAction(action)}
                    style={{ width: 26, height: 26, borderRadius: '50%', border: `2px solid ${action.completed ? 'var(--teal)' : 'var(--navy-400)'}`, background: action.completed ? 'var(--teal)' : 'transparent', flexShrink: 0, marginTop: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s', padding: 0 }}>
                    {action.completed && (
                      <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                        <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: action.completed ? 'var(--navy-400)' : 'var(--navy-50)', textDecoration: action.completed ? 'line-through' : 'none', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {action.title}
                      {action.carried_over && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', flexShrink: 0 }}>carried</span>
                      )}
                    </div>
                    {kr && (
                      <div style={{ fontSize: 11, color: 'var(--navy-300)', marginTop: 3 }}>↑ {kr.title}</div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Add action button */}
            <InlineAddAction krs={itemKrs} onAdd={(krId, title) => addAction(krId, title)} />
          </div>
        )
      })}

      {activeItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, flexWrap: 'wrap', gap: 10 }}>
          <button onClick={carryForward} className="btn" style={{ fontSize: 13 }}>
            Carry incomplete to next week →
          </button>
          <span style={{ fontSize: 13, color: 'var(--navy-300)', fontWeight: 500 }}>{taskDone} of {taskTotal} done</span>
        </div>
      )}
    </div>
  )
}

function InlineAddAction({ krs, onAdd }: { krs: QuarterlyKR[]; onAdd: (krId: string, title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [krId, setKrId] = useState(krs[0]?.id ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  useEffect(() => { if (krs.length && !krId) setKrId(krs[0].id) }, [krs])

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !krId) return
    onAdd(krId, title)
    setTitle('')
    setOpen(false)
  }

  if (!open) return (
    <button className="add-row-btn" onClick={() => setOpen(true)}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
      Add action
    </button>
  )

  return (
    <form onSubmit={save} style={{ padding: '12px 14px', background: 'var(--navy-800)', borderTop: '1px solid var(--navy-600)' }}>
      <input ref={ref} value={title} onChange={e => setTitle(e.target.value)}
        placeholder="What do you need to do this week?"
        className="input" style={{ marginBottom: 8 }} />
      {krs.length > 1 && (
        <select value={krId} onChange={e => setKrId(e.target.value)} className="input" style={{ marginBottom: 10 }}>
          {krs.map(kr => <option key={kr.id} value={kr.id}>{kr.title}</option>)}
        </select>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn-primary" style={{ flex: 1 }}>Add action</button>
        <button type="button" className="btn" onClick={() => { setOpen(false); setTitle('') }}>Cancel</button>
      </div>
    </form>
  )
}
