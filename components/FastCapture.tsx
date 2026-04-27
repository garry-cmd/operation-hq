'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import { AnnualObjective, RoadmapItem, WeeklyAction } from '@/lib/types'
import { ACTIVE_Q, COLORS } from '@/lib/utils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  weekStart: string
  activeSpaceId: string
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  toast: (m: string) => void
}

type CaptureType = 'objective' | 'keyresult' | 'action' | 'parking'

// Order matters: index 0 sits closest to the FAB, last index sits highest in the stack.
// Most-immediate (Parking Lot) at the bottom, most-strategic (Objective) at the top.
const TYPES: { id: CaptureType; label: string; color: string; icon: string }[] = [
  { id: 'parking',   label: 'Parking Lot', color: 'var(--accent)',     icon: 'P'  },
  { id: 'action',    label: 'Action',      color: 'var(--teal-text)',  icon: '✓'  },
  { id: 'keyresult', label: 'Key Result',  color: 'var(--navy-300)',   icon: 'KR' },
  { id: 'objective', label: 'Objective',   color: '#5a6a9a',           icon: 'O'  },
]

export default function FastCapture({ objectives, roadmapItems, weekStart, activeSpaceId, setObjectives, setRoadmapItems, setActions, toast }: Props) {
  const [dialOpen, setDialOpen] = useState(false)
  const [active, setActive] = useState<CaptureType | null>(null)
  const [title, setTitle] = useState('')
  const [secondVal, setSecondVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const activeKRs = getCurrentQuarterKRs(roadmapItems, ACTIVE_Q)
  const activeObjs = objectives.filter(o => o.status === 'active')

  useEffect(() => {
    if (active) {
      if (active === 'action')    setSecondVal(activeKRs[0]?.id ?? '')
      if (active === 'keyresult') setSecondVal(activeObjs[0]?.id ?? '')
      if (active === 'parking')   setSecondVal('') // standalone — no parent
      if (active === 'objective') setSecondVal('') // top of hierarchy
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [active])

  function openType(type: CaptureType) { setActive(type); setDialOpen(false); setTitle('') }
  function close() { setActive(null); setDialOpen(false); setTitle(''); setSecondVal('') }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      if (active === 'objective') {
        // Auto-pick the next color in the palette by current objective count.
        const color = COLORS[objectives.length % COLORS.length]
        const created = await objectivesDb.create({
          name: title.trim(),
          color,
          sort_order: objectives.length,
          status: 'active',
          space_id: activeSpaceId,
        })
        setObjectives(prev => [...prev, created])
        toast('Objective added!')
      }
      if (active === 'keyresult' && secondVal) {
        const parent = objectives.find(o => o.id === secondVal)
        if (!parent) return
        const count = roadmapItems.filter(i => i.annual_objective_id === secondVal && i.quarter === ACTIVE_Q).length
        const created = await krsDb.create({
          space_id: parent.space_id,
          annual_objective_id: secondVal,
          title,
          quarter: ACTIVE_Q,
          status: 'active',
          health_status: 'not_started',
          sort_order: count,
        })
        setRoadmapItems(prev => [...prev, created])
        toast('Key result added!')
      }
      if (active === 'action' && secondVal) {
        const { data } = await supabase.from('weekly_actions')
          .insert({ roadmap_item_id: secondVal, title, week_start: weekStart })
          .select().single()
        if (data) { setActions(prev => [...prev, data]); toast('Action added to Focus!') }
      }
      if (active === 'parking') {
        // Standalone — not tied to any objective. The whole point of parking
        // is to get the idea out of your head without categorizing yet.
        const created = await krsDb.create({
          space_id: activeSpaceId,
          annual_objective_id: null,
          title,
          quarter: null,
          status: 'planned',
          is_parked: true,
          sort_order: roadmapItems.filter(i => i.is_parked).length,
        })
        setRoadmapItems(prev => [...prev, created])
        toast('Idea parked!')
      }
      close()
    } catch { toast('Something went wrong.') }
  }

  // No second field for Objective (top of hierarchy) or Parking (the whole point
  // is to get the idea out of your head without categorizing).
  const secondField: { label: string; options: { value: string; label: string }[] } | null =
    active === 'keyresult' ? { label: 'For which objective?', options: activeObjs.map(o => ({ value: o.id, label: o.name })) } :
    active === 'action'    ? { label: 'Which key result?',    options: activeKRs.map(k => ({ value: k.id, label: k.title })) } :
    null

  const typeInfo = TYPES.find(t => t.id === active)

  return (
    <>
      {(dialOpen || active) && <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 44, background: 'rgba(0,0,0,0.5)' }} />}

      {dialOpen && TYPES.map((t, i) => (
        <button key={t.id} onClick={() => openType(t.id)}
          style={{ position: 'fixed', right: 16, bottom: `${88 + 56 + (i * 52)}px`, zIndex: 46, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--navy-700)', border: `1px solid ${t.color}`, borderRadius: 99, padding: '8px 14px 8px 10px', cursor: 'pointer', color: 'var(--navy-50)', fontSize: 13, fontWeight: 600, animation: `fabIn .15s ease ${i * 0.04}s both` }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy-600)', border: `1.5px solid ${t.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: t.color, flexShrink: 0 }}>{t.icon}</div>
          {t.label}
        </button>
      ))}

      <button onClick={() => dialOpen ? close() : setDialOpen(true)}
        style={{ position: 'fixed', right: 16, bottom: 88, zIndex: 47, width: 48, height: 48, borderRadius: '50%', background: dialOpen ? 'var(--navy-500)' : 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', transition: 'background .15s, transform .15s', transform: dialOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 4v14M4 11h14" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>

      {active && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 48, background: 'var(--navy-700)', borderTop: `2px solid ${typeInfo?.color}`, borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', animation: 'sheetUp .2s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--navy-600)', border: `1.5px solid ${typeInfo?.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: typeInfo?.color, flexShrink: 0 }}>{typeInfo?.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-50)' }}>Add {typeInfo?.label}</div>
            <button onClick={close} style={{ marginLeft: 'auto', fontSize: 20, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>×</button>
          </div>
          <form onSubmit={save}>
            <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
              placeholder={
                active === 'objective' ? 'e.g. Get in amazing shape this year' :
                active === 'keyresult' ? 'e.g. Lose 40 lbs by June 30' :
                active === 'action'    ? 'e.g. Wednesday strength session' :
                                         'e.g. 200 KB swings sub-15 min'
              }
              style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '13px 14px', fontSize: 15, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 12, outline: 'none', boxSizing: 'border-box' }} />
            {secondField && secondField.options.length > 0 && (
              <select value={secondVal} onChange={e => setSecondVal(e.target.value)}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'var(--navy-200)', fontFamily: 'inherit', marginBottom: 14, outline: 'none' }}>
                {secondField.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {secondField && secondField.options.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--amber-text)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                {active === 'keyresult' ? 'Add an objective first.' : 'Add key results first on the Roadmap.'}
              </div>
            )}
            {active === 'objective' && (
              <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 14, lineHeight: 1.4 }}>
                Color is auto-assigned. Change it later via the Edit link in OKRs or Roadmap.
              </div>
            )}
            <button type="submit" disabled={!title.trim() || (!!secondField && secondField.options.length === 0)}
              style={{ width: '100%', padding: 14, background: 'var(--accent)', color: 'var(--navy-900)', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: !title.trim() ? .5 : 1 }}>
              Save
            </button>
          </form>
        </div>
      )}

      <style>{`
        @keyframes fabIn  { from { opacity:0; transform:translateY(12px) scale(.9); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes sheetUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
      `}</style>
    </>
  )
}
