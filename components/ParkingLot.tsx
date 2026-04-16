'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { QUARTERS, ACTIVE_Q } from '@/lib/utils'

interface Props {
  open: boolean
  onClose: () => void
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  toast: (m: string) => void
}

const N = {
  bg:      'var(--navy-800)',
  bg2:     'var(--navy-700)',
  bg3:     'var(--navy-600)',
  border:  '1px solid var(--navy-600)',
  border2: '1px solid var(--navy-500)',
  t1:      'var(--navy-50)',
  t2:      'var(--navy-200)',
  t3:      'var(--navy-300)',
  t4:      'var(--navy-400)',
  t5:      'var(--navy-500)',
  acc:     'var(--accent)',
  accDim:  'var(--accent-dim)',
  amb:     'var(--amber)',
  ambBg:   'var(--amber-bg)',
  ambT:    'var(--amber-text)',
}

export default function ParkingLot({ open, onClose, objectives, roadmapItems, setRoadmapItems, toast }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newObjId, setNewObjId] = useState(objectives[0]?.id ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (addOpen) inputRef.current?.focus() }, [addOpen])
  useEffect(() => { if (objectives.length && !newObjId) setNewObjId(objectives[0].id) }, [objectives])

  const parked = roadmapItems.filter(i => i.is_parked)

  async function schedule(item: RoadmapItem, quarter: string) {
    const newStatus = quarter === ACTIVE_Q ? 'active' : 'planned'
    await supabase.from('roadmap_items').update({ is_parked: false, quarter, status: newStatus }).eq('id', item.id)
    setRoadmapItems(prev => prev.map(i => i.id === item.id ? { ...i, is_parked: false, quarter, status: newStatus } : i))
    toast(`Scheduled to ${quarter}`)
  }

  async function removeItem(item: RoadmapItem) {
    if (!confirm('Remove this idea from the Parking Lot?')) return
    await supabase.from('roadmap_items').delete().eq('id', item.id)
    setRoadmapItems(prev => prev.filter(i => i.id !== item.id))
  }

  async function addIdea(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || !newObjId) return
    const { data } = await supabase.from('roadmap_items')
      .insert({ annual_objective_id: newObjId, title: newTitle, quarter: null, status: 'planned', is_parked: true, sort_order: parked.length })
      .select().single()
    if (data) {
      setRoadmapItems(prev => [...prev, data])
      toast('Added to Parking Lot')
    }
    setNewTitle('')
    setAddOpen(false)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' }} />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 56, right: 16, zIndex: 50,
        width: 300, maxHeight: 'calc(100vh - 80px)',
        background: 'var(--navy-800)', border: `1px solid var(--navy-500)`,
        borderRadius: 16, display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        animation: 'slideDown .18s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: N.border, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: N.t1, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 14 }}>🅿</span> Parking Lot
            </div>
            <div style={{ fontSize: 11, color: N.t4, marginTop: 2 }}>Ideas not yet assigned to a quarter</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 18, color: N.t4, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {parked.length === 0 && !addOpen && (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: N.t5, fontSize: 12, lineHeight: 1.6 }}>
              No ideas parked yet.<br />Add something you might tackle later.
            </div>
          )}

          {objectives.map(obj => {
            const items = parked.filter(i => i.annual_objective_id === obj.id)
            if (!items.length) return null
            return (
              <div key={obj.id} style={{ padding: '10px 16px', borderBottom: `1px solid var(--navy-900)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                  <div style={{ fontSize: 10, fontWeight: 700, color: N.t3, textTransform: 'uppercase', letterSpacing: '.5px' }}>{obj.name}</div>
                </div>
                {items.map(item => (
                  <div key={item.id} style={{ background: N.bg2, border: N.border, borderRadius: 10, padding: '9px 10px', marginBottom: 6 }}>
                    <div style={{ fontSize: 12, color: N.t2, marginBottom: 7, lineHeight: 1.35 }}>{item.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select
                        defaultValue=""
                        onChange={e => { if (e.target.value) schedule(item, e.target.value) }}
                        style={{ flex: 1, fontSize: 11, background: 'var(--navy-900)', border: `1px solid ${N.t5}`, borderRadius: 7, padding: '4px 8px', color: N.t3, fontFamily: 'inherit', cursor: 'pointer' }}>
                        <option value="">Move to quarter…</option>
                        {QUARTERS.map(q => <option key={q} value={q}>{q}{q === ACTIVE_Q ? ' — active' : ''}</option>)}
                      </select>
                      <button onClick={() => removeItem(item)}
                        style={{ fontSize: 14, color: N.t5, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
                        title="Remove idea">×</button>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Footer — add idea */}
        <div style={{ padding: '10px 16px', borderTop: N.border }}>
          {!addOpen ? (
            <button onClick={() => setAddOpen(true)}
              style={{ fontSize: 11, color: N.t4, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = N.acc)}
              onMouseLeave={e => (e.currentTarget.style.color = N.t4)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Add idea to Parking Lot
            </button>
          ) : (
            <form onSubmit={addIdea}>
              <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="What's the idea?"
                style={{ width: '100%', background: 'var(--navy-700)', border: `1px solid ${N.t5}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, color: N.t1, fontFamily: 'inherit', marginBottom: 7, outline: 'none' }} />
              <select value={newObjId} onChange={e => setNewObjId(e.target.value)}
                style={{ width: '100%', background: 'var(--navy-700)', border: `1px solid ${N.t5}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, color: N.t2, fontFamily: 'inherit', marginBottom: 8 }}>
                {objectives.filter(o => o.status === 'active').map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 7 }}>
                <button type="submit"
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, background: N.acc, color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Save to Parking Lot
                </button>
                <button type="button" onClick={() => { setAddOpen(false); setNewTitle('') }}
                  style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, background: 'transparent', color: N.t4, border: `1px solid ${N.t5}`, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <style>{`@keyframes slideDown { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </>
  )
}
