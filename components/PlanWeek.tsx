'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction } from '@/lib/types'
import { ACTIVE_Q, formatWeek } from '@/lib/utils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  weekStart: string
  onClose: () => void
  onAddAction: (action: WeeklyAction) => void
}

export default function PlanWeek({ objectives, roadmapItems, weekStart, onClose, onAddAction }: Props) {
  const activeKRs = getCurrentQuarterKRs(roadmapItems, ACTIVE_Q)
  const [step, setStep] = useState(0)
  const [input, setInput] = useState('')
  const [stepActions, setStepActions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [totalAdded, setTotalAdded] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [step])

  const current = activeKRs[step]
  const currentObj = current ? objectives.find(o => o.id === current.annual_objective_id) : null

  async function addAction() {
    if (!input.trim() || !current || saving) return
    setSaving(true)
    const { data } = await supabase.from('weekly_actions')
      .insert({ roadmap_item_id: current.id, title: input.trim(), week_start: weekStart }).select().single()
    if (data) { onAddAction(data); setStepActions(p => [...p, input.trim()]); setTotalAdded(n => n + 1) }
    setInput('')
    setSaving(false)
    inputRef.current?.focus()
  }

  function next() {
    if (step >= activeKRs.length - 1) setDone(true)
    else { setStep(s => s + 1); setStepActions([]); setInput('') }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--navy-900)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 54, background: 'var(--navy-800)', borderBottom: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy-300)', flex: 1 }}>
          {done ? 'Week planned' : `Plan your week · ${formatWeek(weekStart)}`}
        </span>
        <button onClick={onClose} style={{ fontSize: 20, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px' }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px', maxWidth: 600, width: '100%', margin: '0 auto' }}>
        {done ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 8 }}>Week planned!</div>
            <div style={{ fontSize: 14, color: 'var(--navy-300)', marginBottom: 32, lineHeight: 1.6 }}>
              {totalAdded} action{totalAdded !== 1 ? 's' : ''} added across {activeKRs.length} key result{activeKRs.length !== 1 ? 's' : ''}.
            </div>
            <button onClick={onClose} className="btn-primary" style={{ minWidth: 160, fontSize: 15 }}>See my week →</button>
          </div>
        ) : (
          <>
            {/* Progress dots */}
            <div style={{ display: 'flex', gap: 5, justifyContent: 'center', marginBottom: 24 }}>
              {activeKRs.map((_, i) => (
                <div key={i} style={{ height: 6, borderRadius: 99, background: i < step ? 'var(--teal)' : i === step ? 'var(--accent)' : 'var(--navy-600)', width: i === step ? 20 : 6, transition: 'all .2s' }} />
              ))}
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 20 }}>
              Key Result {step + 1} of {activeKRs.length}
            </div>

            {/* Context */}
            {currentObj && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: currentObj.color }} />
                <span style={{ fontSize: 12, color: 'var(--navy-400)' }}>{currentObj.name}</span>
              </div>
            )}
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy-50)', lineHeight: 1.35, marginBottom: 20 }}>{current?.title}</div>

            {/* Added actions */}
            {stepActions.length > 0 && (
              <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '8px 12px', marginBottom: 14 }}>
                {stepActions.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < stepActions.length - 1 ? '1px solid var(--navy-600)' : 'none' }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <span style={{ fontSize: 13, color: 'var(--navy-200)' }}>{a}</span>
                  </div>
                ))}
              </div>
            )}

            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (input.trim()) addAction(); else next() } }}
              placeholder={stepActions.length === 0 ? 'What are you doing about this one this week?' : 'Add another action… (or press Enter to continue)'}
              className="input" style={{ marginBottom: 12, fontSize: 15 }} disabled={saving} />

            {input.trim() && (
              <button onClick={addAction} disabled={saving} className="btn-primary" style={{ width: '100%', marginBottom: 10 }}>
                {saving ? 'Adding…' : 'Add action'}
              </button>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={next} className="btn-primary" style={{ flex: 1, background: stepActions.length > 0 ? 'var(--accent)' : 'var(--navy-600)', color: stepActions.length > 0 ? '#fff' : 'var(--navy-300)' }}>
                {step < activeKRs.length - 1 ? 'Next key result →' : 'Finish planning →'}
              </button>
              {stepActions.length === 0 && <button onClick={next} className="btn">Skip</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
