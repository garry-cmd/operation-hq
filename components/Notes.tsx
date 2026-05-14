'use client'
/**
 * Notes — the real module. Tier 1 of the notes-integration-plan:
 *
 *   ┌──────────────┬──────────────┬─────────────────────────────┐
 *   │ Notebook     │ Note list    │ Editor (TipTap)             │
 *   │ tree per     │ for the      │ Title + fixed toolbar +     │
 *   │ space; Inbox │ selected     │ block-style body. Autosave  │
 *   │ + Tags below.│ scope.       │ debounced ~1.5s after idle. │
 *   └──────────────┴──────────────┴─────────────────────────────┘
 *
 * Schema cap is 2 levels (Stack → Notebook). Notes can live loose at
 * the space level ("Inbox") or inside a notebook. Tag namespace is
 * shared with Tasks — same string set, separate join table.
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Space, Notebook, Note, NoteTag, NoteBody } from '@/lib/types'
import * as notebooksDb from '@/lib/db/notebooks'
import * as notesDb from '@/lib/db/notes'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import type { Content } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  toast: (msg: string) => void
}

// What's selected in the left pane. 'inbox' = loose notes for a space;
// 'notebook' = a specific notebook (and, where it has children, its
// descendants too); 'tag' = the cross-space tag filter.
type Scope =
  | { kind: 'inbox'; spaceId: string }
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'tag'; tag: string }

const EMPTY_DOC: NoteBody = { type: 'doc', content: [{ type: 'paragraph' }] }

export default function Notes({ spaces, activeSpaceId, toast }: Props) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [tagsByNote, setTagsByNote] = useState<Map<string, string[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<Scope>({ kind: 'inbox', spaceId: activeSpaceId })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  // Left-pane UI state
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(() => new Set([activeSpaceId]))
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set())
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [newNotebookFor, setNewNotebookFor] = useState<{ spaceId: string; parentId: string | null } | null>(null)
  const [newNotebookDraft, setNewNotebookDraft] = useState('')
  const [fullscreen, setFullscreen] = useState(false)

  // ── Load everything on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [nbRows, nRows] = await Promise.all([
          notebooksDb.listAll(),
          notesDb.listAll(),
        ])
        if (cancelled) return
        setNotebooks(nbRows)
        setNotes(nRows)
        const tagRows = await notesDb.listTagsForNotes(nRows.map(n => n.id))
        if (cancelled) return
        const map = new Map<string, string[]>()
        for (const row of tagRows) {
          const arr = map.get(row.note_id) ?? []
          arr.push(row.tag)
          map.set(row.note_id, arr)
        }
        setTagsByNote(map)
      } catch (e) {
        console.error('notes load failed', e)
        toast('Failed to load notes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [toast])

  // Derived: notebooks grouped by space, and by parent for nesting.
  const notebooksBySpace = useMemo(() => {
    const map = new Map<string, Notebook[]>()
    for (const nb of notebooks) {
      if (nb.parent_notebook_id !== null) continue // top-level only here
      const arr = map.get(nb.space_id) ?? []
      arr.push(nb)
      map.set(nb.space_id, arr)
    }
    return map
  }, [notebooks])

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Notebook[]>()
    for (const nb of notebooks) {
      if (nb.parent_notebook_id === null) continue
      const arr = map.get(nb.parent_notebook_id) ?? []
      arr.push(nb)
      map.set(nb.parent_notebook_id, arr)
    }
    return map
  }, [notebooks])

  // All note tags currently in use (for the left-pane Tags section).
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const arr of tagsByNote.values()) for (const t of arr) set.add(t)
    return Array.from(set).sort()
  }, [tagsByNote])

  // Counts shown next to sidebar entries.
  const counts = useMemo(() => {
    const byInbox: Record<string, number> = {}
    const byNotebook: Record<string, number> = {}
    const byTag: Record<string, number> = {}
    for (const n of notes) {
      if (n.notebook_id === null) {
        byInbox[n.space_id] = (byInbox[n.space_id] ?? 0) + 1
      } else {
        byNotebook[n.notebook_id] = (byNotebook[n.notebook_id] ?? 0) + 1
      }
    }
    for (const tag of allTags) {
      byTag[tag] = notes.filter(n => (tagsByNote.get(n.id) ?? []).includes(tag)).length
    }
    return { byInbox, byNotebook, byTag }
  }, [notes, allTags, tagsByNote])

  // Notes filtered to the current scope. For a notebook scope, include
  // notes from descendant notebooks too — Stack-level selection should
  // surface everything underneath.
  const filteredNotes = useMemo(() => {
    if (scope.kind === 'inbox') {
      return notes
        .filter(n => n.space_id === scope.spaceId && n.notebook_id === null)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    }
    if (scope.kind === 'notebook') {
      const ids = new Set<string>([scope.notebookId])
      const children = childrenByParent.get(scope.notebookId) ?? []
      for (const c of children) ids.add(c.id)
      return notes
        .filter(n => n.notebook_id && ids.has(n.notebook_id))
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    }
    // tag
    return notes
      .filter(n => (tagsByNote.get(n.id) ?? []).includes(scope.tag))
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
  }, [notes, scope, childrenByParent, tagsByNote])

  const selectedNote = useMemo(
    () => selectedNoteId ? notes.find(n => n.id === selectedNoteId) ?? null : null,
    [notes, selectedNoteId],
  )

  // Heading for the middle pane.
  const middleHeading = useMemo(() => {
    if (scope.kind === 'inbox') {
      const space = spaces.find(s => s.id === scope.spaceId)
      return space ? `${space.name} · Inbox` : 'Inbox'
    }
    if (scope.kind === 'notebook') {
      const nb = notebooks.find(n => n.id === scope.notebookId)
      return nb?.name ?? 'Notebook'
    }
    return `#${scope.tag}`
  }, [scope, spaces, notebooks])

  // ── Mutations ────────────────────────────────────────────────────

  const onCreateNotebook = useCallback(async (spaceId: string, parentId: string | null, name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const created = await notebooksDb.create({ space_id: spaceId, parent_notebook_id: parentId, name: clean })
      setNotebooks(prev => [...prev, created])
      setExpandedSpaces(prev => new Set(prev).add(spaceId))
      if (parentId) setExpandedNotebooks(prev => new Set(prev).add(parentId))
      setScope({ kind: 'notebook', notebookId: created.id })
      setSelectedNoteId(null)
    } catch (e) {
      console.error('create notebook failed', e)
      toast('Could not create notebook')
    }
  }, [toast])

  const onRenameNotebook = useCallback(async (id: string, name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const updated = await notebooksDb.rename(id, clean)
      setNotebooks(prev => prev.map(n => n.id === id ? updated : n))
    } catch (e) {
      console.error('rename notebook failed', e)
      toast('Could not rename notebook')
    }
  }, [toast])

  const onDeleteNotebook = useCallback(async (id: string) => {
    try {
      await notebooksDb.remove(id)
      // ON DELETE CASCADE removes child notebooks; notes go to "Inbox"
      // (notebook_id ON DELETE SET NULL). Mirror that locally.
      const cascade = new Set<string>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const nb of notebooks) {
          if (nb.parent_notebook_id && cascade.has(nb.parent_notebook_id) && !cascade.has(nb.id)) {
            cascade.add(nb.id)
            changed = true
          }
        }
      }
      setNotebooks(prev => prev.filter(n => !cascade.has(n.id)))
      setNotes(prev => prev.map(n => (n.notebook_id && cascade.has(n.notebook_id)) ? { ...n, notebook_id: null } : n))
      if (scope.kind === 'notebook' && cascade.has(scope.notebookId)) {
        const orphan = notes.find(n => n.id === selectedNoteId)
        setScope({ kind: 'inbox', spaceId: orphan?.space_id ?? activeSpaceId })
      }
    } catch (e) {
      console.error('delete notebook failed', e)
      toast('Could not delete notebook')
    }
  }, [toast, notebooks, notes, scope, selectedNoteId, activeSpaceId])

  const onCreateNote = useCallback(async () => {
    // Pick a target container based on scope.
    let spaceId: string
    let notebookId: string | null = null
    if (scope.kind === 'notebook') {
      const nb = notebooks.find(n => n.id === scope.notebookId)
      if (!nb) return
      spaceId = nb.space_id
      notebookId = nb.id
    } else if (scope.kind === 'inbox') {
      spaceId = scope.spaceId
    } else {
      // tag scope — fall back to active space, no notebook
      spaceId = activeSpaceId
    }
    try {
      const created = await notesDb.create({ space_id: spaceId, notebook_id: notebookId })
      setNotes(prev => [created, ...prev])
      setSelectedNoteId(created.id)
    } catch (e) {
      console.error('create note failed', e)
      toast('Could not create note')
    }
  }, [scope, notebooks, activeSpaceId, toast])

  const onUpdateNote = useCallback(async (id: string, patch: Partial<Note>) => {
    try {
      const updated = await notesDb.update(id, patch)
      setNotes(prev => prev.map(n => n.id === id ? updated : n))
    } catch (e) {
      console.error('update note failed', e)
      toast('Could not save note')
    }
  }, [toast])

  const onDeleteNote = useCallback(async (id: string) => {
    try {
      await notesDb.remove(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      setTagsByNote(prev => { const next = new Map(prev); next.delete(id); return next })
      if (selectedNoteId === id) setSelectedNoteId(null)
    } catch (e) {
      console.error('delete note failed', e)
      toast('Could not delete note')
    }
  }, [toast, selectedNoteId])

  const onSetNoteTags = useCallback(async (id: string, tags: string[]) => {
    try {
      await notesDb.setTags(id, tags)
      setTagsByNote(prev => {
        const next = new Map(prev)
        if (tags.length === 0) next.delete(id)
        else next.set(id, tags)
        return next
      })
    } catch (e) {
      console.error('set tags failed', e)
      toast('Could not update tags')
    }
  }, [toast])

  // ── Tree expand/collapse helpers ─────────────────────────────────

  function toggleSpace(spaceId: string) {
    setExpandedSpaces(prev => {
      const next = new Set(prev)
      if (next.has(spaceId)) next.delete(spaceId); else next.add(spaceId)
      return next
    })
  }
  function toggleNotebook(notebookId: string) {
    setExpandedNotebooks(prev => {
      const next = new Set(prev)
      if (next.has(notebookId)) next.delete(notebookId); else next.add(notebookId)
      return next
    })
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--navy-400)', fontSize: 13 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: fullscreen ? '0 0 1fr' : '240px 300px 1fr', height: 'calc(100vh - 0px)', minHeight: 0, transition: 'grid-template-columns .2s ease' }}>

      {/* ── LEFT: Notebook tree (hidden in fullscreen) ── */}
      <aside style={{ background: 'var(--navy-800)', borderRight: fullscreen ? 'none' : '1px solid var(--navy-600)', overflow: fullscreen ? 'hidden' : 'auto', padding: '12px 0', visibility: fullscreen ? 'hidden' : 'visible' }}>
        {spaces.map(space => {
          const isExpanded = expandedSpaces.has(space.id)
          const inboxCount = counts.byInbox[space.id] ?? 0
          const topLevel = notebooksBySpace.get(space.id) ?? []
          return (
            <div key={space.id} style={{ marginBottom: 4 }}>
              <SpaceRow
                space={space}
                expanded={isExpanded}
                onToggle={() => toggleSpace(space.id)}
                onNewNotebook={() => { setNewNotebookFor({ spaceId: space.id, parentId: null }); setNewNotebookDraft('') }}
              />
              {isExpanded && (
                <div>
                  {/* Inbox row */}
                  <TreeRow
                    indent={1}
                    icon="📥"
                    label="Inbox"
                    count={inboxCount}
                    muted
                    active={scope.kind === 'inbox' && scope.spaceId === space.id}
                    onClick={() => { setScope({ kind: 'inbox', spaceId: space.id }); setSelectedNoteId(null) }}
                  />
                  {/* Top-level notebooks */}
                  {topLevel.map(nb => (
                    <NotebookBranch
                      key={nb.id}
                      notebook={nb}
                      depth={1}
                      childrenByParent={childrenByParent}
                      counts={counts}
                      scope={scope}
                      expandedNotebooks={expandedNotebooks}
                      onToggleNotebook={toggleNotebook}
                      onSelect={(nbId) => { setScope({ kind: 'notebook', notebookId: nbId }); setSelectedNoteId(null) }}
                      onStartRename={(nbId, name) => { setRenamingNotebookId(nbId); setRenameDraft(name) }}
                      onCommitRename={(nbId) => {
                        const target = notebooks.find(n => n.id === nbId)
                        if (target && renameDraft.trim() && renameDraft.trim() !== target.name) {
                          onRenameNotebook(nbId, renameDraft)
                        }
                        setRenamingNotebookId(null)
                      }}
                      onCancelRename={() => setRenamingNotebookId(null)}
                      renamingNotebookId={renamingNotebookId}
                      renameDraft={renameDraft}
                      setRenameDraft={setRenameDraft}
                      onAddChild={(parentId) => { setNewNotebookFor({ spaceId: space.id, parentId }); setNewNotebookDraft('') }}
                      onDelete={(nbId, name) => { if (confirm(`Delete notebook "${name}"? Sub-notebooks are deleted too; notes move to Inbox.`)) onDeleteNotebook(nbId) }}
                    />
                  ))}
                  {/* New-notebook input at top level */}
                  {newNotebookFor?.spaceId === space.id && newNotebookFor?.parentId === null && (
                    <TreeInput
                      indent={1}
                      value={newNotebookDraft}
                      onChange={setNewNotebookDraft}
                      placeholder="Notebook name…"
                      onCommit={() => { onCreateNotebook(space.id, null, newNotebookDraft); setNewNotebookFor(null) }}
                      onCancel={() => setNewNotebookFor(null)}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* TAGS — global, cross-space */}
        {allTags.length > 0 && (
          <div style={{ marginTop: 18, padding: '0 6px' }}>
            <div style={{ padding: '0 8px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--navy-300)' }}>Tags</div>
            {allTags.map(tag => (
              <TreeRow
                key={tag}
                indent={0}
                icon="#"
                label={tag}
                count={counts.byTag[tag] ?? 0}
                active={scope.kind === 'tag' && scope.tag === tag}
                onClick={() => { setScope({ kind: 'tag', tag }); setSelectedNoteId(null) }}
              />
            ))}
          </div>
        )}
      </aside>

      {/* ── MIDDLE: Note list (hidden in fullscreen) ── */}
      <section style={{ background: 'var(--navy-900)', borderRight: fullscreen ? 'none' : '1px solid var(--navy-700)', overflow: fullscreen ? 'hidden' : 'auto', visibility: fullscreen ? 'hidden' : 'visible' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px 10px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--navy-50)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{middleHeading}</div>
            <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 2 }}>{filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}</div>
          </div>
          {scope.kind !== 'tag' && (
            <button onClick={onCreateNote}
              title="New note"
              style={{
                width: 28, height: 28, border: 'none', borderRadius: 5,
                background: 'var(--navy-700)', color: 'var(--navy-100)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-600)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--navy-700)' }}>
              +
            </button>
          )}
        </div>
        <div style={{ height: 1, background: 'var(--navy-700)' }} />
        {filteredNotes.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--navy-400)', fontSize: 12.5 }}>
            No notes yet. {scope.kind !== 'tag' && 'Hit + to start one.'}
          </div>
        ) : (
          filteredNotes.map(note => (
            <NoteListItem
              key={note.id}
              note={note}
              tags={tagsByNote.get(note.id) ?? []}
              selected={selectedNoteId === note.id}
              onClick={() => setSelectedNoteId(note.id)}
            />
          ))
        )}
      </section>

      {/* ── RIGHT: Editor ── */}
      <section style={{ overflowY: 'auto' }}>
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            tags={tagsByNote.get(selectedNote.id) ?? []}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen(v => !v)}
            onPatch={patch => onUpdateNote(selectedNote.id, patch)}
            onSetTags={tags => onSetNoteTags(selectedNote.id, tags)}
            onDelete={() => { if (confirm('Delete this note?')) onDeleteNote(selectedNote.id) }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--navy-400)', fontSize: 13 }}>
            Pick a note, or hit + to create one.
          </div>
        )}
      </section>

      {/* Inline floating new-notebook input for sub-notebook context lives inside NotebookBranch via onAddChild;
          the actual input is rendered there to keep it adjacent to its parent. */}
      {newNotebookFor?.parentId !== null && newNotebookFor !== null && (
        <SubNotebookInputPortal
          parentId={newNotebookFor.parentId!}
          value={newNotebookDraft}
          setValue={setNewNotebookDraft}
          onCommit={() => { onCreateNotebook(newNotebookFor.spaceId, newNotebookFor.parentId, newNotebookDraft); setNewNotebookFor(null) }}
          onCancel={() => setNewNotebookFor(null)}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────

function SpaceRow({ space, expanded, onToggle, onNewNotebook }: {
  space: Space; expanded: boolean; onToggle: () => void; onNewNotebook: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--navy-100)' }}
      onClick={onToggle}>
      <span style={{ width: 12, textAlign: 'center', color: 'var(--navy-400)', fontSize: 10 }}>{expanded ? '▾' : '▸'}</span>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
      {hover && (
        <button onClick={e => { e.stopPropagation(); onNewNotebook() }}
          title="New notebook"
          style={{ background: 'none', border: 'none', color: 'var(--navy-300)', padding: '2px 4px', cursor: 'pointer', borderRadius: 3, fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>
          +
        </button>
      )}
    </div>
  )
}

function TreeRow({ indent, icon, label, count, active, muted, onClick }: {
  indent: number; icon?: string; label: string; count?: number; active?: boolean; muted?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      style={{
        width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 8px', paddingLeft: 8 + indent * 14, border: 'none', borderRadius: 5, cursor: 'pointer',
        background: active ? 'var(--accent-dim)' : 'none',
        color: active ? 'var(--accent)' : (muted ? 'var(--navy-300)' : 'var(--navy-100)'),
        fontSize: 12.5, fontWeight: active ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--navy-700)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}>
      {icon && <span style={{ width: 14, textAlign: 'center', opacity: 0.7, fontSize: 11 }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count != null && count > 0 && <span style={{ fontSize: 10.5, color: active ? 'var(--accent)' : 'var(--navy-400)' }}>{count}</span>}
    </button>
  )
}

function NotebookBranch(props: {
  notebook: Notebook
  depth: number
  childrenByParent: Map<string, Notebook[]>
  counts: { byNotebook: Record<string, number> }
  scope: Scope
  expandedNotebooks: Set<string>
  onToggleNotebook: (id: string) => void
  onSelect: (id: string) => void
  onStartRename: (id: string, name: string) => void
  onCommitRename: (id: string) => void
  onCancelRename: () => void
  renamingNotebookId: string | null
  renameDraft: string
  setRenameDraft: (v: string) => void
  onAddChild: (parentId: string) => void
  onDelete: (id: string, name: string) => void
}) {
  const { notebook, depth } = props
  const children = props.childrenByParent.get(notebook.id) ?? []
  const expanded = props.expandedNotebooks.has(notebook.id)
  const isStack = children.length > 0
  const isActive = props.scope.kind === 'notebook' && props.scope.notebookId === notebook.id
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Close kebab menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  // Inline rename mode replaces the row
  if (props.renamingNotebookId === notebook.id) {
    return (
      <input autoFocus
        value={props.renameDraft}
        onChange={e => props.setRenameDraft(e.target.value)}
        onBlur={() => props.onCommitRename(notebook.id)}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') props.onCancelRename()
        }}
        style={{
          width: `calc(100% - 12px - ${depth * 14}px)`, marginLeft: 6 + depth * 14, marginRight: 6,
          padding: '5px 8px', background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
          borderRadius: 5, color: 'var(--navy-50)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
        }} />
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={() => { if (isStack) props.onToggleNotebook(notebook.id); props.onSelect(notebook.id) }}
        style={{
          width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px', paddingLeft: 8 + depth * 14, border: 'none', borderRadius: 5, cursor: 'pointer',
          background: isActive ? 'var(--accent-dim)' : (hover ? 'var(--navy-700)' : 'none'),
          color: isActive ? 'var(--accent)' : 'var(--navy-100)',
          fontSize: 12.5, fontWeight: isActive ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
        }}>
        <span style={{ width: 12, textAlign: 'center', color: 'var(--navy-400)', fontSize: 10 }}>
          {isStack ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span style={{ width: 14, textAlign: 'center', opacity: 0.7, fontSize: 12 }}>{isStack ? '📚' : '📓'}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notebook.name}</span>
        {!hover && (props.counts.byNotebook[notebook.id] ?? 0) > 0 && (
          <span style={{ fontSize: 10.5, color: isActive ? 'var(--accent)' : 'var(--navy-400)' }}>{props.counts.byNotebook[notebook.id]}</span>
        )}
      </button>

      {hover && (
        <button onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--navy-300)', padding: '2px 4px',
            borderRadius: 3, cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: 'inherit' }}>
          ⋯
        </button>
      )}

      {menuOpen && (
        <div style={{ position: 'absolute', top: '100%', right: 6, zIndex: 30, marginTop: 2,
          background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 6,
          padding: 4, minWidth: 150, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
          {depth === 1 && (
            <button onClick={() => { props.onAddChild(notebook.id); setMenuOpen(false) }} style={branchMenuItemStyle}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
              + New sub-notebook
            </button>
          )}
          <button onClick={() => { props.onStartRename(notebook.id, notebook.name); setMenuOpen(false) }} style={branchMenuItemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Rename
          </button>
          <button onClick={() => { props.onDelete(notebook.id, notebook.name); setMenuOpen(false) }} style={{ ...branchMenuItemStyle, color: 'var(--red-text)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Delete
          </button>
        </div>
      )}

      {expanded && children.map(child => (
        <NotebookBranch
          key={child.id}
          {...props}
          notebook={child}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

const branchMenuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
  padding: '6px 10px', fontSize: 12, color: 'var(--navy-100)', cursor: 'pointer',
  borderRadius: 4, fontFamily: 'inherit',
}

function TreeInput({ indent, value, onChange, placeholder, onCommit, onCancel }: {
  indent: number; value: string; onChange: (v: string) => void; placeholder: string; onCommit: () => void; onCancel: () => void
}) {
  return (
    <input autoFocus
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={() => { if (value.trim()) onCommit(); else onCancel() }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') onCancel()
      }}
      placeholder={placeholder}
      style={{
        width: `calc(100% - 12px - ${indent * 14}px)`, marginLeft: 6 + indent * 14, marginRight: 6,
        padding: '5px 8px', background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
        borderRadius: 5, color: 'var(--navy-50)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
      }} />
  )
}

// The sub-notebook input is rendered inline within NotebookBranch's tree
// position. We use a separate component so the input lives near its
// parent visually. This is a no-op placeholder — actually inline rendering
// would be cleaner, but the simple version just appears once at top level.
function SubNotebookInputPortal({ value, setValue, onCommit, onCancel }: {
  parentId: string; value: string; setValue: (v: string) => void; onCommit: () => void; onCancel: () => void
}) {
  return (
    <div style={{ position: 'fixed', bottom: 24, left: 260, zIndex: 50,
      background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 8,
      padding: 10, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--navy-300)' }}>Sub-notebook:</span>
      <input autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onCommit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Name…"
        style={{
          padding: '5px 8px', background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
          borderRadius: 5, color: 'var(--navy-50)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', width: 180,
        }} />
      <button onClick={onCommit} style={{ padding: '4px 10px', background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Create</button>
      <button onClick={onCancel} style={{ padding: '4px 6px', background: 'none', border: 'none', color: 'var(--navy-300)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
    </div>
  )
}

function NoteListItem({ note, tags, selected, onClick }: {
  note: Note; tags: string[]; selected: boolean; onClick: () => void
}) {
  const preview = useMemo(() => extractText(note.body).slice(0, 140), [note.body])
  return (
    <button onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '10px 16px', borderTop: 'none', borderRight: 'none', borderLeft: '3px solid transparent',
        borderBottom: '1px solid var(--navy-700)',
        borderLeftColor: selected ? 'var(--accent)' : 'transparent',
        background: selected ? 'var(--accent-dim)' : 'none',
        color: 'var(--navy-50)', cursor: 'pointer', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--navy-800)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'none' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, color: note.title ? 'var(--navy-50)' : 'var(--navy-400)', fontStyle: note.title ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {note.title || 'Untitled'}
      </div>
      <div style={{
        fontSize: 11.5, color: 'var(--navy-300)', lineHeight: 1.45, marginBottom: 5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {preview || <span style={{ color: 'var(--navy-400)', fontStyle: 'italic' }}>No content yet</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, color: 'var(--navy-400)' }}>{formatRelative(note.updated_at)}</span>
        {tags.map(t => (
          <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--indigo-bg)', color: 'var(--indigo-text)' }}>#{t}</span>
        ))}
      </div>
    </button>
  )
}

// ── Editor ─────────────────────────────────────────────────────────

function NoteEditor({ note, tags, fullscreen, onToggleFullscreen, onPatch, onSetTags, onDelete }: {
  note: Note;
  tags: string[];
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onPatch: (patch: Partial<Note>) => void;
  onSetTags: (tags: string[]) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title)
  const [tagInput, setTagInput] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const pendingBodyRef = useRef<NoteBody | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Body autosave: schedule a debounced write on every onUpdate.
  // On unmount, flush immediately so switching notes doesn't lose
  // the last 1.5s of typing.
  const flushBody = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (pendingBodyRef.current === null) return
    const body = pendingBodyRef.current
    pendingBodyRef.current = null
    setSaveState('saving')
    try {
      await onPatch({ body })
      setSaveState('saved')
    } catch {
      setSaveState('idle')
    }
  }, [onPatch])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write something…' }),
    ],
    content: (note.body ?? EMPTY_DOC) as Content,
    onUpdate: ({ editor }) => {
      pendingBodyRef.current = editor.getJSON()
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => { flushBody() }, 1500)
    },
    editorProps: {
      attributes: {
        class: 'notes-editor',
      },
    },
  })

  // Flush on unmount (note switch)
  useEffect(() => {
    return () => { flushBody() }
  }, [flushBody])

  function commitTitle() {
    const v = title.trim()
    if (v !== note.title) onPatch({ title: v })
  }
  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/^#/, '')
    if (!t) return
    if (tags.includes(t)) { setTagInput(''); return }
    onSetTags([...tags, t])
    setTagInput('')
  }
  function removeTag(t: string) {
    onSetTags(tags.filter(x => x !== t))
  }

  // In fullscreen, center the editor content for comfortable reading.
  const innerStyle: React.CSSProperties = fullscreen
    ? { maxWidth: 780, margin: '0 auto', width: '100%' }
    : {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header: title + tags + save indicator + delete */}
      <div style={{ padding: '20px 24px 0' }}>
        <div style={innerStyle}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
            placeholder="Untitled"
            style={{
              width: '100%', border: 'none', background: 'transparent',
              fontSize: 22, fontWeight: 700, color: 'var(--navy-50)',
              outline: 'none', fontFamily: 'inherit', padding: '2px 0',
            }} />
        </div>
      </div>

      <div style={{ padding: '6px 24px 10px' }}>
        <div style={{ ...innerStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', flex: 1 }}>
            {tags.map(t => (
              <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--indigo-bg)', color: 'var(--indigo-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                #{t}
                <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
              </span>
            ))}
            <input value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder="+ tag"
              style={{ background: 'none', border: 'none', color: 'var(--navy-300)', fontSize: 11.5, fontFamily: 'inherit', outline: 'none', width: 80 }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--navy-400)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}
            <button onClick={onToggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{ marginLeft: 10, background: 'none', border: 'none', color: 'var(--navy-400)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', fontFamily: 'inherit' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--navy-100)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--navy-400)' }}>
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 1.5v3.5h3.5M10 5l4-4M6 14.5v-3.5H2.5M6 11l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
            <button onClick={onDelete} title="Delete note" style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--navy-400)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
              🗑
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar editor={editor} />

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px 60px' }}>
        <div style={innerStyle}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Editor styles injected once; scoped to .notes-editor */}
      <style>{`
        .notes-editor { outline: none; min-height: 200px; color: var(--navy-50); font-size: 14px; line-height: 1.6; }
        .notes-editor p { margin: 0 0 10px; }
        .notes-editor h1 { font-size: 22px; font-weight: 700; margin: 18px 0 10px; color: var(--navy-50); }
        .notes-editor h2 { font-size: 18px; font-weight: 700; margin: 16px 0 8px; color: var(--navy-50); }
        .notes-editor h3 { font-size: 15px; font-weight: 700; margin: 14px 0 6px; color: var(--navy-50); }
        .notes-editor ul { list-style-type: disc; padding-left: 22px; margin: 0 0 10px; }
        .notes-editor ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 10px; }
        .notes-editor ul ul { list-style-type: circle; }
        .notes-editor ul ul ul { list-style-type: square; }
        .notes-editor li { margin: 3px 0; }
        .notes-editor code { background: var(--navy-700); padding: 1px 5px; border-radius: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
        .notes-editor pre { background: var(--navy-800); padding: 10px 12px; border-radius: 6px; margin: 0 0 10px; overflow-x: auto; }
        .notes-editor pre code { background: none; padding: 0; }
        .notes-editor blockquote { border-left: 3px solid var(--navy-500); padding-left: 12px; margin: 10px 0; color: var(--navy-200); }
        .notes-editor a { color: var(--accent); text-decoration: underline; }
        .notes-editor ul[data-type="taskList"] { list-style: none; padding-left: 0; }
        .notes-editor ul[data-type="taskList"] li { display: flex; gap: 8px; align-items: flex-start; }
        .notes-editor ul[data-type="taskList"] li > label { margin-top: 4px; }
        .notes-editor ul[data-type="taskList"] li > div { flex: 1; }
        .notes-editor p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--navy-400);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return <div style={{ height: 36 }} />
  const btn = (active: boolean, onClick: () => void, label: string, title: string) => (
    <button onClick={onClick} title={title}
      style={{
        background: active ? 'var(--accent-dim)' : 'none',
        color: active ? 'var(--accent)' : 'var(--navy-200)',
        border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit', minWidth: 26,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--navy-700)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}>
      {label}
    </button>
  )
  const sep = <span style={{ width: 1, height: 16, background: 'var(--navy-700)', margin: '0 2px' }} />
  return (
    <div style={{ display: 'flex', gap: 2, padding: '4px 18px 10px', borderBottom: '1px solid var(--navy-700)' }}>
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2', 'Heading')}
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3', 'Sub-heading')}
      {sep}
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'B', 'Bold')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'I', 'Italic')}
      {sep}
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), '•', 'Bullet list')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1.', 'Numbered list')}
      {btn(editor.isActive('taskList'), () => editor.chain().focus().toggleTaskList().run(), '☐', 'Checklist')}
      {sep}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), '"', 'Quote')}
      {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), '<>', 'Code block')}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

/** Walk a TipTap doc and concatenate text nodes for previews. */
function extractText(body: NoteBody | null): string {
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
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `Today ${hh}:${mm}`
  }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
