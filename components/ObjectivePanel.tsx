'use client'
/**
 * ObjectivePanel — the "back of card" for an annual objective.
 *
 * Opens when the user clicks an objective name on the OKRs tab. Surfaces
 * everything that lives on the objective:
 *   - References (files + links) at the top — quick reach for the artifacts
 *     you'd want to grab again. Sorted by recency.
 *   - A divider separates references from notes.
 *   - Notes (objective_logs) below — the journal of what happened.
 *
 * Mirror of ActionPanel's structure (header + sections + sticky-right
 * positioning). NoteEntry below is duplicated from ActionPanel for now;
 * extract to a shared component when next touched (same convention used
 * for TAG_STYLE in the panel arc).
 *
 * Files vs links — share the `objective_links` table with a `kind`
 * discriminator. Files render with paperclip icon + friendly name + host
 * subtitle. Links render with globe icon + auto-extracted domain title +
 * full URL subtitle. Both are external pointers; HQ never stores file
 * bytes — Drive (or wherever) holds them.
 */
import { useState } from 'react'
import { AnnualObjective, RoadmapItem, ObjectiveLink, ObjectiveLog, LinkKind } from '@/lib/types'
import * as extrasDb from '@/lib/db/objectiveExtras'
import MarkdownBody from './MarkdownBody'

type Props = {
  objective: AnnualObjective
  krs: RoadmapItem[]              // for the header summary line
  links: ObjectiveLink[]          // pre-filtered to this objective at call site
  logs: ObjectiveLog[]            // pre-filtered to this objective at call site
  setLinks: (fn: (p: ObjectiveLink[]) => ObjectiveLink[]) => void
  setLogs: (fn: (p: ObjectiveLog[]) => ObjectiveLog[]) => void
  onClose: () => void
  toast: (m: string) => void
}

export default function ObjectivePanel({ objective, krs, links, logs, setLinks, setLogs, onClose, toast }: Props) {
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
  const [creatingNote, setCreatingNote] = useState(false)
  const [newNoteTitle, setNewNoteTitle] = useState('')
  const [newNoteContent, setNewNoteContent] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const [creatingRef, setCreatingRef] = useState<LinkKind | null>(null) // 'link' | 'file' | null
  const [newRefUrl, setNewRefUrl] = useState('')
  const [newRefName, setNewRefName] = useState('') // friendly name for files
  const [savingRef, setSavingRef] = useState(false)

  // References (kind='link' | 'file'), most recent first.
  const objRefs = [...links].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Notes — most recent first. Same convention as ActionPanel.
  const objLogs = [...logs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // KR summary for the header.
  const onTrack = krs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
  const offTrack = krs.filter(k => k.health_status === 'off_track').length
  const blocked = krs.filter(k => k.health_status === 'blocked').length
  const doneKRs = krs.filter(k => k.health_status === 'done').length
  const progress = krs.length > 0 ? Math.round((doneKRs / krs.length) * 100) : 0

  async function saveNewNote() {
    if (savingNote) return
    if (!newNoteTitle.trim() && !newNoteContent.trim()) {
      // empty — bail silently
      setCreatingNote(false)
      setNewNoteTitle('')
      setNewNoteContent('')
      return
    }
    setSavingNote(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const created = await extrasDb.logs.create({
        objective_id: objective.id,
        title: newNoteTitle.trim() || null,
        content: newNoteContent,
        log_date: today,
      })
      setLogs(prev => [created, ...prev])
      setCreatingNote(false)
      setNewNoteTitle('')
      setNewNoteContent('')
    } catch (err) {
      console.error('saveNewNote failed:', err)
      toast('Failed to save note.')
    } finally {
      setSavingNote(false)
    }
  }

  function cancelNewNote() {
    setCreatingNote(false)
    setNewNoteTitle('')
    setNewNoteContent('')
  }

  async function saveNewRef() {
    if (savingRef || !creatingRef) return
    const url = normalizeUrl(newRefUrl.trim())
    if (!url) return
    // For files, friendly name is required. For links, fall back to domain.
    let title = newRefName.trim()
    if (!title) {
      if (creatingRef === 'file') return // file requires friendly name
      title = url.replace(/https?:\/\/(www\.)?/, '').split('/')[0]
    }
    setSavingRef(true)
    try {
      const created = await extrasDb.links.create({
        objective_id: objective.id,
        url,
        title,
        kind: creatingRef,
        sort_order: links.length,
      })
      setLinks(prev => [...prev, created])
      cancelNewRef()
    } catch (err) {
      console.error('saveNewRef failed:', err)
      toast(`Failed to save ${creatingRef}.`)
    } finally {
      setSavingRef(false)
    }
  }

  function cancelNewRef() {
    setCreatingRef(null)
    setNewRefUrl('')
    setNewRefName('')
  }

  async function deleteRef(id: string) {
    if (!confirm('Delete this entry? This cannot be undone.')) return
    try {
      await extrasDb.links.remove(id)
      setLinks(prev => prev.filter(l => l.id !== id))
    } catch (err) {
      console.error('deleteRef failed:', err)
      toast('Failed to delete.')
    }
  }

  return (
    <div style={{
      background: 'var(--navy-800)',
      border: '1px solid var(--navy-600)',
      borderRadius: 12,
      overflow: 'hidden',
      position: 'sticky',
      top: 16,
    }}>
      {/* Header — objective dot + name + KR summary + close */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--navy-700)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: objective.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy-50)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {objective.name}
          </span>
          <button onClick={onClose}
            style={{ width: 24, height: 24, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--navy-400)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}
            title="Close">
            ×
          </button>
        </div>
        {krs.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 4, marginLeft: 18, lineHeight: 1.4 }}>
            {krs.length} key result{krs.length !== 1 ? 's' : ''}
            {onTrack > 0 && <> · <span style={{ color: 'var(--teal-text)', fontWeight: 700 }}>{onTrack} on track</span></>}
            {offTrack > 0 && <> · <span style={{ color: 'var(--red-text)', fontWeight: 700 }}>{offTrack} off track</span></>}
            {blocked > 0 && <> · <span style={{ color: 'var(--amber-text)', fontWeight: 700 }}>{blocked} blocked</span></>}
            {' · '}{progress}% complete
          </div>
        )}
      </div>

      {/* References section — files and links interleaved by recency */}
      <div style={{ padding: '14px 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: 1 }}>
            References {objRefs.length > 0 && <span style={{ color: 'var(--navy-500)', fontWeight: 600 }}>({objRefs.length})</span>}
          </div>
          {!creatingRef && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setCreatingRef('link')}
                style={addPillStyle}>+ Link</button>
              <button onClick={() => setCreatingRef('file')}
                style={addPillStyle}>+ File</button>
            </div>
          )}
        </div>

        {/* Add-link form */}
        {creatingRef === 'link' && (
          <div style={formCardStyle}>
            <input
              value={newRefUrl}
              onChange={e => setNewRefUrl(e.target.value)}
              placeholder="Paste URL (https://…)"
              autoFocus
              style={formInputStyle}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveNewRef() } }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelNewRef} style={btnCancelStyle}>Cancel</button>
              <button onClick={saveNewRef} disabled={savingRef || !newRefUrl.trim()}
                style={{ ...btnSaveStyle, opacity: savingRef || !newRefUrl.trim() ? 0.5 : 1 }}>
                {savingRef ? 'Saving…' : 'Save link'}
              </button>
            </div>
          </div>
        )}

        {/* Add-file form */}
        {creatingRef === 'file' && (
          <div style={formCardStyle}>
            <input
              value={newRefName}
              onChange={e => setNewRefName(e.target.value)}
              placeholder="Friendly name (e.g. 'Q2 program v3.pdf')"
              autoFocus
              style={{ ...formInputStyle, marginBottom: 6 }}
            />
            <input
              value={newRefUrl}
              onChange={e => setNewRefUrl(e.target.value)}
              placeholder="Paste Google Drive URL"
              style={formInputStyle}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveNewRef() } }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelNewRef} style={btnCancelStyle}>Cancel</button>
              <button onClick={saveNewRef} disabled={savingRef || !newRefUrl.trim() || !newRefName.trim()}
                style={{ ...btnSaveStyle, opacity: savingRef || !newRefUrl.trim() || !newRefName.trim() ? 0.5 : 1 }}>
                {savingRef ? 'Saving…' : 'Save file'}
              </button>
            </div>
          </div>
        )}

        {objRefs.length === 0 && !creatingRef ? (
          <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '12px 0 4px', lineHeight: 1.5 }}>
            No links or files yet.
          </div>
        ) : (
          objRefs.map(ref => <RefRow key={ref.id} link={ref} onDelete={() => deleteRef(ref.id)} />)
        )}
      </div>

      {/* Divider — visually splits references (above) from notes (below).
          A heavier line than internal section separators because it marks
          a real category boundary. */}
      <div style={{ height: 1, background: 'var(--navy-600)', margin: '0 16px' }} />

      {/* Notes section */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Notes {objLogs.length > 0 && <span style={{ color: 'var(--navy-500)', fontWeight: 600 }}>({objLogs.length})</span>}
          </div>
          {!creatingNote && (
            <button onClick={() => setCreatingNote(true)} style={addPillStyle}>
              + Note
            </button>
          )}
        </div>

        {creatingNote && (
          <div style={formCardStyle}>
            <input
              value={newNoteTitle}
              onChange={e => setNewNoteTitle(e.target.value)}
              placeholder="Title (optional)"
              autoFocus
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 6, padding: 0, fontFamily: 'inherit' }}
            />
            <textarea
              value={newNoteContent}
              onChange={e => setNewNoteContent(e.target.value)}
              placeholder="Write your note (markdown supported)…"
              rows={4}
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', minHeight: 80, color: 'var(--navy-100)', padding: 0 }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelNewNote} style={btnCancelStyle}>Cancel</button>
              <button onClick={saveNewNote} disabled={savingNote || (!newNoteTitle.trim() && !newNoteContent.trim())}
                style={{ ...btnSaveStyle, opacity: savingNote || (!newNoteTitle.trim() && !newNoteContent.trim()) ? 0.5 : 1 }}>
                {savingNote ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {objLogs.length === 0 && !creatingNote ? (
          <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '12px 0 4px', lineHeight: 1.5 }}>
            No notes yet.<br />Add one to capture context for this objective.
          </div>
        ) : (
          objLogs.map(log => (
            <NoteEntry
              key={log.id}
              log={log}
              expanded={expandedNoteId === log.id}
              onExpand={() => setExpandedNoteId(log.id)}
              onCollapse={() => setExpandedNoteId(null)}
              setLogs={setLogs}
              toast={toast}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── RefRow ─────────────────────────────────────────────────────────────
// One file or link row. Click → opens the URL in a new tab. Hover reveals
// a small × to delete. File icon vs link icon based on `kind`.
function RefRow({ link, onDelete }: { link: ObjectiveLink; onDelete: () => void }) {
  const [hover, setHover] = useState(false)
  const isFile = link.kind === 'file'
  const subtitle = isFile
    ? hostFromUrl(link.url) // "drive.google.com" etc.
    : link.url.replace(/https?:\/\/(www\.)?/, '')
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '8px 10px',
        background: 'var(--navy-700)',
        border: '1px solid var(--navy-600)',
        borderRadius: 8,
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        cursor: 'pointer',
        transition: 'border-color .12s',
        borderColor: hover ? 'var(--navy-500)' : 'var(--navy-600)',
      }}
      onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
    >
      {isFile ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, color: 'var(--indigo-text)' }}>
          <path d="M3 1.5h5L11 4.5V12.5H3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M8 1.5V4.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, color: 'var(--teal-text)' }}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 7h11M7 1.5c1.5 1.7 2.3 3.6 2.3 5.5S8.5 12.3 7 14M7 1.5c-1.5 1.7-2.3 3.6-2.3 5.5S5.5 12.3 7 14" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-100)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
          {link.title}
        </div>
        <div style={{ fontSize: 10, color: 'var(--navy-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
          {subtitle}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Delete"
        style={{
          width: 22, height: 22, padding: 0, borderRadius: 4, border: 'none',
          background: 'transparent', color: 'var(--navy-400)',
          cursor: 'pointer', flexShrink: 0, fontSize: 14,
          opacity: hover ? 1 : 0,
          transition: 'opacity .12s',
        }}
      >×</button>
    </div>
  )
}

// ─── NoteEntry ──────────────────────────────────────────────────────────
// Three states:
//   - collapsed: date + title + 1-line preview (current behavior)
//   - expanded-view: rendered markdown body, with ✎ to edit (NEW)
//   - expanded-edit: editable title + textarea + Save / Cancel / Delete
//
// New empty notes default straight to edit mode (the user just hit + Note,
// they want to type). Existing notes default to view mode on expand —
// reading is the more common operation.
//
// Duplicated from ActionPanel.tsx (same convention used for TAG_STYLE).
// Extract to a shared module the next time both are touched.
function NoteEntry({ log, expanded, onExpand, onCollapse, setLogs, toast }: {
  log: ObjectiveLog
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  setLogs: (fn: (p: ObjectiveLog[]) => ObjectiveLog[]) => void
  toast: (m: string) => void
}) {
  const isEmpty = !log.title && !log.content
  const [mode, setMode] = useState<'view' | 'edit'>(isEmpty ? 'edit' : 'view')
  const [title, setTitle] = useState(log.title ?? '')
  const [content, setContent] = useState(log.content)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isDirty = title !== (log.title ?? '') || content !== log.content

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const updated = await extrasDb.logs.update(log.id, {
        title: title.trim() || null,
        content,
      })
      setLogs(prev => prev.map(l => l.id === log.id ? updated : l))
      setTitle(updated.title ?? '')
      setContent(updated.content)
      setMode('view')
    } catch (err) {
      console.error('note save failed:', err)
      toast('Failed to save note.')
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setTitle(log.title ?? '')
    setContent(log.content)
    if (isEmpty) onCollapse() // bail back to collapsed for a brand-new note
    else setMode('view')
  }

  async function deleteNote() {
    if (deleting) return
    if (!confirm('Delete this note? This cannot be undone.')) return
    setDeleting(true)
    try {
      await extrasDb.logs.remove(log.id)
      setLogs(prev => prev.filter(l => l.id !== log.id))
      onCollapse()
    } catch (err) {
      console.error('note delete failed:', err)
      toast('Failed to delete note.')
    } finally {
      setDeleting(false)
    }
  }

  const dateStr = formatLogDate(log.log_date)
  const preview = (log.content || '').split('\n').find(l => l.trim()) || (log.title ? '' : '(empty)')

  if (!expanded) {
    return (
      <div onClick={onExpand}
        style={{
          padding: '10px 12px',
          background: 'var(--navy-700)',
          border: '1px solid var(--navy-600)',
          borderRadius: 8,
          marginBottom: 8,
          cursor: 'pointer',
          transition: 'border-color .12s',
        }}
        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--navy-500)'}
        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--navy-600)'}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--navy-400)', flexShrink: 0, fontWeight: 600 }}>{dateStr}</span>
          {log.title && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-100)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {log.title}
            </span>
          )}
        </div>
        {preview && (
          <div style={{ fontSize: 12, color: 'var(--navy-300)', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', lineHeight: 1.4, wordBreak: 'break-word' }}>
            {preview}
          </div>
        )}
      </div>
    )
  }

  // Expanded — view mode (rendered markdown)
  if (mode === 'view') {
    return (
      <div style={{
        background: 'var(--navy-700)',
        border: '1px solid var(--accent)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--navy-400)', fontWeight: 600 }}>{dateStr}</span>
          {log.title && (
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {log.title}
            </span>
          )}
          <button onClick={() => setMode('edit')} title="Edit"
            style={{ width: 24, height: 24, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--navy-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: log.title ? 0 : 'auto' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={onCollapse} title="Collapse"
            style={{ width: 24, height: 24, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--navy-400)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
            ×
          </button>
        </div>
        <MarkdownBody content={log.content} />
      </div>
    )
  }

  // Expanded — edit mode (textarea + Save/Cancel/Delete)
  return (
    <div style={{
      background: 'var(--navy-700)',
      border: '1px solid var(--accent)',
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--navy-400)', fontWeight: 600 }}>{dateStr}</span>
        <button onClick={deleteNote} disabled={deleting}
          style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: 'var(--red-text)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 8px' }}>
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        autoFocus={!log.title && !log.content}
        style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 6, padding: 0, fontFamily: 'inherit' }}
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write your note (markdown supported)…"
        rows={5}
        style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', minHeight: 100, color: 'var(--navy-100)', padding: 0, whiteSpace: 'pre-wrap' }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancelEdit} style={btnCancelStyle}>Cancel</button>
        <button onClick={save} disabled={saving || !isDirty}
          style={{ ...btnSaveStyle, opacity: saving || !isDirty ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────

const addPillStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '4px 10px',
  background: 'var(--accent-dim)', color: 'var(--accent)',
  border: 'none', borderRadius: 99, cursor: 'pointer',
}

const formCardStyle: React.CSSProperties = {
  background: 'var(--navy-700)', border: '1px solid var(--navy-600)',
  borderRadius: 8, padding: 12, marginBottom: 12,
}

const formInputStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none', outline: 'none',
  fontSize: 13, color: 'var(--navy-100)', padding: 0, fontFamily: 'inherit',
}

const btnCancelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, padding: '4px 12px',
  background: 'transparent', color: 'var(--navy-400)',
  border: 'none', borderRadius: 6, cursor: 'pointer',
}

const btnSaveStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '4px 12px',
  background: 'var(--accent)', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
}

// "https://drive.google.com/file/d/abc/view?..." → "drive.google.com"
function hostFromUrl(u: string): string {
  try { return new URL(u).host.replace(/^www\./, '') }
  catch { return u.split('/')[0] }
}

function normalizeUrl(u: string): string {
  if (!u) return ''
  return u.startsWith('http') ? u : 'https://' + u
}

function formatLogDate(d: string): string {
  if (!d) return ''
  const date = new Date(d + 'T00:00:00')
  const month = date.toLocaleString('en-US', { month: 'short' })
  const day = date.getDate()
  const thisYear = new Date().getFullYear()
  const year = date.getFullYear()
  return year === thisYear ? `${month} ${day}` : `${month} ${day}, ${year}`
}
