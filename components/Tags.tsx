'use client'
/**
 * Tags — the cross-app browsing view. Shows every tag in use across
 * tasks and notes, with split counts (Tasks vs Notes). Clicking a tag
 * surfaces a mixed item list (interleaved by recency); clicking an
 * item jumps to its source app with that item selected.
 *
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │ Tag list     │ Items panel                              │
 *   │ alpha-sorted │ Header (#tag + counts + Tasks/Notes/All) │
 *   │ split counts │ Interleaved tasks + notes by recency     │
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * Read-only browser: no edits happen here. Housekeeping (rename/merge/
 * delete) is a follow-up tier.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Space, Task, Note, TaskTag, NoteTag } from '@/lib/types'
import * as tasksDb from '@/lib/db/tasks'
import * as notesDb from '@/lib/db/notes'
import * as tagsDb from '@/lib/db/tags'

interface Props {
  spaces: Space[]
  /** Called when the user picks an item — page-level routing handles the jump. */
  onJumpToTask: (taskId: string) => void
  onJumpToNote: (noteId: string) => void
  /** Initial tag to focus, or null for first available. */
  initialTag?: string | null
  toast: (msg: string) => void
}

type ItemFilter = 'all' | 'tasks' | 'notes'

interface TagSummary {
  tag: string
  taskCount: number
  noteCount: number
  total: number
}

export default function Tags({ spaces, onJumpToTask, onJumpToNote, initialTag, toast }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [taskTagRows, setTaskTagRows] = useState<TaskTag[]>([])
  const [noteTagRows, setNoteTagRows] = useState<NoteTag[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag ?? null)
  const [filterMode, setFilterMode] = useState<ItemFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // Housekeeping UI state — only one tag in active mutation mode at a time.
  const [menuOpenTag, setMenuOpenTag] = useState<string | null>(null)
  const [renamingTag, setRenamingTag] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [mergingTag, setMergingTag] = useState<string | null>(null)
  const [deletingTag, setDeletingTag] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  // Load everything once.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [t, n] = await Promise.all([tasksDb.listAll(), notesDb.listAll()])
        if (cancelled) return
        setTasks(t)
        setNotes(n)
        const [tt, nt] = await Promise.all([
          tasksDb.listTagsForTasks(t.map(x => x.id)),
          notesDb.listTagsForNotes(n.map(x => x.id)),
        ])
        if (cancelled) return
        setTaskTagRows(tt)
        setNoteTagRows(nt)
      } catch (e) {
        console.error('tags load failed', e)
        toast('Failed to load tags')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [toast])

  // task_id → tag[] and note_id → tag[]
  const taskTagsById = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const row of taskTagRows) {
      const arr = m.get(row.task_id) ?? []
      arr.push(row.tag)
      m.set(row.task_id, arr)
    }
    return m
  }, [taskTagRows])
  const noteTagsById = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const row of noteTagRows) {
      const arr = m.get(row.note_id) ?? []
      arr.push(row.tag)
      m.set(row.note_id, arr)
    }
    return m
  }, [noteTagRows])

  // Build the tag summary table (alpha-sorted by tag name).
  const tagSummaries: TagSummary[] = useMemo(() => {
    const counts = new Map<string, TagSummary>()
    function bump(tag: string, kind: 'task' | 'note') {
      let s = counts.get(tag)
      if (!s) { s = { tag, taskCount: 0, noteCount: 0, total: 0 }; counts.set(tag, s) }
      if (kind === 'task') s.taskCount++
      else s.noteCount++
      s.total++
    }
    for (const row of taskTagRows) bump(row.tag, 'task')
    for (const row of noteTagRows) bump(row.tag, 'note')
    return Array.from(counts.values()).sort((a, b) => a.tag.localeCompare(b.tag))
  }, [taskTagRows, noteTagRows])

  // Filter the tag list by the search box.
  const visibleTags = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return tagSummaries
    return tagSummaries.filter(s => s.tag.toLowerCase().includes(q))
  }, [tagSummaries, searchQuery])

  // Default selection: if nothing chosen yet but tags exist, pick the first one.
  useEffect(() => {
    if (selectedTag === null && tagSummaries.length > 0) {
      setSelectedTag(tagSummaries[0].tag)
    }
  }, [selectedTag, tagSummaries])

  // Build the right-pane item list for the selected tag.
  // Tasks and notes are interleaved by their `updated_at` so the most
  // recent activity floats to the top.
  type RowItem =
    | { kind: 'task'; task: Task; ts: number }
    | { kind: 'note'; note: Note; ts: number }

  const items: RowItem[] = useMemo(() => {
    if (!selectedTag) return []
    const out: RowItem[] = []
    if (filterMode !== 'notes') {
      for (const task of tasks) {
        if ((taskTagsById.get(task.id) ?? []).includes(selectedTag)) {
          out.push({ kind: 'task', task, ts: Date.parse(task.updated_at) })
        }
      }
    }
    if (filterMode !== 'tasks') {
      for (const note of notes) {
        if ((noteTagsById.get(note.id) ?? []).includes(selectedTag)) {
          out.push({ kind: 'note', note, ts: Date.parse(note.updated_at) })
        }
      }
    }
    out.sort((a, b) => b.ts - a.ts)
    return out
  }, [selectedTag, filterMode, tasks, notes, taskTagsById, noteTagsById])

  const selectedSummary = selectedTag ? tagSummaries.find(s => s.tag === selectedTag) ?? null : null

  // ── Mutations ────────────────────────────────────────────────────

  /** Re-pull tag rows after a mutation. The task/note row arrays don't
   *  change; only the join-table mappings do. */
  const reloadTags = useCallback(async () => {
    try {
      const [tt, nt] = await Promise.all([
        tasksDb.listTagsForTasks(tasks.map(x => x.id)),
        notesDb.listTagsForNotes(notes.map(x => x.id)),
      ])
      setTaskTagRows(tt)
      setNoteTagRows(nt)
    } catch (e) {
      console.error('reload tags failed', e)
      toast('Failed to refresh tags')
    }
  }, [tasks, notes, toast])

  const onRenameCommit = useCallback(async (from: string, to: string) => {
    const trimmed = to.trim().toLowerCase().replace(/^#/, '')
    setRenamingTag(null)
    if (!trimmed || trimmed === from) return
    // Was the target tag already in use? Then this becomes a merge.
    const targetExisted = await tagsDb.exists(trimmed)
    setWorking(true)
    try {
      const finalTag = await tagsDb.rename(from, trimmed)
      await reloadTags()
      if (selectedTag === from) setSelectedTag(finalTag)
      toast(targetExisted ? `Merged #${from} into #${finalTag}` : `Renamed to #${finalTag}`)
    } catch (e) {
      console.error('rename failed', e)
      toast('Could not rename tag')
    } finally {
      setWorking(false)
    }
  }, [reloadTags, selectedTag, toast])

  const onMergeCommit = useCallback(async (source: string, target: string) => {
    setMergingTag(null)
    if (!target || target === source) return
    setWorking(true)
    try {
      await tagsDb.merge(source, target)
      await reloadTags()
      if (selectedTag === source) setSelectedTag(target)
      toast(`Merged #${source} into #${target}`)
    } catch (e) {
      console.error('merge failed', e)
      toast('Could not merge tag')
    } finally {
      setWorking(false)
    }
  }, [reloadTags, selectedTag, toast])

  const onDeleteCommit = useCallback(async (tag: string) => {
    setDeletingTag(null)
    setWorking(true)
    try {
      await tagsDb.remove(tag)
      await reloadTags()
      if (selectedTag === tag) setSelectedTag(null)
      toast(`Deleted #${tag}`)
    } catch (e) {
      console.error('delete failed', e)
      toast('Could not delete tag')
    } finally {
      setWorking(false)
    }
  }, [reloadTags, selectedTag, toast])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--navy-400)', fontSize: 13 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: 'calc(100vh - 0px)', minHeight: 0 }}>

      {/* ── LEFT: tag list ── */}
      <aside style={{ background: 'var(--navy-800)', borderRight: '1px solid var(--navy-600)', overflowY: 'auto' }}>
        <div style={{ padding: '20px 18px 10px' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy-50)' }}>Tags</div>
          <div style={{ fontSize: 11.5, color: 'var(--navy-400)', marginTop: 2 }}>Across all tasks and notes</div>
        </div>
        <div style={{ padding: '0 12px 10px' }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter tags…"
            style={{
              width: '100%', padding: '6px 10px', fontSize: 12.5,
              background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 5,
              color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none',
            }} />
        </div>
        {tagSummaries.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--navy-400)', fontSize: 12.5 }}>
            No tags yet. Add one on a task or note.
          </div>
        ) : (
          <div style={{ padding: '0 6px 20px' }}>
            {visibleTags.map(s => (
              <TagRow
                key={s.tag}
                summary={s}
                active={s.tag === selectedTag}
                menuOpen={menuOpenTag === s.tag}
                renaming={renamingTag === s.tag}
                renameDraft={renameDraft}
                setRenameDraft={setRenameDraft}
                disabled={working}
                onSelect={() => setSelectedTag(s.tag)}
                onOpenMenu={() => setMenuOpenTag(s.tag)}
                onCloseMenu={() => setMenuOpenTag(null)}
                onStartRename={() => { setRenamingTag(s.tag); setRenameDraft(s.tag); setMenuOpenTag(null) }}
                onCommitRename={() => onRenameCommit(s.tag, renameDraft)}
                onCancelRename={() => setRenamingTag(null)}
                onStartMerge={() => { setMergingTag(s.tag); setMenuOpenTag(null) }}
                onStartDelete={() => { setDeletingTag(s.tag); setMenuOpenTag(null) }}
              />
            ))}
            {visibleTags.length === 0 && (
              <div style={{ padding: 18, textAlign: 'center', color: 'var(--navy-400)', fontSize: 12 }}>
                No matches.
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── RIGHT: items panel ── */}
      <section style={{ overflowY: 'auto' }}>
        {selectedSummary ? (
          <>
            {/* Header */}
            <div style={{
              padding: '20px 28px 12px', borderBottom: '1px solid var(--navy-700)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy-50)', display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ color: 'var(--navy-400)', fontWeight: 500 }}>#</span>{selectedSummary.tag}
                </div>
                <div style={{ fontSize: 12, color: 'var(--navy-400)', marginTop: 2 }}>
                  {selectedSummary.total} {selectedSummary.total === 1 ? 'item' : 'items'} ·{' '}
                  {selectedSummary.taskCount} {selectedSummary.taskCount === 1 ? 'task' : 'tasks'},{' '}
                  {selectedSummary.noteCount} {selectedSummary.noteCount === 1 ? 'note' : 'notes'}
                </div>
              </div>
              <FilterPills value={filterMode} onChange={setFilterMode} />
            </div>

            {/* Items */}
            <div style={{ padding: '8px 16px 40px' }}>
              {items.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--navy-400)', fontSize: 13 }}>
                  No {filterMode === 'all' ? 'items' : filterMode} for this tag.
                </div>
              ) : (
                items.map(item =>
                  item.kind === 'task'
                    ? <TaskRow key={`t-${item.task.id}`} task={item.task} spaces={spaces} onClick={() => onJumpToTask(item.task.id)} />
                    : <NoteRow key={`n-${item.note.id}`} note={item.note} spaces={spaces} onClick={() => onJumpToNote(item.note.id)} />
                )
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--navy-400)', fontSize: 13 }}>
            {tagSummaries.length === 0 ? 'No tags in use yet.' : 'Pick a tag on the left.'}
          </div>
        )}
      </section>

      {mergingTag && (
        <MergePicker
          source={mergingTag}
          allTags={tagSummaries.map(s => s.tag)}
          onCommit={target => onMergeCommit(mergingTag, target)}
          onCancel={() => setMergingTag(null)}
        />
      )}
      {deletingTag && (
        <DeleteDialog
          tag={deletingTag}
          summary={tagSummaries.find(s => s.tag === deletingTag) ?? null}
          onConfirm={() => onDeleteCommit(deletingTag)}
          onCancel={() => setDeletingTag(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function FilterPills({ value, onChange }: { value: ItemFilter; onChange: (v: ItemFilter) => void }) {
  return (
    <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: 'var(--navy-700)', borderRadius: 6 }}>
      {(['all', 'tasks', 'notes'] as const).map(v => {
        const active = value === v
        return (
          <button key={v} onClick={() => onChange(v)}
            style={{
              background: active ? 'var(--navy-800)' : 'none',
              color: active ? 'var(--navy-50)' : 'var(--navy-300)',
              border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11.5, fontWeight: active ? 600 : 500, fontFamily: 'inherit',
              boxShadow: active ? '0 0 0 0.5px var(--navy-500)' : 'none',
            }}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        )
      })}
    </div>
  )
}

const PRIORITY_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: 'var(--red-text)',
  2: '#e88c52',
  3: '#d4b04c',
  4: 'transparent',
}

function TaskRow({ task, spaces, onClick }: { task: Task; spaces: Space[]; onClick: () => void }) {
  const space = task.space_id ? spaces.find(s => s.id === task.space_id) : null
  const done = !!task.completed_at
  return (
    <button onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
        background: 'none', textAlign: 'left', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-800)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      {/* Type stripe */}
      <span style={{ width: 3, alignSelf: 'stretch', background: 'rgba(91,141,239,0.35)', borderRadius: 99, flexShrink: 0 }} />
      {/* Checkbox (visual only — clicks fall through to onClick which jumps) */}
      <span style={{
        width: 17, height: 17, borderRadius: '50%', flexShrink: 0, marginTop: 2,
        border: `1.5px solid ${done ? 'var(--teal-text)' : 'var(--navy-400)'}`,
        background: done ? 'var(--teal-text)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 10,
      }}>
        {done && '✓'}
      </span>
      {/* Priority */}
      <span style={{ width: 9, height: 9, borderRadius: 2, marginTop: 6, flexShrink: 0, background: PRIORITY_COLOR[task.priority] }} />
      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: done ? 'var(--navy-400)' : 'var(--navy-50)', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3, fontSize: 10.5, color: 'var(--navy-400)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--navy-700)', color: 'var(--navy-200)', letterSpacing: 0.2 }}>TASK</span>
          {space && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: space.color }} />
            {space.name}
          </span>}
          {task.due_date && <span style={{ color: dueColor(task.due_date, done) }}>{formatDue(task.due_date)}</span>}
          {done && <span>Completed</span>}
        </div>
      </div>
    </button>
  )
}

function NoteRow({ note, spaces, onClick }: { note: Note; spaces: Space[]; onClick: () => void }) {
  const space = spaces.find(s => s.id === note.space_id)
  const preview = useMemo(() => extractText(note.body).slice(0, 140), [note.body])
  return (
    <button onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '10px 14px', border: 'none', borderRadius: 6, cursor: 'pointer',
        background: 'none', textAlign: 'left', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-800)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      <span style={{ width: 3, alignSelf: 'stretch', background: 'rgba(139,92,246,0.35)', borderRadius: 99, flexShrink: 0 }} />
      <span style={{ width: 16, height: 16, flexShrink: 0, marginTop: 2, color: 'var(--navy-400)' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1.7h7.5L13 4.2v10.1H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M5.5 6.5h5M5.5 9h5M5.5 11.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: note.title ? 'var(--navy-50)' : 'var(--navy-400)', fontStyle: note.title ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note.title || 'Untitled'}
        </div>
        {preview && (
          <div style={{ fontSize: 11.5, color: 'var(--navy-300)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
            {preview}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 3, fontSize: 10.5, color: 'var(--navy-400)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--navy-700)', color: 'var(--navy-200)', letterSpacing: 0.2 }}>NOTE</span>
          {space && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: space.color }} />
            {space.name}
          </span>}
          <span>{formatRelative(note.updated_at)}</span>
        </div>
      </div>
    </button>
  )
}

// ── TagRow (left-pane row with hover-kebab + inline rename) ────────

function TagRow(props: {
  summary: TagSummary
  active: boolean
  menuOpen: boolean
  renaming: boolean
  renameDraft: string
  setRenameDraft: (v: string) => void
  disabled: boolean
  onSelect: () => void
  onOpenMenu: () => void
  onCloseMenu: () => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartMerge: () => void
  onStartDelete: () => void
}) {
  const { summary: s, active, menuOpen, renaming } = props
  const [hover, setHover] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) props.onCloseMenu()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (renaming) {
    return (
      <input autoFocus
        value={props.renameDraft}
        onChange={e => props.setRenameDraft(e.target.value)}
        onBlur={props.onCommitRename}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') props.onCancelRename()
        }}
        style={{
          width: '100%', padding: '7px 12px',
          background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
          borderRadius: 6, color: 'var(--navy-50)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
        }} />
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={props.onSelect}
        disabled={props.disabled}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: active ? 'var(--accent-dim)' : (hover ? 'var(--navy-600)' : 'none'),
          color: active ? 'var(--accent)' : 'var(--navy-100)',
          fontSize: 13, fontWeight: active ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
          transition: 'background .15s',
        }}>
        <span style={{ width: 12, textAlign: 'center', color: active ? 'var(--accent)' : 'var(--navy-400)', fontWeight: 500 }}>#</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.tag}</span>
        {!hover && (
          <span style={{ display: 'inline-flex', gap: 3 }}>
            {s.taskCount > 0 && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'rgba(91,141,239,0.18)', color: '#5b8def', letterSpacing: 0.2 }}>
                {s.taskCount}T
              </span>
            )}
            {s.noteCount > 0 && (
              <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 99, background: 'rgba(139,92,246,0.18)', color: '#8b5cf6', letterSpacing: 0.2 }}>
                {s.noteCount}N
              </span>
            )}
          </span>
        )}
      </button>

      {hover && (
        <button onClick={e => { e.stopPropagation(); props.onOpenMenu() }}
          title="Tag actions"
          style={{
            position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: '2px 4px', borderRadius: 3,
            color: 'var(--navy-300)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-500)'; e.currentTarget.style.color = 'var(--navy-50)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--navy-300)' }}>
          ⋯
        </button>
      )}

      {menuOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 4, zIndex: 30, marginTop: 2,
          background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 6,
          padding: 4, minWidth: 150, boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}>
          <button onClick={props.onStartRename} style={tagMenuItemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Rename
          </button>
          <button onClick={props.onStartMerge} style={tagMenuItemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Merge into…
          </button>
          <button onClick={props.onStartDelete} style={{ ...tagMenuItemStyle, color: 'var(--red-text)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

const tagMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
  padding: '6px 10px', fontSize: 12, color: 'var(--navy-100)', cursor: 'pointer',
  borderRadius: 4, fontFamily: 'inherit',
}

// ── MergePicker (modal with searchable tag list) ───────────────────

function MergePicker({ source, allTags, onCommit, onCancel }: {
  source: string; allTags: string[]; onCommit: (target: string) => void; onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTags
      .filter(t => t !== source)
      .filter(t => !q || t.toLowerCase().includes(q))
  }, [allTags, source, query])

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, width: 400, maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '18px 20px 10px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--navy-50)' }}>Merge <span style={{ color: 'var(--accent)' }}>#{source}</span> into…</div>
          <div style={{ fontSize: 12, color: 'var(--navy-400)', marginTop: 4 }}>All items will get the target tag. <code style={{ fontFamily: 'inherit', color: 'var(--navy-200)' }}>#{source}</code> will be removed.</div>
        </div>
        <div style={{ padding: '0 14px 8px' }}>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Pick a target tag…"
            style={{
              width: '100%', padding: '8px 12px',
              background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 6,
              color: 'var(--navy-50)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
            }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }}>
          {candidates.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--navy-400)', fontSize: 12.5 }}>
              {allTags.length <= 1 ? 'No other tags to merge into.' : 'No matches.'}
            </div>
          ) : (
            candidates.map(t => (
              <button key={t} onClick={() => onCommit(t)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', border: 'none', borderRadius: 5, cursor: 'pointer',
                  background: 'none', color: 'var(--navy-100)', fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                <span style={{ width: 12, textAlign: 'center', color: 'var(--navy-400)' }}>#</span>
                <span>{t}</span>
              </button>
            ))
          )}
        </div>
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--navy-700)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '6px 14px', background: 'none', border: '1px solid var(--navy-600)', borderRadius: 5, color: 'var(--navy-200)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DeleteDialog ───────────────────────────────────────────────────

function DeleteDialog({ tag, summary, onConfirm, onCancel }: {
  tag: string; summary: TagSummary | null; onConfirm: () => void; onCancel: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])
  const t = summary?.taskCount ?? 0
  const n = summary?.noteCount ?? 0
  const impact = [
    t > 0 && `${t} ${t === 1 ? 'task' : 'tasks'}`,
    n > 0 && `${n} ${n === 1 ? 'note' : 'notes'}`,
  ].filter(Boolean).join(' and ')
  return (
    <div onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, width: 380, maxWidth: '100%', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '20px 22px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 6 }}>
            Delete <span style={{ color: 'var(--red-text)' }}>#{tag}</span>?
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--navy-300)', lineHeight: 1.5 }}>
            {impact ? <>This will remove the tag from <strong style={{ color: 'var(--navy-100)' }}>{impact}</strong>. The items themselves will not be deleted.</> : <>The tag isn't used anywhere.</>}
          </div>
        </div>
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--navy-700)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel}
            style={{ padding: '6px 14px', background: 'none', border: '1px solid var(--navy-600)', borderRadius: 5, color: 'var(--navy-200)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>
          <button autoFocus onClick={onConfirm}
            style={{ padding: '6px 14px', background: 'var(--red-text)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Delete tag
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

function extractText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const out: string[] = []
  function walk(n: unknown) {
    if (!n || typeof n !== 'object') return
    const node = n as Record<string, unknown>
    if (typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.content)) for (const c of node.content) walk(c)
  }
  walk(body)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDue(iso: string): string {
  const d = parseLocal(iso)
  const now = new Date()
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tom = new Date(todayLocal); tom.setDate(todayLocal.getDate() + 1)
  if (d.getTime() === todayLocal.getTime()) return 'Today'
  if (d.getTime() === tom.getTime()) return 'Tomorrow'
  if (d.getTime() < todayLocal.getTime()) {
    const days = Math.round((todayLocal.getTime() - d.getTime()) / 86400000)
    return `${days}d overdue`
  }
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function dueColor(iso: string, done: boolean): string {
  if (done) return 'var(--navy-400)'
  const d = parseLocal(iso)
  const now = new Date()
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (d.getTime() < todayLocal.getTime()) return 'var(--red-text)'
  if (d.getTime() === todayLocal.getTime()) return 'var(--accent)'
  return 'var(--navy-300)'
}

function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
