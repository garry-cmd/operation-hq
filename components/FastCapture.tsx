'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, WeeklyAction } from '@/lib/types'
import { ACTIVE_Q, COLORS, getMonday } from '@/lib/utils'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]
  weekStart: string
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  toast: (m: string) => void
}

type CaptureType = 'objective' | 'keyresult' | 'task' | 'parking'

const TYPES: { id: CaptureType; label: string; color: string; icon: string }[] = [
  { id: 'parking',   label: 'Parking Lot', color: '#f5a623', icon: 'P' },
  { id: 'task',      label: 'Task',        color: '#4db8ff', icon: '✓' },
  { id: 'keyresult', label: 'Milestone',   color: '#1D9E75', icon: 'M' },
  { id: 'objective', label: 'Objective',   color: '#7F77DD', icon: 'O' },
]

export default function FastCapture({ objectives, roadmapItems, krs, weekStart, setObjectives, setRoadmapItems, setKrs, setActions, toast }: Props) {
  const [dialOpen, setDialOpen] = useState(false)
  const [active, setActive] = useState<CaptureType | null>(null)
  const [title, setTitle] = useState('')
  const [secondVal, setSecondVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const activeObjs = objectives.filter(o => o.status === 'active')
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && !i.is_parked && i.status !== 'abandoned')
  const activeKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))

  useEffect(() => {
    if (active) {
      // Set sensible default for second field
      if (active === 'keyresult') setSecondVal(activeItems[0]?.id ?? '')
      if (active === 'task') setSecondVal(activeKrs[0]?.id ?? '')
      if (active === 'parking' || active === 'objective') setSecondVal(activeObjs[0]?.id ?? '')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [active])

  function openType(type: CaptureType) {
    setActive(type)
    setDialOpen(false)
    setTitle('')
  }

  function close() {
    setActive(null)
    setDialOpen(false)
    setTitle('')
    setSecondVal('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    try {
      if (active === 'objective') {
        const usedColors = objectives.map(o => o.color)
        const nextColor = COLORS.find(c => !usedColors.includes(c)) ?? COLORS[0]
        const { data } = await supabase.from('annual_objectives')
          .insert({ name: title, color: nextColor, sort_order: objectives.length, status: 'active' })
          .select().single()
        if (data) { setObjectives(prev => [...prev, data]); toast('Objective added!') }
      }

      if (active === 'keyresult' && secondVal) {
        const count = krs.filter(k => k.roadmap_item_id === secondVal).length
        const { data } = await supabase.from('quarterly_krs')
          .insert({ roadmap_item_id: secondVal, title, sort_order: count })
          .select().single()
        if (data) { setKrs(prev => [...prev, data]); toast('Milestone added!') }
      }

      if (active === 'task' && secondVal) {
        const { data } = await supabase.from('weekly_actions')
          .insert({ quarterly_kr_id: secondVal, title, week_start: weekStart })
          .select().single()
        if (data) { setActions(prev => [...prev, data]); toast('Task added to this week!') }
      }

      if (active === 'parking' && secondVal) {
        const { data } = await supabase.from('roadmap_items')
          .insert({ annual_objective_id: secondVal, title, quarter: null, status: 'planned', is_parked: true, sort_order: roadmapItems.filter(i => i.is_parked).length })
          .select().single()
        if (data) { setRoadmapItems(prev => [...prev, data]); toast('Idea parked!') }
      }

      close()
    } catch {
      toast('Something went wrong — try again.')
    }
  }

  // Second field config per type
  const secondField: { label: string; options: { value: string; label: string }[] } | null =
    active === 'keyresult' ? { label: 'For which quarterly objective?', options: activeItems.map(i => ({ value: i.id, label: i.title })) } :
    active === 'task'      ? { label: 'Which milestone does this drive?',  options: activeKrs.map(k => ({ value: k.id, label: k.title })) } :
    active === 'parking'   ? { label: 'Which objective does this belong to?', options: activeObjs.map(o => ({ value: o.id, label: o.name })) } :
    null

  const typeInfo = TYPES.find(t => t.id === active)

  return (
    <>
      {/* Backdrop — closes everything */}
      {(dialOpen || active) && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 44, background: 'rgba(0,0,0,0.5)' }} />
      )}

      {/* Speed dial sub-buttons */}
      {dialOpen && TYPES.map((t, i) => (
        <button key={t.id} onClick={() => openType(t.id)}
          style={{
            position: 'fixed',
            right: 16,
            bottom: `${88 + 56 + (i * 52)}px`,
            zIndex: 46,
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--navy-700)', border: `1px solid ${t.color}`,
            borderRadius: 99, padding: '8px 14px 8px 10px',
            cursor: 'pointer', color: 'var(--navy-50)', fontSize: 13, fontWeight: 600,
            animation: `fabIn .15s ease ${i * 0.04}s both`,
            boxShadow: `0 0 0 1px ${t.color}22`,
          }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: t.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {t.icon}
          </div>
          {t.label}
        </button>
      ))}

      {/* Main FAB */}
      <button onClick={() => dialOpen ? close() : setDialOpen(true)}
        style={{
          position: 'fixed', right: 16, bottom: 88, zIndex: 47,
          width: 48, height: 48, borderRadius: '50%',
          background: dialOpen ? 'var(--navy-500)' : 'var(--accent)',
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          transition: 'background .15s, transform .15s',
          transform: dialOpen ? 'rotate(45deg)' : 'rotate(0deg)',
        }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <path d="M11 4v14M4 11h14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Bottom sheet form */}
      {active && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 48,
          background: 'var(--navy-700)', borderTop: `2px solid ${typeInfo?.color}`,
          borderRadius: '20px 20px 0 0',
          padding: '20px 20px 32px',
          animation: 'sheetUp .2s ease',
        }}>
          {/* Sheet header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: typeInfo?.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {typeInfo?.icon}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-50)' }}>
              Add {typeInfo?.label}
            </div>
            <button onClick={close} style={{ marginLeft: 'auto', fontSize: 20, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '4px 6px' }}>×</button>
          </div>

          <form onSubmit={save}>
            {/* Title input */}
            <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
              placeholder={
                active === 'objective' ? 'e.g. Greek God — peak conditioning' :
                active === 'keyresult' ? 'e.g. 4 strength sessions per week' :
                active === 'task'      ? 'e.g. Wednesday strength session' :
                'e.g. Build Sage Intacct case study'
              }
              style={{ width: '100%', background: 'var(--navy-800)', border: `1px solid var(--navy-500)`, borderRadius: 12, padding: '13px 14px', fontSize: 15, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 12, outline: 'none', boxSizing: 'border-box' }} />

            {/* Second field */}
            {secondField && secondField.options.length > 0 && (
              <select value={secondVal} onChange={e => setSecondVal(e.target.value)}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'var(--navy-200)', fontFamily: 'inherit', marginBottom: 14, outline: 'none' }}>
                {secondField.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}

            {secondField && secondField.options.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--amber-text)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                {active === 'keyresult' ? 'Add active key results first on the Roadmap screen.' :
                 active === 'task' ? 'Add milestones first on the OKRs screen.' :
                 'Add an objective first.'}
              </div>
            )}

            <button type="submit" disabled={!title.trim() || (!!secondField && secondField.options.length === 0)}
              style={{ width: '100%', padding: 14, background: typeInfo?.color, color: active === 'parking' ? '#0b1520' : '#fff', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: !title.trim() ? .5 : 1, transition: 'opacity .15s' }}>
              Save
            </button>
          </form>
        </div>
      )}

      <style>{`
        @keyframes fabIn  { from { opacity: 0; transform: translateY(12px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </>
  )
}
