'use client'
import React, { useState, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, WeeklyAction, ObjectiveLink, ObjectiveLog, HealthStatus } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import Modal from './Modal'

type Section = 'notes' | 'links' | 'logs' | null

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
  logs: ObjectiveLog[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  onAddLink: (link: ObjectiveLink) => void
  onDeleteLink: (id: string) => void
  onAddLog: (log: ObjectiveLog) => void
  onDeleteLog: (id: string) => void
  onEditKR: (kr: RoadmapItem) => void
  toast: (m: string) => void
}

export default function ObjectiveCard({ obj, krs, actions, weekStart, links, logs, setRoadmapItems, setObjectives, setActions, onAddLink, onDeleteLink, onAddLog, onDeleteLog, onEditKR, toast }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [section, setSection] = useState<'notes' | 'links' | 'logs' | null>(null)
  const [notes, setNotes] = useState(obj.notes ?? '')
  const [notesSaved, setNotesSaved] = useState(true)
  const [linkUrl, setLinkUrl] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [logEntry, setLogEntry] = useState('')
  const [savingLog, setSavingLog] = useState(false)
  const [editKR, setEditKR] = useState<RoadmapItem | null>(null)
  const [addingKR, setAddingKR] = useState(false)
  const [newKRTitle, setNewKRTitle] = useState('')
  const [savingKR, setSavingKR] = useState(false)
  const [addingActionKRId, setAddingActionKRId] = useState<string | null>(null)
  const [newActionTitle, setNewActionTitle] = useState('')
  const [savingAction, setSavingAction] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const weekActions = actions.filter(a => a.week_start === weekStart)
  const onTrack  = krs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
  const offTrack = krs.filter(k => k.health_status === 'off_track').length
  const blocked  = krs.filter(k => k.health_status === 'blocked').length
  const notStarted = krs.filter(k => k.health_status === 'not_started' || !k.health_status).length
  const doneKRs  = krs.filter(k => k.health_status === 'done').length
  const progress = krs.length > 0 ? Math.round((doneKRs / krs.length) * 100) : 0
  const objLinks = links.filter(l => l.objective_id === obj.id)
  const objLogs  = logs.filter(l => l.objective_id === obj.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

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
    const { data } = await supabase.from('objective_links')
      .insert({ objective_id: obj.id, url, title: domain, sort_order: objLinks.length })
      .select().single()
    if (data) { onAddLink(data); setLinkUrl('') }
    setAddingLink(false)
  }

  async function saveLog() {
    if (!logEntry.trim() || savingLog) return
    setSavingLog(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase.from('objective_logs')
      .insert({ objective_id: obj.id, content: logEntry.trim(), log_date: today })
      .select().single()
    if (data) { onAddLog(data); setLogEntry('') }
    setSavingLog(false)
  }

  async function deleteLogEntry(id: string) {
    await supabase.from('objective_logs').delete().eq('id', id)
    onDeleteLog(id)
  }

  async function deleteLink(id: string) {
    await supabase.from('objective_links').delete().eq('id', id)
    onDeleteLink(id)
  }

  async function addKR() {
    if (!newKRTitle.trim() || savingKR) return
    setSavingKR(true)
    const { count } = await supabase.from('roadmap_items')
      .select('id', { count: 'exact', head: true }).eq('annual_objective_id', obj.id)
    const { data } = await supabase.from('roadmap_items')
      .insert({
        annual_objective_id: obj.id,
        title: newKRTitle.trim(),
        quarter: ACTIVE_Q,
        status: 'active',
        sort_order: count ?? 0,
        health_status: 'not_started',
        progress: 0,
      })
      .select().single()
    if (data) {
      setRoadmapItems(prev => [...prev, data])
      setNewKRTitle('')
      setAddingKR(false)
      toast('Key result added.')
    }
    setSavingKR(false)
  }

  async function addAction(krId: string) {
    if (!newActionTitle.trim() || savingAction) return
    setSavingAction(true)
    const { data } = await supabase.from('weekly_actions')
      .insert({
        roadmap_item_id: krId,
        title: newActionTitle.trim(),
        week_start: weekStart,
      })
      .select().single()
    if (data) {
      setActions(prev => [...prev, data])
      setNewActionTitle('')
      setAddingActionKRId(null)
      toast('Action added.')
    }
    setSavingAction(false)
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
        <div onClick={() => { setCollapsed(c => !c); setSection(null) }}
          style={{ padding: '12px 14px', background: hdrBg, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: obj.color, flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)', lineHeight: 1.3, marginBottom: collapsed ? 5 : 5 }}>
              {obj.name}
            </div>
            {collapsed ? (
              // Collapsed: show clean status counts
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
                {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
                {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
                {notStarted > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>{notStarted} not started</span>}
                {krs.length === 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>No key results</span>}
              </div>
            ) : (
              // Expanded: show same status counts (unchanged)
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {onTrack > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--teal-bg)', color: 'var(--teal-text)' }}>{onTrack} on track</span>}
                {offTrack > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--red-bg)',  color: 'var(--red-text)' }}>{offTrack} off track</span>}
                {blocked > 0  && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>{blocked} blocked</span>}
                {notStarted > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--navy-600)', color: 'var(--navy-400)' }}>{notStarted} not started</span>}
              </div>
            )}
            {/* Progress bar — always visible, even collapsed */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
              <div style={{ flex: 1, height: 4, background: 'var(--navy-600)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: 4, borderRadius: 2, background: progress === 100 ? 'var(--teal)' : obj.color, width: `${progress}%`, transition: 'width .4s ease' }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: progress === 100 ? 'var(--teal-text)' : 'var(--navy-300)', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>
                {progress}%
              </span>
            </div>
          </div>
          {/* Chevron */}
          <div style={{ flexShrink: 0, marginTop: 2, transition: 'transform .2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', color: 'var(--navy-400)' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>

        {/* Body — hidden when collapsed */}
        {!collapsed && (<>

        {/* KR rows */}
        {krs.map((kr, i) => {
          const actCount = weekActions.filter(a => a.roadmap_item_id === kr.id).length
          const h = kr.health_status ?? 'not_started'
          const hs = HEALTH[h]
          return (
            <React.Fragment key={kr.id}>
              <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-100)', lineHeight: 1.4, marginBottom: 4 }}>{kr.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--navy-500)' }}>
                    {actCount === 0 ? 'No actions this week' : `${actCount} action${actCount > 1 ? 's' : ''} this week`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 1 }}>
                  <button onClick={() => setAddingActionKRId(kr.id)}
                    style={{ fontSize: 10, fontWeight: 600, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    Add action
                  </button>
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
              {/* Inline action form */}
              {addingActionKRId === kr.id && (
                <div style={{ padding: '11px 14px', borderTop: `1px solid ${divColor}`, background: 'var(--navy-700)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <input
                      value={newActionTitle}
                      onChange={e => setNewActionTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addAction(kr.id)
                        if (e.key === 'Escape') { setAddingActionKRId(null); setNewActionTitle('') }
                      }}
                      placeholder="What action will move this KR forward?"
                      autoFocus
                      style={{ flex: 1, fontSize: 12, padding: '8px 10px', border: '1px solid var(--navy-600)', borderRadius: 8, background: 'var(--navy-800)', color: 'var(--navy-100)', outline: 'none' }}
                    />
                    <button onClick={() => addAction(kr.id)} disabled={!newActionTitle.trim() || savingAction}
                      style={{ padding: '8px 12px', background: obj.color, color: '#fff', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer', opacity: !newActionTitle.trim() ? .5 : 1 }}>
                      {savingAction ? 'Adding…' : 'Add'}
                    </button>
                    <button onClick={() => { setAddingActionKRId(null); setNewActionTitle('') }}
                      style={{ padding: '8px 12px', background: 'transparent', color: 'var(--navy-400)', fontSize: 11, border: '1px solid var(--navy-600)', borderRadius: 8, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}

        {/* Add key result */}
        {!addingKR ? (
          <button onClick={() => setAddingKR(true)}
            style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)', border: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', color: 'var(--navy-400)', fontSize: 12, fontWeight: 600, transition: 'color .12s' }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            Add key result
          </button>
        ) : (
          <div style={{ padding: '11px 14px', borderTop: `1px solid ${divColor}`, background: 'var(--navy-800)' }}>
            <textarea
              value={newKRTitle}
              onChange={e => setNewKRTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addKR()
                if (e.key === 'Escape') { setAddingKR(false); setNewKRTitle('') }
              }}
              placeholder="New key result…"
              autoFocus
              style={{ width: '100%', background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 10, padding: '9px 11px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, resize: 'none', color: 'var(--navy-100)', outline: 'none', marginBottom: 8 }}
              rows={2}
            />
            <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
              <button onClick={() => { setAddingKR(false); setNewKRTitle('') }}
                style={{ padding: '7px 14px', background: 'var(--navy-700)', color: 'var(--navy-300)', fontSize: 12, fontWeight: 600, border: '1px solid var(--navy-600)', borderRadius: 9, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={addKR} disabled={!newKRTitle.trim() || savingKR}
                style={{ padding: '7px 16px', background: obj.color, color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9, cursor: 'pointer', opacity: !newKRTitle.trim() ? .45 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                {savingKR ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        )}

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
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: section === 'links' ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'none', border: 'none', borderRight: `1px solid ${divColor}`, cursor: 'pointer', color: section === 'links' ? obj.color : 'var(--navy-400)', transition: 'color .12s' }}>
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
          {/* Logs tab */}
          <button onClick={() => toggleSection('logs')}
            style={{ flex: 1, padding: '9px 0', fontSize: 11, fontWeight: section === 'logs' ? 700 : 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: section === 'logs' ? obj.color : 'var(--navy-400)', transition: 'color .12s' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Logs
            {objLogs.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: section === 'logs' ? obj.color : 'var(--navy-600)', color: section === 'logs' ? '#fff' : 'var(--navy-400)' }}>
                {objLogs.length}
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

        {/* Logs section */}
        {section === 'logs' && (
          <div style={{ borderTop: `1px solid ${divColor}`, background: 'var(--navy-700)' }}>
            {/* New entry form */}
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${divColor}` }}>
              <textarea
                value={logEntry}
                onChange={e => setLogEntry(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveLog() }}
                placeholder={`What's happening with ${obj.name.split('—')[0].trim()}?`}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'none', color: 'var(--navy-100)', outline: 'none', marginBottom: 8 }}
                rows={3}
              />
              <button onClick={saveLog} disabled={!logEntry.trim() || savingLog}
                style={{ padding: '8px 18px', background: obj.color, color: '#fff', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 9, cursor: 'pointer', opacity: !logEntry.trim() ? .45 : 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="white" strokeWidth="1.7" strokeLinecap="round"/></svg>
                {savingLog ? 'Saving…' : 'Log it'}
              </button>
            </div>
            {/* Entries — newest first */}
            {objLogs.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '14px 0' }}>
                No entries yet
              </div>
            )}
            {objLogs.map((log, i) => (
              <div key={log.id} style={{ padding: '12px 14px', borderBottom: i < objLogs.length - 1 ? `1px solid ${divColor}` : 'none', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 5 }}>
                    {new Date(log.log_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--navy-200)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {log.content}
                  </div>
                </div>
                <button onClick={() => deleteLogEntry(log.id)}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}
      </div>
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
