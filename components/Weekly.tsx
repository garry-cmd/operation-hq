'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, WeeklyAction } from '@/lib/types'
import { ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'
import StatusPill from './StatusPill'

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

export default function Weekly({ objectives, roadmapItems, krs, actions, setActions, weekStart, setWeekStart, toast }: Props) {
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned')
  const weekActions = actions.filter(a => a.week_start === weekStart)

  const onTrack = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id) && k.status === 'on_track').length
  const offTrack = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id) && k.status === 'off_track').length

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    await supabase.from('weekly_actions').update({ completed: next }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: next } : a))
  }

  async function deleteAction(id: string) {
    await supabase.from('weekly_actions').delete().eq('id', id)
    setActions(prev => prev.filter(a => a.id !== id))
  }

  async function addAction(krId: string, title: string) {
    if (!title.trim()) return
    const { data } = await supabase.from('weekly_actions')
      .insert({ quarterly_kr_id: krId, title, week_start: weekStart })
      .select().single()
    if (data) setActions(prev => [...prev, data])
  }

  async function carryForward() {
    const nextWeek = addWeeks(weekStart, 1)
    const incomplete = weekActions.filter(a => !a.completed)
    if (!incomplete.length) { toast('No incomplete actions to carry forward.'); return }
    const { data } = await supabase.from('weekly_actions')
      .insert(incomplete.map(a => ({ quarterly_kr_id: a.quarterly_kr_id, title: a.title, week_start: nextWeek, carried_over: true })))
      .select()
    if (data) { setActions(prev => [...prev, ...data]); toast(`${data.length} action${data.length > 1 ? 's' : ''} carried to next week.`) }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button className="w-7 h-7 rounded-full border border-gray-200 bg-white text-gray-500 text-base flex items-center justify-center hover:bg-gray-50"
          onClick={() => setWeekStart(s => addWeeks(s, -1))}>‹</button>
        <h1 className="text-base font-semibold text-gray-900">Week of {formatWeek(weekStart)}</h1>
        <button className="w-7 h-7 rounded-full border border-gray-200 bg-white text-gray-500 text-base flex items-center justify-center hover:bg-gray-50"
          onClick={() => setWeekStart(s => addWeeks(s, 1))}>›</button>
        <div className="flex gap-1.5 ml-2">
          {onTrack > 0 && <span className="pill-green text-[10px] px-2 py-0.5 rounded-full font-medium">{onTrack} on track</span>}
          {offTrack > 0 && <span className="pill-red text-[10px] px-2 py-0.5 rounded-full font-medium">{offTrack} off track</span>}
        </div>
        <button className="ml-auto text-xs border border-gray-200 bg-white px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-600"
          onClick={carryForward}>Carry forward incomplete</button>
      </div>

      {activeItems.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          <div className="text-3xl mb-2">📋</div>
          No active objectives. Add milestones on the Roadmap tab.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        return itemKrs.map(kr => {
          const krActions = weekActions.filter(a => a.quarterly_kr_id === kr.id)
          return (
            <div key={kr.id} className="bg-white rounded-xl border border-gray-200 mb-3 overflow-hidden">
              <div className="px-4 py-2.5 flex items-start gap-2.5 border-b border-gray-100">
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: obj?.color ?? '#888' }} />
                <div className="flex-1">
                  <div className="text-[10px] text-gray-400">{obj?.name} ↑</div>
                  <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                </div>
                <StatusPill status={kr.status} />
              </div>
              <div className="px-4 pt-2 pb-1 border-b border-gray-50">
                <div className="text-[10px] text-gray-400 mb-0.5">Key result</div>
                <div className="text-xs font-medium text-gray-800">{kr.title}</div>
              </div>
              {krActions.map(action => (
                <div key={action.id} className="px-4 py-1.5 pl-9 flex items-center gap-2 group">
                  <button
                    onClick={() => toggleAction(action)}
                    className={`w-3.5 h-3.5 rounded-full border-[1.5px] shrink-0 -ml-5 flex items-center justify-center transition-colors ${
                      action.completed ? 'bg-[#1D9E75] border-[#1D9E75]' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {action.completed && (
                      <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
                        <path d="M1 2.5L2.5 4L6 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                  <span className={`text-xs flex-1 ${action.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {action.title}
                  </span>
                  {action.carried_over && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#FAEEDA] text-[#633806] shrink-0">carried</span>
                  )}
                  <button onClick={() => deleteAction(action.id)}
                    className="text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity text-base leading-none">×</button>
                </div>
              ))}
              <InlineAdd onAdd={title => addAction(kr.id, title)} />
            </div>
          )
        })
      })}
    </div>
  )
}

function InlineAdd({ onAdd }: { onAdd: (t: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (adding) ref.current?.focus() }, [adding])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onAdd(val)
    setVal('')
    setAdding(false)
  }

  if (!adding) return (
    <button className="px-4 py-2 text-[11px] text-gray-400 hover:text-[#1D9E75] text-left w-full" onClick={() => setAdding(true)}>
      + add action
    </button>
  )
  return (
    <form onSubmit={submit} className="px-4 py-2">
      <input ref={ref} className="input text-xs" value={val} onChange={e => setVal(e.target.value)}
        placeholder="Action item…" onBlur={() => { if (!val) setAdding(false) }} />
    </form>
  )
}
