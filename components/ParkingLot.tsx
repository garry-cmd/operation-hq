'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { QUARTERS, ACTIVE_Q } from '@/lib/utils'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  toast: (m: string) => void
}

export default function ParkingLot({ objectives, roadmapItems, setRoadmapItems, toast }: Props) {
  const [newTitle, setNewTitle] = useState('')
  const [newObjId, setNewObjId] = useState(objectives.find(o => o.status === 'active')?.id ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { if (!newObjId) setNewObjId(objectives.find(o => o.status === 'active')?.id ?? '') }, [objectives])

  const parked = roadmapItems.filter(i => i.is_parked)

  async function parkIdea(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newObjId) return
    const { data } = await supabase.from('roadmap_items')
      .insert({ annual_objective_id: newObjId, title: newTitle, quarter: null, status: 'planned', is_parked: true, sort_order: parked.length })
      .select().single()
    if (data) { setRoadmapItems(prev => [...prev, data]); toast('Idea parked!') }
    setNewTitle('')
    inputRef.current?.focus()
  }

  async function schedule(item: RoadmapItem, quarter: string) {
    const newStatus = quarter === ACTIVE_Q ? 'active' : 'planned'
    await supabase.from('roadmap_items').update({ is_parked: false, quarter, status: newStatus }).eq('id', item.id)
    setRoadmapItems(prev => prev.map(i => i.id === item.id ? { ...i, is_parked: false, quarter, status: newStatus } : i))
    toast(`Scheduled to ${quarter}`)
  }

  async function removeIdea(item: RoadmapItem) {
    if (!confirm('Remove this idea?')) return
    await supabase.from('roadmap_items').delete().eq('id', item.id)
    setRoadmapItems(prev => prev.filter(i => i.id !== item.id))
  }

  const activeObjs = objectives.filter(o => o.status === 'active')

  return (
    <div>
      <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 4 }}>Parking Lot</h1>
      <p style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 18 }}>Capture ideas — schedule them when the time is right</p>

      {/* Capture box — prominent at top */}
      <div style={{ background: 'var(--navy-700)', border: '2px solid var(--amber)', borderRadius: 16, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber-text)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="var(--amber)" strokeWidth="1.8" strokeLinecap="round"/></svg>
          Capture an idea
        </div>
        <form onSubmit={parkIdea}>
          <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="What's on your mind?"
            style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 10, padding: '11px 14px', fontSize: 14, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 10, outline: 'none' }} />
          <select value={newObjId} onChange={e => setNewObjId(e.target.value)}
            style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--navy-200)', fontFamily: 'inherit', marginBottom: 12 }}>
            {activeObjs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="submit"
            style={{ width: '100%', padding: 13, background: 'var(--amber)', color: '#0b1520', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer' }}>
            Park it
          </button>
        </form>
      </div>

      {/* Parked ideas */}
      {parked.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--navy-500)', fontSize: 13 }}>
          Nothing parked yet. Ideas captured here will wait until you're ready to schedule them.
        </div>
      )}

      {parked.length > 0 && (
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
          {parked.length} idea{parked.length > 1 ? 's' : ''} parked
        </div>
      )}

      {objectives.map(obj => {
        const items = parked.filter(i => i.annual_objective_id === obj.id)
        if (!items.length) return null
        return (
          <div key={obj.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{obj.name}</div>
            </div>
            {items.map(item => (
              <div key={item.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--navy-100)', marginBottom: 8, lineHeight: 1.4 }}>{item.title}</div>
                  <select defaultValue="" onChange={e => { if (e.target.value) schedule(item, e.target.value) }}
                    style={{ fontSize: 11, background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '5px 10px', color: 'var(--navy-300)', fontFamily: 'inherit', cursor: 'pointer' }}>
                    <option value="">Schedule to quarter…</option>
                    {QUARTERS.map(q => <option key={q} value={q}>{q}{q === ACTIVE_Q ? ' — active' : ''}</option>)}
                  </select>
                </div>
                <button onClick={() => removeIdea(item)}
                  style={{ fontSize: 18, color: 'var(--navy-500)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: '0 4px' }}>×</button>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
