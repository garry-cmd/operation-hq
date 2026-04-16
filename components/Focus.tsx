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

  const navBtnStyle: React.CSSProperties = {
    width: 28, height: 28, borderRadius: '50%', background: 'var(--navy-700)',
    border: '1px solid var(--navy-500)', color: 'var(--navy-300)',
    fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  }

  return (
    <div>
      <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 4 }}>Focus this week</h1>
      <p style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 16 }}>Actions driving your active KRs</p>

      {/* Week header + task KPI */}
      <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy-50)' }}>Week of {formatWeek(weekStart)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={navBtnStyle} onClick={() => setWeekStart(s => addWeeks(s, -1))}>‹</button>
            <button style={navBtnStyle} onClick={() => setWeekStart(s => addWeeks(s, 1))}>›</button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 5, background: 'var(--navy-600)', borderRadius: 3 }}>
            <div style={{ height: 5, borderRadius: 3, background: taskDone === taskTotal && taskTotal > 0 ? 'var(--teal)' : 'var(--accent)', width: `${taskPct}%`, transition: 'width .3s, background .3s' }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--navy-400)', flexShrink: 0 }}>{taskDone}/{taskTotal} done</span>
        </div>
      </div>

      {activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--navy-500)', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
          Add objectives and KRs first, then build your weekly actions here.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        const itemActions = weekActions.filter(a => itemKrs.some(k => k.id === a.quarterly_kr_id))
        const groupDone = itemActions.filter(a => a.completed).length

        return (
          <div key={item.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj?.color ?? '#888', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: 'var(--navy-400)' }}>{obj?.name} ↑</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-50)' }}>{item.title}</div>
              </div>
              <span style={{ fontSize: 10, color: 'var(--navy-500)' }}>{groupDone}/{itemActions.length}</span>
            </div>

            {itemActions.map(action => {
              const kr = krs.find(k => k.id === action.quarterly_kr_id)
              return (
                <div key={action.id} style={{ padding: '8px 14px 8px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, borderBottom: '1px solid var(--navy-800)' }}>
                  <button onClick={() => toggleAction(action)}
                    style={{ width: 18, height: 18, borderRadius: '50%', border: `1.5px solid ${action.completed ? 'var(--teal)' : 'var(--navy-500)'}`, background: action.completed ? 'var(--teal)' : 'transparent', flexShrink: 0, marginTop: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .12s' }}>
                    {action.completed && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: action.completed ? 'var(--navy-500)' : 'var(--navy-50)', textDecoration: action.completed ? 'line-through' : 'none', lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {action.title}
                      {action.carried_over && <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', flexShrink: 0 }}>carried</span>}
                    </div>
                    {kr && <div style={{ fontSize: 10, color: 'var(--navy-500)', marginTop: 2 }}>↑ {kr.title}</div>}
                  </div>
                </div>
              )
            })}

            <InlineAddAction krs={itemKrs} onAdd={(krId, title) => addAction(krId, title)} />
          </div>
        )
      })}

      {activeItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
          <button onClick={carryForward}
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none', border: '1px solid var(--accent-dim)', borderRadius: 10, padding: '7px 16px', cursor: 'pointer' }}>
            Carry incomplete to next week →
          </button>
          <span style={{ fontSize: 11, color: 'var(--navy-500)' }}>{taskDone} of {taskTotal} done</span>
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
    <button style={{ width: '100%', padding: '8px 14px', fontSize: 12, color: 'var(--navy-500)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'var(--navy-500)')}
      onClick={() => setOpen(true)}>+ add action</button>
  )

  return (
    <form onSubmit={save} style={{ padding: '10px 14px', background: 'var(--navy-800)', borderTop: '1px solid var(--navy-600)' }}>
      <input ref={ref} value={title} onChange={e => setTitle(e.target.value)} placeholder="What do you need to do?"
        style={{ width: '100%', background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 7, outline: 'none' }} />
      <select value={krId} onChange={e => setKrId(e.target.value)}
        style={{ width: '100%', background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--navy-200)', fontFamily: 'inherit', marginBottom: 8 }}>
        {krs.map(kr => <option key={kr.id} value={kr.id}>{kr.title}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={{ fontSize: 13, fontWeight: 600, padding: '7px 16px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>Add</button>
        <button type="button" onClick={() => { setOpen(false); setTitle('') }}
          style={{ fontSize: 12, padding: '7px 14px', borderRadius: 8, background: 'transparent', color: 'var(--navy-400)', border: '1px solid var(--navy-600)', cursor: 'pointer' }}>Cancel</button>
      </div>
    </form>
  )
}
