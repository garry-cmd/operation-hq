'use client'
/**
 * ActionPanel — the "back of card" for a weekly action.
 *
 * Opens when the user clicks an action title on the Focus tab. Shows:
 *   1. Parent objective (dot + name) and KR title as breadcrumb context
 *   2. The action title itself
 *   3. Tag picker (canonical home for setting backlog/waiting/doing)
 *   4. Notes pool — ALL logs for the parent objective, regardless of which
 *      action they were attached to. The portal model: notes live at the
 *      objective level, so opening any action under that objective surfaces
 *      the same shared note pool. (Decision in commit-4 plan: no per-action
 *      provenance, no created_from_action_id field.)
 *
 * In commit 4a (this file), title editing / recurring toggle / delete-action
 * still live in EditActionModal (triggered from the pencil button). Commit 4b
 * will migrate those into this panel and kill the modal.
 *
 * Note rendering: bodies are stored as markdown but rendered as plain text
 * with whitespace:pre-wrap for now. Adding `marked` for HTML rendering is a
 * follow-up; raw markdown is readable enough for solo authoring.
 */
import { useState } from 'react'
import { AnnualObjective, RoadmapItem, WeeklyAction, ActionTag, ObjectiveLog } from '@/lib/types'
import * as actionsDb from '@/lib/db/actions'
import * as extrasDb from '@/lib/db/objectiveExtras'

// Mirrors Focus.tsx's TAG_STYLE — kept in sync manually for now since
// extracting to a shared module is a separate refactor. If they ever drift,
// the row pill (Focus) and panel picker (here) will look different.
const TAG_STYLE: Record<ActionTag, { bg: string; color: string; label: string }> = {
  backlog: { bg: 'var(--navy-600)', color: 'var(--navy-200)', label: 'backlog' },
  waiting: { bg: 'var(--indigo-bg)', color: 'var(--indigo-text)', label: 'waiting' },
  doing:   { bg: 'var(--teal-bg)',   color: 'var(--teal-text)',   label: 'doing' },
}

type Props = {
  action: WeeklyAction
  parentKR: RoadmapItem
  parentObjective: AnnualObjective
  // Full logs list from page.tsx state — filtered to parentObjective inside.
  // Passed unfiltered so adding/removing notes can update the parent state
  // optimistically without losing the global view.
  logs: ObjectiveLog[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  setLogs: (fn: (p: ObjectiveLog[]) => ObjectiveLog[]) => void
  onClose: () => void
  toast: (m: string) => void
}

export default function ActionPanel({ action, parentKR, parentObjective, logs, setActions, setLogs, onClose, toast }: Props) {
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [savingNew, setSavingNew] = useState(false)

  const objLogs = logs
    .filter(l => l.objective_id === parentObjective.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  async function setTag(tag: ActionTag | null) {
    try {
      const updated = await actionsDb.update(action.id, { tag })
      setActions(prev => prev.map(a => a.id === action.id ? updated : a))
    } catch (err) {
      console.error('setTag failed:', err)
      toast('Failed to update tag.')
    }
  }

  async function saveNewNote() {
    if (savingNew) return
    if (!newTitle.trim() && !newContent.trim()) {
      // empty — just bail out of the form silently
      setCreatingNew(false)
      setNewTitle('')
      setNewContent('')
      return
    }
    setSavingNew(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const created = await extrasDb.logs.create({
        objective_id: parentObjective.id,
        title: newTitle.trim() || null,
        content: newContent,
        log_date: today,
      })
      setLogs(prev => [created, ...prev])
      setCreatingNew(false)
      setNewTitle('')
      setNewContent('')
    } catch (err) {
      console.error('saveNewNote failed:', err)
      toast('Failed to save note.')
    } finally {
      setSavingNew(false)
    }
  }

  function cancelNew() {
    setCreatingNew(false)
    setNewTitle('')
    setNewContent('')
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
      {/* Breadcrumb header: objective dot + name, KR sub-line, close button */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--navy-700)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: parentObjective.color, flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-300)', textTransform: 'uppercase', letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {parentObjective.name}
          </span>
          <button onClick={onClose}
            style={{ marginLeft: 'auto', width: 24, height: 24, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--navy-400)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}
            title="Close">
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 4, marginLeft: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {parentKR.title}
        </div>
      </div>

      {/* Action title + tag picker */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy-50)', lineHeight: 1.35, marginBottom: 10 }}>
          {action.title}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <TagPickerPill active={action.tag === null} onClick={() => setTag(null)}
            bg="var(--navy-700)" color="var(--navy-400)" label="—" outlineColor="var(--navy-300)" />
          {(['backlog', 'waiting', 'doing'] as ActionTag[]).map(t => (
            <TagPickerPill key={t} active={action.tag === t} onClick={() => setTag(action.tag === t ? null : t)}
              bg={TAG_STYLE[t].bg} color={TAG_STYLE[t].color} label={TAG_STYLE[t].label}
              outlineColor={TAG_STYLE[t].color} />
          ))}
        </div>
      </div>

      {/* Notes section */}
      <div style={{ borderTop: '1px solid var(--navy-700)', padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Notes {objLogs.length > 0 && <span style={{ color: 'var(--navy-500)', fontWeight: 600 }}>({objLogs.length})</span>}
          </div>
          {!creatingNew && (
            <button onClick={() => setCreatingNew(true)}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', background: 'var(--accent-dim)', color: 'var(--accent)', border: 'none', borderRadius: 99, cursor: 'pointer' }}>
              + Add note
            </button>
          )}
        </div>

        {/* New-note form (local state, only persisted on save) */}
        {creatingNew && (
          <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="Title (optional)"
              autoFocus
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 6, padding: 0 }}
            />
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder="Write your note (markdown supported)…"
              rows={4}
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', minHeight: 80, color: 'var(--navy-100)', padding: 0 }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelNew}
                style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', background: 'transparent', color: 'var(--navy-400)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveNewNote} disabled={savingNew || (!newTitle.trim() && !newContent.trim())}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: savingNew || (!newTitle.trim() && !newContent.trim()) ? 0.5 : 1 }}>
                {savingNew ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Existing notes */}
        {objLogs.length === 0 && !creatingNew ? (
          <div style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '24px 0', lineHeight: 1.5 }}>
            No notes yet.<br/>Add one to capture context for this objective.
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

// ─── NoteEntry ──────────────────────────────────────────────────────────
// One note in the list. Two visual states:
//   - collapsed: date + title + 1-line preview, click to expand
//   - expanded: editable title input + textarea + Save / Delete / Cancel
//
// Save is explicit (button), not autosave — avoids race conditions with the
// expand/collapse state and keeps the model simple. Cancel discards local
// edits; Delete removes the entry (with confirm prompt).
function NoteEntry({ log, expanded, onExpand, onCollapse, setLogs, toast }: {
  log: ObjectiveLog
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  setLogs: (fn: (p: ObjectiveLog[]) => ObjectiveLog[]) => void
  toast: (m: string) => void
}) {
  // Local edit state — initialised from props on mount. Save/cancel reset
  // it explicitly. We deliberately don't useEffect-sync from log props on
  // every change: that would clobber unsaved edits if the user clicked
  // another note before saving, which is the wrong UX trade-off.
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
      onCollapse()
    } catch (err) {
      console.error('note save failed:', err)
      toast('Failed to save note.')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setTitle(log.title ?? '')
    setContent(log.content)
    onCollapse()
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
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-100)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {log.title}
            </span>
          )}
        </div>
        {preview && (
          <div style={{ fontSize: 12, color: 'var(--navy-300)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
            {preview}
          </div>
        )}
      </div>
    )
  }

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
        style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 6, padding: 0 }}
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write your note (markdown supported)…"
        rows={5}
        style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical', minHeight: 100, color: 'var(--navy-100)', padding: 0, whiteSpace: 'pre-wrap' }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button onClick={cancel}
          style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', background: 'transparent', color: 'var(--navy-400)', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={save} disabled={saving || !isDirty}
          style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: saving || !isDirty ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ─── TagPickerPill ──────────────────────────────────────────────────────
// Same component shape as the picker in EditActionModal (Focus.tsx) — they
// could share via export, but inlining here keeps the panel self-contained
// and reduces churn in Focus when the modal eventually disappears in 4b.
function TagPickerPill({ active, onClick, bg, color, label, outlineColor }: {
  active: boolean
  onClick: () => void
  bg: string
  color: string
  label: string
  outlineColor: string
}) {
  return (
    <button type="button" onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 99,
        background: bg, color, border: 'none',
        outline: active ? `2px solid ${outlineColor}` : 'none',
        outlineOffset: 1,
        opacity: active ? 1 : 0.55,
        cursor: 'pointer',
        transition: 'opacity .12s, outline .12s',
      }}>
      {label}
    </button>
  )
}

// Format YYYY-MM-DD as "Apr 22" or "Apr 22, 2024" if not current year.
function formatLogDate(d: string): string {
  if (!d) return ''
  const date = new Date(d + 'T00:00:00')
  const month = date.toLocaleString('en-US', { month: 'short' })
  const day = date.getDate()
  const thisYear = new Date().getFullYear()
  const year = date.getFullYear()
  return year === thisYear ? `${month} ${day}` : `${month} ${day}, ${year}`
}
