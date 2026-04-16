'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem } from '@/lib/types'
import { COLORS } from '@/lib/utils'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  onSelect: (spaceId: string) => void
  onSpaceCreated: (space: Space) => void
  onSpaceUpdated: (space: Space) => void
}

export default function SpaceSwitcher({ spaces, activeSpaceId, objectives, roadmapItems, onSelect, onSpaceCreated, onSpaceUpdated }: Props) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const activeSpace = spaces.find(s => s.id === activeSpaceId)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setAdding(false); setEditingId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function openAdd() {
    setName(''); setColor(COLORS[spaces.length % COLORS.length])
    setAdding(true); setEditingId(null)
  }

  function openEdit(s: Space, e: React.MouseEvent) {
    e.stopPropagation()
    setName(s.name); setColor(s.color)
    setEditingId(s.id); setAdding(false)
  }

  async function saveNew() {
    if (!name.trim() || saving) return
    setSaving(true)
    const { data } = await supabase.from('spaces')
      .insert({ name: name.trim(), color, sort_order: spaces.length })
      .select().single()
    if (data) { onSpaceCreated(data); onSelect(data.id); setOpen(false) }
    setAdding(false); setSaving(false)
  }

  async function saveEdit() {
    if (!name.trim() || saving || !editingId) return
    setSaving(true)
    await supabase.from('spaces').update({ name: name.trim(), color }).eq('id', editingId)
    onSpaceUpdated({ ...spaces.find(s => s.id === editingId)!, name: name.trim(), color })
    setEditingId(null); setSaving(false)
  }

  function spaceStats(spaceId: string) {
    const objs = objectives.filter(o => o.space_id === spaceId && o.status !== 'abandoned')
    const krs = roadmapItems.filter(i => objs.some(o => o.id === i.annual_objective_id) && !i.is_parked)
    return { objs: objs.length, krs: krs.length }
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Pill trigger */}
      <button onClick={() => { setOpen(o => !o); setAdding(false); setEditingId(null) }}
        style={{ display: 'flex', alignItems: 'center', gap: 5, background: open ? 'var(--navy-600)' : 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 99, padding: '4px 9px 4px 7px', cursor: 'pointer', transition: 'all .15s' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: activeSpace?.color ?? 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-200)', maxWidth: 88, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeSpace?.name ?? 'Select space'}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="M2 4l3 3 3-3" stroke="var(--navy-400)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 220, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 14, overflow: 'hidden', zIndex: 60, boxShadow: '0 8px 32px rgba(0,0,0,.4)' }}>

          {spaces.map(space => {
            const isActive = space.id === activeSpaceId
            const isEditing = editingId === space.id
            const stats = spaceStats(space.id)
            return (
              <div key={space.id}>
                {isEditing ? (
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--navy-600)' }}>
                    <input value={name} onChange={e => setName(e.target.value)} autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                      style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }} />
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                      {COLORS.map(c => (
                        <button key={c} onClick={() => setColor(c)}
                          style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: color === c ? '2px solid var(--navy-50)' : '2px solid transparent', cursor: 'pointer' }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '6px', background: 'var(--navy-600)', border: 'none', borderRadius: 7, color: 'var(--navy-300)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={saveEdit} disabled={saving || !name.trim()} style={{ flex: 1, padding: '6px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: 'var(--navy-900)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !name.trim() ? .5 : 1 }}>{saving ? '…' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { onSelect(space.id); setOpen(false) }}
                    style={{ width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: isActive ? 'var(--navy-600)' : 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--navy-50)' : 'var(--navy-200)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--navy-400)', marginTop: 1 }}>
                        {stats.objs === 0 ? 'No objectives' : `${stats.objs} obj · ${stats.krs} KRs`}
                      </div>
                    </div>
                    {isActive
                      ? <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 7l3 3 6-6" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      : <button onClick={e => openEdit(space, e)}
                          style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--navy-500)', border: 'none', color: 'var(--navy-300)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                        </button>
                    }
                  </button>
                )}
              </div>
            )
          })}

          {/* Add new */}
          {adding ? (
            <div style={{ padding: '10px 12px' }}>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Space name…"
                onKeyDown={e => { if (e.key === 'Enter') saveNew(); if (e.key === 'Escape') setAdding(false) }}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none', marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    style={{ width: 22, height: 22, borderRadius: '50%', background: c, border: color === c ? '2px solid var(--navy-50)' : '2px solid transparent', cursor: 'pointer' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setAdding(false)} style={{ flex: 1, padding: '6px', background: 'var(--navy-600)', border: 'none', borderRadius: 7, color: 'var(--navy-300)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveNew} disabled={saving || !name.trim()} style={{ flex: 1, padding: '6px', background: 'var(--accent)', border: 'none', borderRadius: 7, color: 'var(--navy-900)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !name.trim() ? .5 : 1 }}>{saving ? '…' : 'Create'}</button>
              </div>
            </div>
          ) : (
            <button onClick={openAdd}
              style={{ width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-400)', fontSize: 12, fontWeight: 600 }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              New Space
            </button>
          )}
        </div>
      )}
    </div>
  )
}
