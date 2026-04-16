'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem } from '@/lib/types'
import { COLORS } from '@/lib/utils'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  onSelect: (spaceId: string) => void
  onClose: () => void
  onSpaceCreated: (space: Space) => void
  onSpaceUpdated: (space: Space) => void
}

export default function SpaceSwitcher({ spaces, activeSpaceId, objectives, roadmapItems, onSelect, onClose, onSpaceCreated, onSpaceUpdated }: Props) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Space | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)

  function openCreate() { setName(''); setColor(COLORS[spaces.length % COLORS.length]); setCreating(true); setEditing(null) }
  function openEdit(s: Space, e: React.MouseEvent) { e.stopPropagation(); setName(s.name); setColor(s.color); setEditing(s); setCreating(false) }

  async function save() {
    if (!name.trim() || saving) return
    setSaving(true)
    if (editing) {
      await supabase.from('spaces').update({ name: name.trim(), color }).eq('id', editing.id)
      onSpaceUpdated({ ...editing, name: name.trim(), color })
      setEditing(null)
    } else {
      const { data } = await supabase.from('spaces')
        .insert({ name: name.trim(), color, sort_order: spaces.length })
        .select().single()
      if (data) { onSpaceCreated(data); onSelect(data.id) }
      setCreating(false)
    }
    setSaving(false)
  }

  // Quick stats per space
  function spaceStats(spaceId: string) {
    const objs = objectives.filter(o => o.space_id === spaceId && o.status !== 'abandoned')
    const objIds = new Set(objs.map(o => o.id))
    const krs = roadmapItems.filter(i => objIds.has(i.annual_objective_id) && !i.is_parked && i.status !== 'done' && i.status !== 'abandoned')
    return { objs: objs.length, krs: krs.length }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column' }}
      onClick={onClose}>

      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.75)', backdropFilter: 'blur(4px)' }} />

      {/* Panel */}
      <div onClick={e => e.stopPropagation()}
        style={{ position: 'relative', zIndex: 1, margin: 'auto', width: '100%', maxWidth: 480, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 24, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--accent)', marginBottom: 2 }}>Mission Control</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)' }}>Select a Space</div>
          </div>
          <button onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--navy-700)', border: '1px solid var(--navy-600)', color: 'var(--navy-300)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>

        {/* Space list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {spaces.map(space => {
            const stats = spaceStats(space.id)
            const isActive = space.id === activeSpaceId
            const isEditing = editing?.id === space.id
            return (
              <div key={space.id}
                onClick={() => { onSelect(space.id); onClose() }}
                style={{ borderRadius: 14, border: `1.5px solid ${isActive ? space.color : 'var(--navy-600)'}`, background: isActive ? `rgba(${hexToRgb(space.color)}, 0.08)` : 'var(--navy-700)', cursor: 'pointer', overflow: 'hidden', transition: 'all .15s', boxShadow: isActive ? `0 0 0 1px ${space.color}20, 0 4px 20px ${space.color}15` : 'none' }}>
                {isEditing ? (
                  <div onClick={e => e.stopPropagation()} style={{ padding: 14 }}>
                    <input value={name} onChange={e => setName(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && save()}
                      style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none', marginBottom: 10 }} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                      {COLORS.map(c => (
                        <button key={c} onClick={() => setColor(c)}
                          style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? '3px solid var(--navy-50)' : '2px solid transparent', cursor: 'pointer', outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setEditing(null)} className="btn" style={{ flex: 1, minHeight: 36, fontSize: 12, padding: '8px 0' }}>Cancel</button>
                      <button onClick={save} disabled={saving || !name.trim()} className="btn-primary" style={{ flex: 1, minHeight: 36, fontSize: 12, padding: '8px 0' }}>{saving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    {/* Color bar */}
                    <div style={{ width: 4, height: 44, borderRadius: 2, background: space.color, flexShrink: 0 }} />
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {space.name}
                        {isActive && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: space.color, color: '#fff', letterSpacing: '.3px', textTransform: 'uppercase' }}>Active</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                        {stats.objs === 0 ? 'No objectives yet' : `${stats.objs} objective${stats.objs > 1 ? 's' : ''} · ${stats.krs} active KR${stats.krs !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    {/* Edit button */}
                    <button onClick={e => openEdit(space, e)}
                      style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--navy-600)', border: '1px solid var(--navy-500)', color: 'var(--navy-300)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {/* Create new space */}
          {creating ? (
            <div style={{ borderRadius: 14, border: '1.5px solid var(--accent)', background: 'var(--navy-700)', padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>New Space</div>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. USPSA, Vidscrip, Family…"
                onKeyDown={e => e.key === 'Enter' && save()}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none', marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? '3px solid var(--navy-50)' : '2px solid transparent', cursor: 'pointer', outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: 2 }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setCreating(false)} className="btn" style={{ flex: 1, minHeight: 36, fontSize: 12, padding: '8px 0' }}>Cancel</button>
                <button onClick={save} disabled={saving || !name.trim()} className="btn-primary" style={{ flex: 1, minHeight: 36, fontSize: 12, padding: '8px 0' }}>{saving ? 'Creating…' : 'Create Space'}</button>
              </div>
            </div>
          ) : (
            <button onClick={openCreate}
              style={{ borderRadius: 14, border: '1.5px dashed var(--navy-500)', background: 'none', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', color: 'var(--navy-400)', fontSize: 13, fontWeight: 600, transition: 'all .15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--navy-500)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--navy-400)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              New Space
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}
