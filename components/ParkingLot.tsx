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
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!newObjId) setNewObjId(objectives.find(o => o.status === 'active')?.id ?? '') }, [objectives])

  const parked = roadmapItems.filter(i => i.is_parked)
  const activeObjs = objectives.filter(o => o.status === 'active')

  async function parkIdea(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newObjId || saving) return
    setSaving(true)
    const { data } = await supabase.from('roadmap_items')
      .insert({ annual_objective_id: newObjId, title: newTitle, quarter: null, status: 'planned', is_parked: true, sort_order: parked.length })
      .select().single()
    if (data) { setRoadmapItems(prev => [...prev, data]); toast('Idea parked.') }
    setNewTitle('')
    setSaving(false)
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

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Parking Lot</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 20 }}>Capture ideas — schedule them when the time is right</p>

      {/* Capture form — clean, no loud border */}
      <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, padding: '16px', marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
          New idea
        </div>
        <form onSubmit={parkIdea}>
          <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="What's on your mind?"
            className="input" style={{ marginBottom: 10 }} autoFocus />
          <select value={newObjId} onChange={e => setNewObjId(e.target.value)}
            className="input" style={{ marginBottom: 12 }}>
            {activeObjs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!newTitle.trim() || saving}>
            {saving ? 'Saving…' : 'Park it'}
          </button>
        </form>
      </div>

      {/* Parked ideas */}
      {parked.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          Nothing parked yet.<br />
          <span style={{ fontSize: 12 }}>Ideas captured here wait until you're ready to schedule them.</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
            {parked.length} parked idea{parked.length > 1 ? 's' : ''}
          </div>

          {objectives.map(obj => {
            const items = parked.filter(i => i.annual_objective_id === obj.id)
            if (!items.length) return null
            return (
              <div key={obj.id} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{obj.name}</div>
                </div>
                {items.map(item => (
                  <div key={item.id} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '12px 14px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: 'var(--navy-100)', marginBottom: 10, lineHeight: 1.4 }}>{item.title}</div>
                      <select defaultValue="" onChange={e => { if (e.target.value) schedule(item, e.target.value) }}
                        style={{ fontSize: 12, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '7px 10px', color: 'var(--navy-300)', fontFamily: 'inherit', cursor: 'pointer', width: '100%' }}>
                        <option value="">Schedule to a quarter…</option>
                        {QUARTERS.map(q => <option key={q} value={q}>{q}{q === ACTIVE_Q ? ' — active' : ''}</option>)}
                      </select>
                    </div>
                    <button onClick={() => removeIdea(item)}
                      style={{ fontSize: 18, lineHeight: 1, color: 'var(--navy-500)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', flexShrink: 0, marginTop: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
