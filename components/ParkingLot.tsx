'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem } from '@/lib/types'
import { QUARTERS, ACTIVE_Q } from '@/lib/utils'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  activeSpaceId: string
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  toast: (m: string) => void
}

export default function ParkingLot({ objectives, roadmapItems, activeSpaceId, setRoadmapItems, toast }: Props) {
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [scheduling, setScheduling] = useState<RoadmapItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const parked = roadmapItems.filter(i => i.is_parked)
  const activeObjs = objectives.filter(o => o.status === 'active')

  // Capture: title only. No objective required. The whole point.
  async function parkIdea(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || saving) return
    setSaving(true)
    const { data } = await supabase.from('roadmap_items')
      .insert({
        space_id: activeSpaceId,
        annual_objective_id: null,
        title: newTitle.trim(),
        quarter: null,
        status: 'planned',
        is_parked: true,
        sort_order: parked.length,
      })
      .select().single()
    if (data) { setRoadmapItems(prev => [...prev, data]); toast('Idea parked.') }
    setNewTitle('')
    setSaving(false)
    inputRef.current?.focus()
  }

  async function removeIdea(item: RoadmapItem) {
    if (!confirm('Remove this idea?')) return
    await supabase.from('roadmap_items').delete().eq('id', item.id)
    setRoadmapItems(prev => prev.filter(i => i.id !== item.id))
  }

  // Group: items grouped under their objective name; orphan items at the top under "Unassigned"
  const orphanItems = parked.filter(i => i.annual_objective_id === null)
  const grouped = objectives
    .map(obj => ({ obj, items: parked.filter(i => i.annual_objective_id === obj.id) }))
    .filter(g => g.items.length > 0)

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Parking Lot</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 20 }}>Get ideas out of your head — sort them later</p>

      {/* Capture form — title only, no categorization */}
      <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 16, padding: '16px', marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
          New idea
        </div>
        <form onSubmit={parkIdea}>
          <input ref={inputRef} value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder="What's on your mind?"
            className="input" style={{ marginBottom: 12 }} autoFocus />
          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!newTitle.trim() || saving}>
            {saving ? 'Saving…' : 'Park it'}
          </button>
        </form>
      </div>

      {/* Parked ideas */}
      {parked.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--navy-400)', fontSize: 14, lineHeight: 1.7 }}>
          Nothing parked yet.<br />
          <span style={{ fontSize: 12 }}>Brain dump — capture now, sort later.</span>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>
            {parked.length} parked idea{parked.length > 1 ? 's' : ''}
          </div>

          {/* Unassigned (no objective yet) — shown first because they're the freshest brain-dumps */}
          {orphanItems.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--navy-500)', flexShrink: 0 }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Unassigned</div>
              </div>
              {orphanItems.map(item => (
                <ParkedItemRow key={item.id} item={item}
                  onSchedule={() => setScheduling(item)}
                  onRemove={() => removeIdea(item)} />
              ))}
            </div>
          )}

          {/* Items already tagged to an objective */}
          {grouped.map(({ obj, items }) => (
            <div key={obj.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj.color, flexShrink: 0 }} />
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{obj.name}</div>
              </div>
              {items.map(item => (
                <ParkedItemRow key={item.id} item={item}
                  onSchedule={() => setScheduling(item)}
                  onRemove={() => removeIdea(item)} />
              ))}
            </div>
          ))}
        </>
      )}

      {scheduling && (
        <ScheduleSheet item={scheduling}
          objectives={activeObjs}
          onClose={() => setScheduling(null)}
          onScheduled={(updated) => {
            setRoadmapItems(prev => prev.map(i => i.id === updated.id ? updated : i))
            setScheduling(null)
            toast(`Scheduled to ${updated.quarter}`)
          }} />
      )}
    </div>
  )
}

function ParkedItemRow({ item, onSchedule, onRemove }: {
  item: RoadmapItem
  onSchedule: () => void
  onRemove: () => void
}) {
  return (
    <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '12px 14px', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--navy-100)', marginBottom: 10, lineHeight: 1.4 }}>{item.title}</div>
        <button onClick={onSchedule}
          style={{ fontSize: 12, background: 'var(--navy-700)', border: '1px solid var(--accent)', borderRadius: 8, padding: '7px 12px', color: 'var(--accent)', fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600 }}>
          Schedule →
        </button>
      </div>
      <button onClick={onRemove}
        style={{ fontSize: 18, lineHeight: 1, color: 'var(--navy-500)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', flexShrink: 0, marginTop: 1 }}>×</button>
    </div>
  )
}

function ScheduleSheet({ item, objectives, onClose, onScheduled }: {
  item: RoadmapItem
  objectives: AnnualObjective[]
  onClose: () => void
  onScheduled: (updated: RoadmapItem) => void
}) {
  // Pre-fill objective if the parked item was already tagged; otherwise pick the first active.
  const [objId, setObjId] = useState<string>(item.annual_objective_id ?? objectives[0]?.id ?? '')
  const [quarter, setQuarter] = useState<string>(ACTIVE_Q)
  const [saving, setSaving] = useState(false)

  async function schedule() {
    if (!objId || !quarter) return
    setSaving(true)
    const newStatus: 'active' | 'planned' = quarter === ACTIVE_Q ? 'active' : 'planned'
    const updates = { is_parked: false, quarter, status: newStatus, annual_objective_id: objId }
    await supabase.from('roadmap_items').update(updates).eq('id', item.id)
    onScheduled({ ...item, ...updates })
    setSaving(false)
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.5)' }} />
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 51, background: 'var(--navy-700)', borderTop: '2px solid var(--accent)', borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', animation: 'sheetUp .2s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy-50)', flex: 1 }}>Schedule this idea</div>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--navy-200)', marginBottom: 14, lineHeight: 1.4 }}>
          {item.title}
        </div>

        {objectives.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--amber-text)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
            Add an objective first — use the + button.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Objective</div>
            <select value={objId} onChange={e => setObjId(e.target.value)}
              style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'var(--navy-100)', fontFamily: 'inherit', marginBottom: 14, outline: 'none' }}>
              {objectives.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Quarter</div>
            <select value={quarter} onChange={e => setQuarter(e.target.value)}
              style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'var(--navy-100)', fontFamily: 'inherit', marginBottom: 16, outline: 'none' }}>
              {QUARTERS.map(q => <option key={q} value={q}>{q}{q === ACTIVE_Q ? ' — active' : ''}</option>)}
            </select>
          </>
        )}

        <button onClick={schedule} disabled={saving || !objId || objectives.length === 0}
          style={{ width: '100%', padding: 14, background: 'var(--accent)', color: 'var(--navy-900)', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: (!objId || objectives.length === 0) ? .5 : 1 }}>
          {saving ? 'Scheduling…' : 'Schedule it'}
        </button>
      </div>
    </>
  )
}
