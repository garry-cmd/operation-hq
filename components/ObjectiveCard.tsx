'use client'
import { useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, HealthStatus } from '@/lib/types'
import Modal from './Modal'

type Section = 'notes' | 'links' | null

const HEALTH_CYCLE: HealthStatus[] = ['not_started', 'on_track', 'off_track', 'blocked', 'done']
const HEALTH: Record<HealthStatus, { bg: string; color: string; label: string }> = {
  not_started: { bg: 'var(--navy-600)',  color: 'var(--navy-300)', label: 'Not started' },
  on_track:    { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'On track' },
  off_track:   { bg: 'var(--red-bg)',    color: 'var(--red-text)',  label: 'Off track' },
  blocked:     { bg: 'var(--amber-bg)',  color: 'var(--amber-text)', label: 'Blocked' },
  done:        { bg: 'var(--teal-bg)',   color: 'var(--teal-text)', label: 'Done ✓' },
}

function hex2rgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return `rgba(${r},${g},${b},${a})`
}

interface Props {
  obj: AnnualObjective
  krs: RoadmapItem[]
  actions: WeeklyAction[]
  weekStart: string
  links: ObjectiveLink[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  onAddLink: (link: ObjectiveLink) => void
  onDeleteLink: (id: string) => void
  onEditKR: (kr: RoadmapItem) => void
  toast: (m: string) => void
}

export default function ObjectiveCard({ obj, krs, actions, weekStart, links, setRoadmapItems, setObjectives, onAddLink, onDeleteLink, onEditKR, toast }: Props) {
  const [section, setSection] = useState<Section>(null)
  const [notes, setNotes] = useState(obj.notes ?? '')
  const [notesSaved, setNotesSaved] = useState(true)
  const [linkUrl, setLinkUrl] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [editKR, setEditKR] = useState<RoadmapItem | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack  = krs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
  const offTrack = krs.filter(k => k.health_status === 'off_track').length
  const blocked  = krs.filter(k => k.health_status === 'blocked').length
  const objLinks = links.filter(l => l.objective_id === obj.id)

  async function cycleStatus(kr: RoadmapItem) {
    const idx = HEALTH_CYCLE.indexOf(kr.health_status ?? 'not_started')
    const next = HEALTH_CYCLE[(idx + 1) % HEALTH_CYCLE.length]
    await supabase.from('roadmap_items').update({ health_status: next }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, health_status: next } : i))
  }

  // Debounced notes save
  const handleNotesChange = useCallback((val: string) => {
    setNotes(val)
    setNotesSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await supabase.from('annual_objectives').update({ notes: val }).eq('id', obj.id)
      setObjectives(prev => prev.map(o => o.id === obj.id ? { ...o, notes: val } : o))
      setNotesSaved(true)
    }, 800)
  }, [obj.id])

  async function addLink() {
    if (!linkUrl.trim() || addingLink) return
    setAddingLink(true)
    let url = linkUrl.trim()
    if (!url.startsWith('http')) url = 'https://' + url
    const domain = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    const title = domain
    const { data } = await supabase.from('objective_links')
      .insert({ objective_id: obj.id, url, title, sort_order: objLinks.length })
      .select().single()
    if (data) { onAddLink(data); setLinkUrl('') }
    setAddingLink(false)
  }

  async function deleteLink(id: string) {
    await supabase.from('objective_links').delete().eq('id', id)
    onDeleteLink(id)
  }

  function toggleSection(s: Section) {
    setSection(prev => prev === s ? null : s)
  }

  const borderColor = hex2rgba(obj.color, 0.25)
  const bgColor = hex2rgba(obj.color, 0.04)
  const hdrBg = hex2rgba(obj.color, 0.1)
  const divColor = hex2rgba(obj.color, 0.12)

  return (
    <>
      <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 14, border: `1px solid ${borderColor}`, background: bgColor }}>

        {/* Objective header */}
        <div style={{ padding: '12px 14px', background: hdrBg, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color, flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)', lineHeight: 1.3, marginBottom: 5 }}>
              {obj.name}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
              {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
              {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
              {onTrack === 0 && offTrack === 0 && blocked === 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>not started</span>}
            </div>
          </div>
        </div>

        {/* KR rows */}
        {krs.map((kr, i) => {
          const actCount = weekActions.filter(a => a.roadmap_item_id === kr.id).length
          const h = kr.health_status ?? 'not_started'
          const hs = HEALTH[h]
          return (
            <div key={kr.id} style={{ padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-100)', lineHeight: 1.4, marginBottom: 6 }}>{kr.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <div style={{ flex: 1, height: 3, background: 'var(--navy-600)', borderRadius: 2 }}>
                    <div style={{ height: 3, borderRadius: 2, background: obj.color, width: `${kr.progress ?? 0}%`, transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--navy-400)', fontWeight: 600, flexShrink: 0 }}>{kr.progress ?? 0}%</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--navy-500)' }}>
                  {actCount === 0 ? 'No actions this week' : `${actCount} action${actCount > 1 ? 's' : ''} this week`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 1 }}>
                <button onClick={() => cycleStatus(kr)}
                  style={{ fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 99, border: 'none', cursor: 'pointer', background: hs.bg, color: hs.color, whiteSpace: 'nowrap', transition: 'all .12s' }}>
                  {hs.label}
                </button>
                <button onClick={() => setEditKR(kr)}
                  style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="var(--navy-300)" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                </button>
              </div>
            </div>
          )
        })}

        {/* Footer tabs */}
        <div style={{ display: 'flex', borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
          {/* Notes tab */}
          <button onClick={() => toggleSection('notes')}
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: section === 'notes' ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'none', border: 'none', borderRight: `1px solid ${divColor}`, cursor: 'pointer', color: section === 'notes' ? obj.color : 'var(--navy-400)', transition: 'color .12s' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M3 2h7l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Notes
            {notes.trim() && <div style={{ width: 5, height: 5, borderRadius: '50%', background: obj.color, marginLeft: 1 }} />}
          </button>
          {/* Links tab */}
          <button onClick={() => toggleSection('links')}
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: section === 'links' ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: section === 'links' ? obj.color : 'var(--navy-400)', transition: 'color .12s' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.5-1.5a3.5 3.5 0 0 0-4.95-4.95L7 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0L3 8a3.5 3.5 0 0 0 4.95 4.95L9 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Links
            {objLinks.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: section === 'links' ? obj.color : 'var(--navy-600)', color: section === 'links' ? '#fff' : 'var(--navy-400)' }}>
                {objLinks.length}
              </span>
            )}
          </button>
        </div>

        {/* Notes section */}
        {section === 'notes' && (
          <div style={{ padding: '12px 14px', background: 'var(--navy-700)', borderTop: `1px solid ${divColor}` }}>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder="Why does this objective matter? What's the strategy? Context you'll want in 3 months…"
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.7, resize: 'none', color: 'var(--navy-100)', minHeight: 80 }}
              rows={4}
            />
            <div style={{ fontSize: 10, color: notesSaved ? 'var(--navy-500)' : 'var(--amber-text)', textAlign: 'right', marginTop: 2 }}>
              {notesSaved ? 'Saved' : 'Saving…'}
            </div>
          </div>
        )}

        {/* Links section */}
        {section === 'links' && (
          <div style={{ padding: '12px 14px', background: 'var(--navy-700)', borderTop: `1px solid ${divColor}` }}>
            {objLinks.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', paddingBottom: 10 }}>No links yet</div>
            )}
            {objLinks.map((link, i) => (
              <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', borderBottom: i < objLinks.length - 1 ? '1px solid var(--navy-600)' : 'none' }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M6.5 9.5a3.5 3.5 0 0 0 4.95 0l1.5-1.5a3.5 3.5 0 0 0-4.95-4.95L7 4" stroke="var(--navy-300)" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M9.5 6.5a3.5 3.5 0 0 0-4.95 0L3 8a3.5 3.5 0 0 0 4.95 4.95L9 12" stroke="var(--navy-300)" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, fontWeight: 500, color: 'var(--navy-100)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {link.title || link.url}
                  </a>
                  <div style={{ fontSize: 10, color: 'var(--navy-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.url}</div>
                </div>
                <button onClick={() => deleteLink(link.id)}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  ×
                </button>
              </div>
            ))}
            {/* Add link input */}
            <div style={{ display: 'flex', gap: 7, marginTop: objLinks.length > 0 ? 10 : 0 }}>
              <input
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addLink()}
                placeholder="Paste a URL…"
                className="input"
                style={{ flex: 1, fontSize: 12, padding: '8px 11px' }}
              />
              <button onClick={addLink} disabled={!linkUrl.trim() || addingLink}
                style={{ padding: '8px 14px', background: obj.color, color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 10, cursor: 'pointer', flexShrink: 0, opacity: !linkUrl.trim() ? .5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="white" strokeWidth="1.7" strokeLinecap="round"/></svg>
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit KR modal */}
      {editKR && (
        <EditKRModal kr={editKR} onClose={() => setEditKR(null)}
          onSave={updated => { setRoadmapItems(prev => prev.map(i => i.id === updated.id ? updated : i)); setEditKR(null); toast('Key result updated.') }} />
      )}
    </>
  )
}

function EditKRModal({ kr, onClose, onSave }: { kr: RoadmapItem; onClose: () => void; onSave: (kr: RoadmapItem) => void }) {
  const [title, setTitle] = useState(kr.title)
  const [saving, setSaving] = useState(false)
  async function save() {
    if (!title.trim()) return
    setSaving(true)
    await supabase.from('roadmap_items').update({ title }).eq('id', kr.id)
    onSave({ ...kr, title })
    setSaving(false)
  }
  return (
    <Modal title="Edit Key Result" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>{saving ? 'Saving…' : 'Save'}</button></>}>
      <div className="field">
        <label>Key Result</label>
        <textarea className="input" rows={3} value={title} onChange={e => setTitle(e.target.value)} autoFocus />
      </div>
    </Modal>
  )
}
