'use client'
/**
 * Tasks — mobile-first task list.
 * Scope chips: Today | Overdue | Inbox | All | per-space
 * Sections: Overdue · Today · Upcoming · Done (collapsed by default)
 * FAB (+ button) is page-level; this component exposes onCreateTask so
 * page.tsx can wire the FastCapture or a simple inline create.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task, Space, RoadmapItem, TaskTag } from '@/lib/types'
import * as tasksDb from '@/lib/db/tasks'

// ── helpers ──────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

function dueBucket(task: Task): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!task.due_date) return 'none'
  const t = today()
  if (task.due_date < t) return 'overdue'
  if (task.due_date === t) return 'today'
  return 'upcoming'
}

function relDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff === -1) return 'Due yesterday'
  if (diff < 0) return `Due ${Math.abs(diff)} days ago`
  if (diff < 7) return `Due ${d.toLocaleDateString('en-US', { weekday: 'long' })}`
  const sameYear = d.getFullYear() === now.getFullYear()
  return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

const PRIORITY_COLOR: Record<number, string> = {
  1: 'var(--nw-alarm-text, #ff6452)',
  2: 'var(--nw-caution-text, #f5b840)',
  3: 'var(--accent)',
  4: 'var(--navy-500)',
}

type Scope =
  | { kind: 'today' }
  | { kind: 'overdue' }
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'tag'; tag: string }

interface Props {
  spaces: Space[]
  activeSpaceId: string
  roadmapItems: RoadmapItem[]
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  tagsByTask: Record<string, string[]>
  setTagsByTask: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  toast: (m: string) => void
}

// ── inline create row ─────────────────────────────────────────────────────

function InlineCreate({ onSave, onCancel, spaceId }: {
  onSave: (title: string) => Promise<void>
  onCancel: () => void
  spaceId: string | null
}) {
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function submit() {
    const t = title.trim()
    if (!t) { onCancel(); return }
    await onSave(t)
    setTitle('')
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
      margin: '0 14px 10px', borderRadius: 14,
      background: 'var(--navy-800)', border: '1px dashed var(--navy-500)',
    }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--navy-500)', flexShrink: 0 }} />
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Task name…"
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontSize: 16, color: 'var(--navy-50)', fontFamily: 'inherit',
        }}
      />
      <button
        onClick={submit}
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 12px' }}
      >Add</button>
      <button
        onClick={onCancel}
        style={{ fontSize: 14, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 10px' }}
      >✕</button>
    </div>
  )
}

// ── task row ──────────────────────────────────────────────────────────────

function TaskRow({ task, tags, spaces, roadmapItems, onToggle, onOpen }: {
  task: Task
  tags: string[]
  spaces: Space[]
  roadmapItems: RoadmapItem[]
  onToggle: () => void
  onOpen: () => void
}) {
  const bucket = dueBucket(task)
  const kr = task.roadmap_item_id ? roadmapItems.find(r => r.id === task.roadmap_item_id) : null
  const space = task.space_id ? spaces.find(s => s.id === task.space_id) : null
  const isDone = !!task.completed_at
  const recurring = !!(task.recurrence_rule || task.recurrence_text)
  const ringColor = isDone ? 'var(--navy-500)' : (PRIORITY_COLOR[task.priority] ?? 'var(--navy-500)')

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px',
      margin: '0 14px 10px', borderRadius: 14,
      background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
      boxShadow: 'var(--card-shadow), var(--card-inset)',
      opacity: isDone ? .55 : 1,
    }}>
      {/* circle checkbox — 44px hit area around a 30px ring (priority color) */}
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        aria-label={isDone ? 'Mark not done' : 'Mark done'}
        style={{
          width: 44, height: 44, flexShrink: 0, margin: '-7px 0 0 -7px', padding: 0,
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          WebkitTapHighlightColor: 'transparent',
        } as React.CSSProperties}
      >
        <span style={{
          width: 30, height: 30, borderRadius: '50%',
          border: `2px solid ${ringColor}`,
          background: isDone ? 'var(--navy-600)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background .12s',
        }}>
          {isDone && (
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="var(--navy-300)" strokeWidth="2.4">
              <polyline points="2,6 5,9 10,3"/>
            </svg>
          )}
        </span>
      </button>

      {/* body — tap opens detail sheet */}
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}>
        <div style={{
          fontSize: 16.5, fontWeight: 500, color: isDone ? 'var(--navy-400)' : 'var(--navy-100)',
          lineHeight: 1.3, letterSpacing: '-.01em',
          textDecoration: isDone ? 'line-through' : 'none',
        }}>{task.title}</div>

        {/* description preview — one line, muted */}
        {task.description && (
          <div style={{
            fontSize: 13, color: 'var(--navy-300)', marginTop: 3, lineHeight: 1.35,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {task.description}
          </div>
        )}

        {/* KR context — the alignment moat, readable not chipped */}
        {kr && (
          <div style={{
            fontSize: 13, color: 'var(--navy-400)', marginTop: 3, lineHeight: 1.35,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            KR: {kr.title}
          </div>
        )}

        {(task.due_date || recurring || space || tags.length > 0) && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            {task.due_date && (
              <span style={{
                fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5,
                color: bucket === 'overdue' ? 'var(--nw-alarm-text, #ff6452)' : bucket === 'today' ? 'var(--nw-caution-text, #f5b840)' : 'var(--navy-400)',
              }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ flexShrink: 0 }}>
                  <rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>
                </svg>
                {relDate(task.due_date)}
                {recurring && <span title={task.recurrence_text ?? 'Recurring'} style={{ fontSize: 13 }}>↻</span>}
              </span>
            )}
            {!task.due_date && recurring && (
              <span title={task.recurrence_text ?? 'Recurring'} style={{ fontSize: 13, color: 'var(--navy-400)' }}>↻</span>
            )}
            {space && (
              <span style={{ fontSize: 12.5, color: 'var(--navy-400)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ flexShrink: 0 }}>
                  <path d="M8.7 2.3l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5A1 1 0 0 1 2 8V3a1 1 0 0 1 1-1h5a1 1 0 0 1 .7.3z"/>
                  <circle cx="5.5" cy="5.5" r=".5" fill="currentColor"/>
                </svg>
                {space.name}
              </span>
            )}
            {tags.map(tag => (
              <span key={tag} style={{ fontSize: 12, color: 'var(--navy-400)' }}>
                #{tag}
              </span>
            ))}
          </div>
        )}
      </button>
    </div>
  )
}

// ── task detail sheet ─────────────────────────────────────────────────────

function TaskDetailSheet({ task, tags: initialTags, allTags, spaces, roadmapItems, onSave, onDelete, onClose }: {
  task: Task
  spaces: Space[]
  roadmapItems: RoadmapItem[]
  tags: string[]
  allTags: string[]
  onSave: (patch: Partial<Task>, tags: string[]) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(task.title)
  // Swipe-down-to-dismiss (drag from the grabber zone)
  const [dragY, setDragY] = useState(0)
  const dragStart = useRef<number | null>(null)
  const saveAndCloseRef = useRef<() => void>(() => {})
  const onDragStart = (clientY: number) => { dragStart.current = clientY }
  const onDragMove = (clientY: number) => {
    if (dragStart.current == null) return
    const dy = clientY - dragStart.current
    if (dy > 0) setDragY(dy)
  }
  const onDragEnd = () => {
    if (dragStart.current == null) return
    dragStart.current = null
    if (dragY > 110) saveAndCloseRef.current()
    else setDragY(0)
  }
  const [description, setDescription] = useState(task.description ?? '')
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagDraft, setTagDraft] = useState('')
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const commitTagDraft = () => {
    const t = tagDraft.trim().toLowerCase().replace(/^#/, '')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagDraft('')
  }
  const [dueDate, setDueDate] = useState<string | null>(task.due_date)
  const [priority, setPriority] = useState<Task['priority']>(task.priority)
  const [spaceId, setSpaceId] = useState<string | null>(task.space_id)
  const [krId, setKrId] = useState<string | null>(task.roadmap_item_id)

  const t = new Date(); t.setHours(0, 0, 0, 0)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1)
  const nextMonday = new Date(t); nextMonday.setDate(t.getDate() + ((8 - t.getDay()) % 7 || 7))

  const activeKRs = roadmapItems
    .filter(r => r.status !== 'abandoned' && r.health_status !== 'done' && r.health_status !== 'failed')
    .filter(r => !spaceId || r.space_id === spaceId)
    .sort((a, b) => a.title.localeCompare(b.title))

  function buildTags() {
    // fold any uncommitted draft into the tag set
    const d = tagDraft.trim().toLowerCase().replace(/^#/, '')
    return d && !tags.includes(d) ? [...tags, d] : tags
  }
  function save() {
    onSave({
      title: title.trim() || task.title,
      description: description.trim() || null,
      due_date: dueDate,
      priority,
      space_id: spaceId,
      roadmap_item_id: krId,
    }, buildTags())
  }
  // Dismissing the sheet (backdrop tap, swipe-down) commits edits — bottom-sheet convention.
  const saveAndClose = () => { save() }
  saveAndCloseRef.current = saveAndClose

  const LBL: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: 'var(--nw-label)', letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 7 }
  const CHIP = (active: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 500, padding: '9px 14px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
    border: active ? '1px solid rgba(77,143,255,.4)' : '1px solid var(--navy-600)',
    background: active ? 'rgba(77,143,255,.14)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--navy-300)',
  })

  return (
    <>
      <div onClick={saveAndClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.55)' }} />
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 71,
        background: 'var(--navy-800)', borderTop: '1px solid var(--navy-600)',
        borderRadius: '18px 18px 0 0',
        padding: '18px 18px calc(20px + env(safe-area-inset-bottom, 0px))',
        maxHeight: '85vh', overflowY: 'auto',
        transform: dragY ? `translateY(${dragY}px)` : undefined,
        transition: dragStart.current == null ? 'transform .2s ease' : 'none',
        animation: dragY ? 'none' : 'sheetUp .18s ease',
        touchAction: dragStart.current != null ? 'none' : undefined,
      }}>
        {/* grabber — drag handle for swipe-to-dismiss */}
        <div
          onTouchStart={e => onDragStart(e.touches[0].clientY)}
          onTouchMove={e => onDragMove(e.touches[0].clientY)}
          onTouchEnd={onDragEnd}
          onMouseDown={e => { onDragStart(e.clientY); const mm = (ev: MouseEvent) => onDragMove(ev.clientY); const mu = () => { onDragEnd(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }; window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu) }}
          style={{ padding: '4px 0 14px', margin: '-4px 0 0', cursor: 'grab', touchAction: 'none' }}
        >
          <div style={{ width: 40, height: 5, borderRadius: 3, background: 'var(--navy-500)', margin: '0 auto' }} />
        </div>

        {/* title */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--navy-900)',
            border: '1px solid var(--navy-600)', borderRadius: 10, padding: '12px 14px',
            fontSize: 16, fontWeight: 600, color: 'var(--navy-50)', fontFamily: 'inherit',
            outline: 'none', marginBottom: 10,
          }}
        />

        {/* description */}
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', background: 'var(--navy-900)',
            border: '1px solid var(--navy-600)', borderRadius: 10, padding: '11px 14px',
            fontSize: 14, lineHeight: 1.5, color: 'var(--navy-100)', fontFamily: 'inherit',
            outline: 'none', marginBottom: 18, resize: 'vertical', minHeight: 76,
          }}
        />

        {/* due date */}
        <div style={{ marginBottom: 18 }}>
          <div style={LBL}>Due</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={CHIP(dueDate === iso(t))} onClick={() => setDueDate(iso(t))}>Today</button>
            <button style={CHIP(dueDate === iso(tomorrow))} onClick={() => setDueDate(iso(tomorrow))}>Tomorrow</button>
            <button style={CHIP(dueDate === iso(nextMonday))} onClick={() => setDueDate(iso(nextMonday))}>Next week</button>
            <input
              type="date"
              value={dueDate ?? ''}
              onChange={e => setDueDate(e.target.value || null)}
              style={{
                background: 'var(--navy-900)', border: '1px solid var(--navy-600)', borderRadius: 8,
                padding: '6px 9px', fontSize: 12, color: 'var(--navy-100)', fontFamily: 'inherit', colorScheme: 'light dark',
              }}
            />
            {dueDate && (
              <button style={{ ...CHIP(false), color: 'var(--navy-400)' }} onClick={() => setDueDate(null)}>Clear</button>
            )}
          </div>
          {(task.recurrence_text || task.recurrence_rule) && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--navy-400)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 13 }}>↻</span> Repeats {task.recurrence_text ?? ''} — completing rolls the date forward
            </div>
          )}
        </div>

        {/* priority */}
        <div style={{ marginBottom: 18 }}>
          <div style={LBL}>Priority</div>
          <div style={{ display: 'flex', gap: 7 }}>
            {([1, 2, 3, 4] as const).map(p => (
              <button key={p}
                onClick={() => setPriority(p)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                  border: priority === p ? `1.5px solid ${PRIORITY_COLOR[p] === 'transparent' ? 'var(--navy-400)' : PRIORITY_COLOR[p]}` : '1px solid var(--navy-600)',
                  background: priority === p ? 'var(--navy-900)' : 'transparent',
                  color: PRIORITY_COLOR[p] === 'transparent' ? 'var(--navy-300)' : PRIORITY_COLOR[p],
                }}
              >P{p}</button>
            ))}
          </div>
        </div>

        {/* tags */}
        <div style={{ marginBottom: 18 }}>
          <div style={LBL}>Tags</div>
          {/* selected tags + Add-tag opener */}
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
            {tags.map(tag => (
              <span key={tag} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12.5, fontWeight: 500, color: 'var(--accent)',
                background: 'var(--accent-dim, rgba(77,143,255,.12))',
                border: '1px solid rgba(77,143,255,.3)',
                borderRadius: 8, padding: '7px 11px',
              }}>
                #{tag}
                <button onClick={() => setTags(prev => prev.filter(x => x !== tag))} aria-label={`Remove ${tag}`} style={{
                  background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
                  padding: 0, fontSize: 13, lineHeight: 1, fontFamily: 'inherit', opacity: .75,
                }}>×</button>
              </span>
            ))}
            {!tagPickerOpen && (
              <button onClick={() => setTagPickerOpen(true)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 12.5, fontWeight: 500, color: 'var(--navy-300)',
                background: 'transparent', border: '1px dashed var(--navy-500)',
                borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit',
              }}>+ {tags.length ? 'Tag' : 'Add tag'}</button>
            )}
          </div>

          {/* picker — opens on tap; existing tags as a wrapped tappable grid, keyboard only when creating new */}
          {tagPickerOpen && (() => {
            const q = tagDraft.trim().toLowerCase().replace(/^#/, '')
            const suggestions = allTags.filter(t => !tags.includes(t) && (!q || t.includes(q)))
            const canCreate = q.length > 0 && !allTags.includes(q) && !tags.includes(q)
            return (
              <div style={{
                marginTop: 10, padding: 12, borderRadius: 12,
                background: 'var(--navy-900)', border: '1px solid var(--navy-600)',
              }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: suggestions.length || canCreate ? 12 : 0 }}>
                  <input
                    autoFocus
                    value={tagDraft}
                    onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); if (canCreate || q) { commitTagDraft() } }
                      if (e.key === 'Escape') { setTagDraft(''); setTagPickerOpen(false) }
                    }}
                    placeholder="Filter or create…"
                    style={{
                      flex: 1, minWidth: 0, background: 'var(--navy-800)',
                      border: '1px solid var(--navy-600)', borderRadius: 8, padding: '9px 12px',
                      fontSize: 16, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                  <button onClick={() => { setTagDraft(''); setTagPickerOpen(false) }} aria-label="Done" style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--accent)', background: 'none',
                    border: 'none', cursor: 'pointer', padding: '8px 4px', fontFamily: 'inherit', flexShrink: 0,
                  }}>Done</button>
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', maxHeight: 168, overflowY: 'auto' }}>
                  {canCreate && (
                    <button onClick={() => { setTags(prev => [...prev, q]); setTagDraft('') }} style={{
                      fontSize: 12.5, fontWeight: 600, color: 'var(--accent)',
                      background: 'var(--accent-dim, rgba(77,143,255,.12))',
                      border: '1px solid rgba(77,143,255,.3)', borderRadius: 8,
                      padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                    }}>+ Create “{q}”</button>
                  )}
                  {suggestions.map(t => (
                    <button key={t}
                      onClick={() => { setTags(prev => [...prev, t]); setTagDraft('') }}
                      style={{
                        fontSize: 12.5, fontWeight: 500,
                        color: 'var(--navy-200)', background: 'var(--navy-700)',
                        border: '1px solid var(--navy-600)', borderRadius: 8,
                        padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}
                    >#{t}</button>
                  ))}
                  {suggestions.length === 0 && !canCreate && (
                    <span style={{ fontSize: 12.5, color: 'var(--navy-500)', padding: '4px 2px' }}>
                      {allTags.length === 0 ? 'No tags yet — type to create one' : 'All tags added'}
                    </span>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

        {/* space */}
        <div style={{ marginBottom: 18 }}>
          <div style={LBL}>Space</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button style={CHIP(spaceId === null)} onClick={() => { setSpaceId(null); setKrId(null) }}>Inbox</button>
            {spaces.map(sp => (
              <button key={sp.id} style={CHIP(spaceId === sp.id)} onClick={() => { setSpaceId(sp.id); if (krId && roadmapItems.find(r => r.id === krId)?.space_id !== sp.id) setKrId(null) }}>
                {sp.name}
              </button>
            ))}
          </div>
        </div>

        {/* KR link */}
        <div style={{ marginBottom: 22 }}>
          <div style={LBL}>Linked KR</div>
          <select
            value={krId ?? ''}
            onChange={e => setKrId(e.target.value || null)}
            style={{
              width: '100%', boxSizing: 'border-box', background: 'var(--navy-900)',
              border: '1px solid var(--navy-600)', borderRadius: 8, padding: '10px 12px',
              fontSize: 13, color: 'var(--navy-100)', fontFamily: 'inherit',
            }}
          >
            <option value="">None</option>
            {activeKRs.map(kr => (
              <option key={kr.id} value={kr.id}>{kr.title}</option>
            ))}
          </select>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { if (confirm('Delete this task?')) onDelete() }}
            style={{
              padding: '12px 16px', borderRadius: 10, border: '1px solid var(--nw-alarm-text)',
              background: 'transparent', color: 'var(--nw-alarm-text)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Delete</button>
          <button
            onClick={save}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 10, border: 'none',
              background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Save</button>
        </div>
      </div>
      <style>{`@keyframes sheetUp { from { transform: translateY(40px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </>
  )
}

// ── section header ────────────────────────────────────────────────────────

function SectionHeader({ label, count, collapsed, onToggle }: {
  label: string; count: number; collapsed?: boolean; onToggle?: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        padding: '16px 18px 6px',
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: onToggle ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 650, color: 'var(--navy-100)', letterSpacing: '-.015em' }}>
        {label}
      </span>
      <span style={{ fontSize: 15, color: 'var(--navy-400)', fontWeight: 400 }}>({count})</span>
      {onToggle && (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--navy-500)', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      )}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────

export default function Tasks({ spaces, activeSpaceId, roadmapItems, tasks, setTasks, tagsByTask, setTagsByTask, toast }: Props) {
  const [scope, setScope] = useState<Scope>({ kind: 'today' })
  const [creating, setCreating] = useState(false)
  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const detailTask = detailTaskId ? tasks.find(t => t.id === detailTaskId) ?? null : null
  const todayStr = today()

  // ── filter by scope ──
  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (t.completed_at) continue
      for (const tag of tagsByTask[t.id] ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([tag]) => tag)
  }, [tasks, tagsByTask])

  const filtered = useMemo(() => {
    const open = tasks.filter(t => !t.completed_at)
    const done = tasks.filter(t => !!t.completed_at)

    if (scope.kind === 'today') {
      return {
        overdue: open.filter(t => t.due_date && t.due_date < todayStr),
        today:   open.filter(t => t.due_date === todayStr),
        upcoming: [],
        none: open.filter(t => !t.due_date),
        done: done.slice(0, 10),
      }
    }
    if (scope.kind === 'overdue') {
      return {
        overdue: open.filter(t => t.due_date && t.due_date < todayStr),
        today: [], upcoming: [], none: [], done: [],
      }
    }
    if (scope.kind === 'inbox') {
      const inbox = open.filter(t => !t.space_id && !t.list_id)
      return { overdue: [], today: [], upcoming: inbox, none: [], done: done.filter(t => !t.space_id && !t.list_id).slice(0, 5) }
    }
    if (scope.kind === 'tag') {
      const tg = open.filter(t => (tagsByTask[t.id] ?? []).includes(scope.tag))
      return {
        overdue: tg.filter(t => t.due_date && t.due_date < todayStr),
        today:   tg.filter(t => t.due_date === todayStr),
        upcoming: tg.filter(t => t.due_date && t.due_date > todayStr),
        none:    tg.filter(t => !t.due_date),
        done:    done.filter(t => (tagsByTask[t.id] ?? []).includes(scope.tag)).slice(0, 5),
      }
    }
    if (scope.kind === 'space') {
      const sp = open.filter(t => t.space_id === scope.spaceId)
      return {
        overdue: sp.filter(t => t.due_date && t.due_date < todayStr),
        today:   sp.filter(t => t.due_date === todayStr),
        upcoming: sp.filter(t => t.due_date && t.due_date > todayStr),
        none:    sp.filter(t => !t.due_date),
        done:    done.filter(t => t.space_id === scope.spaceId).slice(0, 5),
      }
    }
    // all
    return {
      overdue: open.filter(t => t.due_date && t.due_date < todayStr),
      today:   open.filter(t => t.due_date === todayStr),
      upcoming: open.filter(t => t.due_date && t.due_date > todayStr),
      none:    open.filter(t => !t.due_date),
      done:    done.slice(0, 10),
    }
  }, [tasks, scope, todayStr, tagsByTask])

  const overdueCount = tasks.filter(t => !t.completed_at && t.due_date && t.due_date < todayStr).length
  const todayCount   = tasks.filter(t => !t.completed_at && t.due_date === todayStr).length

  async function handleToggle(task: Task) {
    // Optimistic
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed_at: t.completed_at ? null : new Date().toISOString() } : t))
    try {
      const updated = await tasksDb.toggleComplete(task)
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    } catch {
      // revert
      setTasks(prev => prev.map(t => t.id === task.id ? task : t))
      toast('Failed to update task')
    }
  }

  async function handleCreate(title: string) {
    const spaceId = scope.kind === 'space' ? scope.spaceId : (scope.kind === 'inbox' ? null : activeSpaceId)
    try {
      const task = await tasksDb.create({ title, space_id: spaceId })
      setTasks(prev => [task, ...prev])
      setCreating(false)
    } catch {
      toast('Failed to create task')
    }
  }

  async function handleDelete(task: Task) {
    setTasks(prev => prev.filter(t => t.id !== task.id))
    try {
      await tasksDb.remove(task.id)
    } catch {
      setTasks(prev => [task, ...prev])
      toast('Failed to delete task')
    }
  }

  async function handleSavePatch(task: Task, patch: Partial<Task>, tags: string[]) {
    const prevTags = tagsByTask[task.id] ?? []
    const clean = Array.from(new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean)))
    const tagsChanged = JSON.stringify(clean) !== JSON.stringify(prevTags)
    // Optimistic
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t))
    if (tagsChanged) setTagsByTask(prev => ({ ...prev, [task.id]: clean }))
    setDetailTaskId(null)
    try {
      const [updated] = await Promise.all([
        tasksDb.update(task.id, patch),
        tagsChanged ? tasksDb.setTags(task.id, clean) : Promise.resolve(),
      ])
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    } catch {
      setTasks(prev => prev.map(t => t.id === task.id ? task : t))
      if (tagsChanged) setTagsByTask(prev => ({ ...prev, [task.id]: prevTags }))
      toast('Failed to save task')
    }
  }

  function renderTask(task: Task) {
    return (
      <TaskRow
                  spaces={spaces}
        key={task.id}
        task={task}
        tags={tagsByTask[task.id] ?? []}
        roadmapItems={roadmapItems}
        onToggle={() => handleToggle(task)}
        onOpen={() => setDetailTaskId(task.id)}
      />
    )
  }

  const allSections = [
    ...(filtered.overdue.length > 0 ? [
      <SectionHeader key="ov-h" label="Overdue" count={filtered.overdue.length} />,
      ...filtered.overdue.map(renderTask),
    ] : []),
    ...(filtered.today.length > 0 ? [
      <SectionHeader key="td-h" label="Today" count={filtered.today.length} />,
      ...filtered.today.map(renderTask),
    ] : []),
    ...(filtered.upcoming.length > 0 ? [
      <SectionHeader key="up-h" label={scope.kind === 'inbox' ? 'Tasks' : 'Upcoming'} count={filtered.upcoming.length} />,
      ...filtered.upcoming.map(renderTask),
    ] : []),
    ...(filtered.none.length > 0 ? [
      <SectionHeader key="no-h" label="No date" count={filtered.none.length} />,
      ...filtered.none.map(renderTask),
    ] : []),
  ]

  const isEmpty = allSections.length === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--navy-900)' }}>

      {/* top bar */}
      <div style={{
        padding: '12px 16px 10px',
        borderBottom: '1px solid var(--navy-700)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', letterSpacing: '-.025em' }}>Tasks</span>
      </div>

      {/* scope chips */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 16px',
        borderBottom: '1px solid var(--navy-700)', flexShrink: 0,
        scrollbarWidth: 'none',
      }}>
        {([
          { s: { kind: 'today' } as Scope,   label: `Today${todayCount ? ` · ${todayCount}` : ''}` },
          { s: { kind: 'overdue' } as Scope, label: `Overdue${overdueCount ? ` · ${overdueCount}` : ''}`, urgent: overdueCount > 0 },
          { s: { kind: 'inbox' } as Scope,   label: 'Inbox' },
          { s: { kind: 'all' } as Scope,     label: 'All' },
          ...spaces.map(sp => ({ s: { kind: 'space', spaceId: sp.id } as Scope, label: sp.name })),
          ...allTags.map(tag => ({ s: { kind: 'tag', tag } as Scope, label: `#${tag}` })),
        ]).map(({ s, label, urgent }) => {
          const isActive = JSON.stringify(scope) === JSON.stringify(s)
          return (
            <button
              key={label}
              onClick={() => setScope(s)}
              style={{
                flexShrink: 0, fontSize: 11, fontWeight: 500,
                padding: '4px 11px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap',
                border: isActive
                  ? `1px solid ${urgent ? 'var(--nw-alarm-text)' : 'rgba(77,143,255,.38)'}`
                  : '1px solid var(--navy-600)',
                background: isActive
                  ? `${urgent ? 'var(--nw-alarm-bg, rgba(255,100,82,.14))' : 'rgba(77,143,255,.14)'}`
                  : 'transparent',
                color: isActive
                  ? (urgent ? 'var(--nw-alarm-text)' : 'var(--accent)')
                  : (urgent ? 'var(--nw-alarm-text)' : 'var(--navy-300)'),
              }}
            >{label}</button>
          )
        })}
      </div>

      {/* list */}
      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none', paddingBottom: 100 }}>

        {isEmpty && !creating && (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--navy-500)', fontSize: 13 }}>
            {scope.kind === 'overdue' ? 'No overdue tasks 🎉' :
             scope.kind === 'today'   ? 'Nothing due today' :
             scope.kind === 'inbox'   ? 'Inbox is clear' : 'No tasks'}
          </div>
        )}

        {allSections}

        {/* add task — persistent ghost card; becomes the inline create in place */}
        {creating ? (
          <InlineCreate
            onSave={handleCreate}
            onCancel={() => setCreating(false)}
            spaceId={scope.kind === 'space' ? scope.spaceId : null}
          />
        ) : (
          <button
            onClick={() => setCreating(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              margin: '4px 14px 10px', borderRadius: 14, width: 'calc(100% - 28px)',
              background: 'transparent', border: '1px dashed var(--navy-500)',
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <span style={{
              width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--navy-500)',
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--navy-400)', fontSize: 18, fontWeight: 300, lineHeight: 1,
            }}>+</span>
            <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--navy-300)' }}>Add task</span>
          </button>
        )}

        {/* Done section */}
        {filtered.done.length > 0 && (
          <>
            <SectionHeader
              label="Done"
              count={filtered.done.length}
              collapsed={doneCollapsed}
              onToggle={() => setDoneCollapsed(o => !o)}
            />
            {!doneCollapsed && filtered.done.map(renderTask)}
          </>
        )}
      </div>

      {/* Detail sheet */}
      {detailTask && (
        <TaskDetailSheet
          key={detailTask.id}
          task={detailTask}
          tags={tagsByTask[detailTask.id] ?? []}
          allTags={allTags}
          spaces={spaces}
          roadmapItems={roadmapItems}
          onSave={(patch, tags) => handleSavePatch(detailTask, patch, tags)}
          onDelete={() => { handleDelete(detailTask); setDetailTaskId(null) }}
          onClose={() => setDetailTaskId(null)}
        />
      )}
    </div>
  )
}
