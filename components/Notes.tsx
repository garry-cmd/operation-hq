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
import { useEffect, useState, useMemo, useCallback, useRef, useReducer } from 'react'
import { Space, Notebook, Note, NoteTag, NoteBody, NoteVersion } from '@/lib/types'
import * as notebooksDb from '@/lib/db/notebooks'
import * as notesDb from '@/lib/db/notes'
import * as noteVersionsDb from '@/lib/db/noteVersions'
import { extractNoteText } from '@/lib/noteText'
import { noteToMarkdown } from '@/lib/notes/noteMarkdown'
import { useIsMobile } from '@/lib/useIsMobile'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import type { Content } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { ImageWithPath } from '@/lib/notes/imageWithPath'
import { FileAttachment } from '@/lib/notes/fileAttachment'
import { tableExtensions, CELL_COLORS } from '@/lib/notes/tableWithColor'
import { createInternalLinks } from '@/lib/notes/internalLinks'
import { collectMediaPaths } from '@/lib/notes/collectMediaPaths'
import { uploadNoteImage, uploadNoteFile, deleteAllMediaForNote, deleteNoteMedia } from '@/lib/db/noteMedia'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  // Lifted state (Jun 2026) — page.tsx owns the data, Notes owns the UI.
  notebooks: Notebook[]
  setNotebooks: React.Dispatch<React.SetStateAction<Notebook[]>>
  notes: Note[]
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  tagsByNote: Map<string, string[]>
  setTagsByNote: React.Dispatch<React.SetStateAction<Map<string, string[]>>>
  /** Note to focus when entering — set by cross-app jump from Tags. */
  initialNoteId?: string | null
  /** Called once the initial selection has been consumed. */
  onConsumeInitialNoteId?: () => void
  /** Called when the user clicks a tag chip — jumps to the Tags page. */
  onJumpToTag?: (tag: string) => void
  /** Notify page.tsx when focus mode toggles, so it can collapse the NavRail. */
  onFocusChange?: (focused: boolean) => void
  toast: (msg: string) => void
}

// What's selected in the left pane.
//   'inbox'    = unified inbox: notes with no space AND no notebook
//   'all'      = every note across spaces
//   'space'    = all notes in a space (including ones in notebooks)
//   'notebook' = a specific notebook (and its descendants)
//   'tag'      = the cross-space tag filter
type Scope =
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'tag'; tag: string }

const EMPTY_DOC: NoteBody = { type: 'doc', content: [{ type: 'paragraph' }] }

// Pinned notes float to the top (newest pin first); the rest by recency.
function byPinnedThenUpdated(a: Note, b: Note): number {
  const ap = a.pinned_at, bp = b.pinned_at
  if (ap && !bp) return -1
  if (!ap && bp) return 1
  if (ap && bp) return ap < bp ? 1 : -1
  return a.updated_at < b.updated_at ? 1 : -1
}

export default function Notes({ spaces, activeSpaceId, notebooks, setNotebooks, notes, setNotes, tagsByNote, setTagsByNote, initialNoteId, onConsumeInitialNoteId, onJumpToTag, onFocusChange, toast }: Props) {
  const [scope, setScope] = useState<Scope>({ kind: 'inbox' })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  // Left-pane UI state
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(() => new Set([activeSpaceId]))
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set())
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [newNotebookFor, setNewNotebookFor] = useState<{ spaceId: string; parentId: string | null } | null>(null)
  const [newNotebookDraft, setNewNotebookDraft] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  // Mobile fallback (May 17): below 900px the notebook tree and note list
  // each collapse to dropdown panels controlled by openers above the editor.
  // On mobile, opening a note treats the editor as a full-screen overlay so
  // the user gets the full viewport to read/write.
  const isMobile = useIsMobile(900)
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false)
  const [mobileListOpen, setMobileListOpen] = useState(false)

  // Cross-app jump: when Tags hands us an initialNoteId, find the note,
  // switch scope to its container, and select it.
  useEffect(() => {
    if (!initialNoteId) return
    const target = notes.find(n => n.id === initialNoteId)
    if (target) {
      if (target.notebook_id) setScope({ kind: 'notebook', notebookId: target.notebook_id })
      else if (target.space_id) setScope({ kind: 'space', spaceId: target.space_id })
      else setScope({ kind: 'inbox' })
      setSelectedNoteId(target.id)
    }
    onConsumeInitialNoteId?.()
  }, [initialNoteId, notes, onConsumeInitialNoteId])

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
    // Unified inbox (no space AND no notebook) and per-space totals (every
    // note belonging to that space, regardless of notebook). bySpace mirrors
    // the Tasks sidebar — clicking a space shows everything in it.
    let inbox = 0
    const bySpace: Record<string, number> = {}
    const byNotebook: Record<string, number> = {}
    const byTag: Record<string, number> = {}
    for (const n of notes) {
      if (n.space_id == null && n.notebook_id == null) inbox += 1
      if (n.space_id != null) bySpace[n.space_id] = (bySpace[n.space_id] ?? 0) + 1
      if (n.notebook_id != null) byNotebook[n.notebook_id] = (byNotebook[n.notebook_id] ?? 0) + 1
    }
    for (const tag of allTags) {
      byTag[tag] = notes.filter(n => (tagsByNote.get(n.id) ?? []).includes(tag)).length
    }
    return { inbox, all: notes.length, bySpace, byNotebook, byTag }
  }, [notes, allTags, tagsByNote])

  // Notes filtered to the current scope. For a notebook scope, include
  // notes from descendant notebooks too — Stack-level selection should
  // surface everything underneath.
  const filteredNotes = useMemo(() => {
    if (scope.kind === 'inbox') {
      return notes
        .filter(n => n.space_id == null && n.notebook_id == null)
        .sort(byPinnedThenUpdated)
    }
    if (scope.kind === 'all') {
      return [...notes].sort(byPinnedThenUpdated)
    }
    if (scope.kind === 'space') {
      return notes
        .filter(n => n.space_id === scope.spaceId)
        .sort(byPinnedThenUpdated)
    }
    if (scope.kind === 'notebook') {
      const ids = new Set<string>([scope.notebookId])
      const children = childrenByParent.get(scope.notebookId) ?? []
      for (const c of children) ids.add(c.id)
      return notes
        .filter(n => n.notebook_id && ids.has(n.notebook_id))
        .sort(byPinnedThenUpdated)
    }
    // tag
    return notes
      .filter(n => (tagsByNote.get(n.id) ?? []).includes(scope.tag))
      .sort(byPinnedThenUpdated)
  }, [notes, scope, childrenByParent, tagsByNote])

  const selectedNote = useMemo(
    () => selectedNoteId ? notes.find(n => n.id === selectedNoteId) ?? null : null,
    [notes, selectedNoteId],
  )

  // Focus mode's only exit lives in the editor header. If the selection ever
  // clears while focused (e.g. deleting the open note), the editor unmounts
  // and you'd be stranded with no NavRail and no panes — so drop out of focus.
  useEffect(() => {
    if (!selectedNote && fullscreen) { setFullscreen(false); onFocusChange?.(false) }
  }, [selectedNote, fullscreen, onFocusChange])

  // Heading for the middle pane.
  const middleHeading = useMemo(() => {
    if (scope.kind === 'inbox') return 'Inbox'
    if (scope.kind === 'all') return 'All notes'
    if (scope.kind === 'space') {
      const space = spaces.find(s => s.id === scope.spaceId)
      return space?.name ?? 'Space'
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
        // After delete: ON DELETE SET NULL drops the notebook_id on orphan
        // notes but keeps space_id. Land on that space's scope, or unified
        // inbox if the orphan had no space either.
        if (orphan?.space_id) setScope({ kind: 'space', spaceId: orphan.space_id })
        else setScope({ kind: 'inbox' })
      }
    } catch (e) {
      console.error('delete notebook failed', e)
      toast('Could not delete notebook')
    }
  }, [toast, notebooks, notes, scope, selectedNoteId])

  const onCreateNote = useCallback(async () => {
    // Pick a target container based on scope. Tag and "all" scopes are
    // location-ambiguous — drop the new note in the unified inbox so the
    // user can file it later from there.
    let spaceId: string | null = null
    let notebookId: string | null = null
    if (scope.kind === 'notebook') {
      const nb = notebooks.find(n => n.id === scope.notebookId)
      if (!nb) return
      spaceId = nb.space_id
      notebookId = nb.id
    } else if (scope.kind === 'space') {
      spaceId = scope.spaceId
    } else if (scope.kind === 'inbox') {
      // unified inbox: no space, no notebook
    } else {
      // tag / all → unified inbox by default
    }
    try {
      const created = await notesDb.create({ space_id: spaceId, notebook_id: notebookId })
      setNotes(prev => [created, ...prev])
      setSelectedNoteId(created.id)
    } catch (e) {
      console.error('create note failed', e)
      toast('Could not create note')
    }
  }, [scope, notebooks, toast])

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
      // Storage GC: purge the note's images/attachments so they don't orphan.
      void deleteAllMediaForNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      setTagsByNote(prev => { const next = new Map(prev); next.delete(id); return next })
      if (selectedNoteId === id) setSelectedNoteId(null)
    } catch (e) {
      console.error('delete note failed', e)
      toast('Could not delete note')
    }
  }, [toast, selectedNoteId])

  // Resolve a `[[Title]]` click to a note and open it. Prefer a match within
  // the current note's space; fall back to any space; else tell the user.
  const onOpenNoteByTitle = useCallback((rawTitle: string) => {
    const title = rawTitle.trim().toLowerCase()
    if (!title) return
    const current = selectedNoteId ? notes.find(n => n.id === selectedNoteId) : null
    const inSpace = current
      ? notes.find(n => n.space_id === current.space_id && (n.title || '').trim().toLowerCase() === title)
      : null
    const target = inSpace ?? notes.find(n => (n.title || '').trim().toLowerCase() === title)
    if (!target) { toast(`No note titled "${rawTitle.trim()}"`); return }
    if (target.notebook_id) setScope({ kind: 'notebook', notebookId: target.notebook_id })
    else if (target.space_id) setScope({ kind: 'space', spaceId: target.space_id })
    else setScope({ kind: 'inbox' })
    setSelectedNoteId(target.id)
  }, [notes, selectedNoteId, toast])

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

  return (
    <div style={{
      // Mobile: flex column. Openers stick to the top, tree/list dropdowns
      // expand inline beneath them, editor fills the remaining viewport via
      // flex: 1. Grid was unpredictable when most children had display:none
      // — auto rows were stretching to absorb the 100vh and pushing content
      // around. Desktop: original three-column grid (or fullscreen 0/0/1fr).
      display: isMobile ? 'flex' : 'grid',
      flexDirection: isMobile ? 'column' : undefined,
      gridTemplateColumns: isMobile
        ? undefined
        : fullscreen
          ? '0 0 1fr'
          : '240px 300px 1fr',
      height: 'calc(100vh - 0px)', minHeight: 0, transition: 'grid-template-columns .2s ease',
    }}>

      {/* Mobile-only openers row — two tap targets that toggle the tree
          and list panels. Hidden on desktop (the panels are always visible). */}
      {isMobile && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--navy-600)', background: 'var(--navy-800)', flexShrink: 0 }}>
          <button onClick={() => { setMobileTreeOpen(o => !o); setMobileListOpen(false) }}
            style={{
              flex: 1, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 12.5, fontWeight: 600, color: 'var(--navy-50)',
              background: mobileTreeOpen ? 'var(--navy-700)' : 'transparent',
              border: 'none', borderRight: '1px solid var(--navy-600)', cursor: 'pointer', textAlign: 'left',
            }}>
            <span>Notebooks</span>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: mobileTreeOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
              <path d="M3 5l3 3 3-3" stroke="var(--navy-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={() => { setMobileListOpen(o => !o); setMobileTreeOpen(false) }}
            style={{
              flex: 1, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 12.5, fontWeight: 600, color: 'var(--navy-50)',
              background: mobileListOpen ? 'var(--navy-700)' : 'transparent',
              border: 'none', cursor: 'pointer', textAlign: 'left',
            }}>
            <span>Notes ({filteredNotes.length})</span>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: mobileListOpen ? 'rotate(180deg)' : 'rotate(0)' }}>
              <path d="M3 5l3 3 3-3" stroke="var(--navy-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── LEFT: Notebook tree (hidden in fullscreen, conditional on mobile) ── */}
      <aside style={{
        background: 'var(--navy-800)',
        borderRight: (fullscreen || isMobile) ? 'none' : '1px solid var(--navy-600)',
        borderBottom: isMobile ? '1px solid var(--navy-600)' : 'none',
        overflow: fullscreen ? 'hidden' : 'auto',
        padding: '12px 0',
        visibility: fullscreen ? 'hidden' : 'visible',
        ...(isMobile ? {
          display: mobileTreeOpen ? 'block' : 'none',
          maxHeight: '60vh',
          flexShrink: 0,
        } : {}),
      }}
        // Mobile: any click inside (scope-changing rows etc.) closes the
        // dropdown. Rename inputs and the "new notebook" form stop
        // propagation themselves to stay open mid-edit.
        onClick={isMobile ? () => setMobileTreeOpen(false) : undefined}>

        {/* SMART VIEWS — unified Inbox + All notes, mirroring Tasks. */}
        <div style={{ padding: '0 6px 4px' }}>
          <div style={{ padding: '0 8px 4px', fontSize: 10, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Smart views</div>
          <TreeRow
            indent={0}
            icon="📥"
            label="Inbox"
            count={counts.inbox}
            active={scope.kind === 'inbox'}
            onClick={() => { setScope({ kind: 'inbox' }); setSelectedNoteId(null) }}
          />
          <TreeRow
            indent={0}
            icon="∞"
            label="All notes"
            count={counts.all}
            active={scope.kind === 'all'}
            onClick={() => { setScope({ kind: 'all' }); setSelectedNoteId(null) }}
          />
        </div>

        {/* SPACES section header — matches Tasks. */}
        <div style={{ padding: '14px 14px 4px', fontSize: 10, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Spaces</div>

        {spaces.map(space => {
          const isExpanded = expandedSpaces.has(space.id)
          const spaceCount = counts.bySpace[space.id] ?? 0
          const topLevel = notebooksBySpace.get(space.id) ?? []
          return (
            <div key={space.id} style={{ marginBottom: 4 }}>
              <SpaceRow
                space={space}
                expanded={isExpanded}
                count={spaceCount}
                active={scope.kind === 'space' && scope.spaceId === space.id}
                onToggle={() => toggleSpace(space.id)}
                onSelect={() => { setScope({ kind: 'space', spaceId: space.id }); setSelectedNoteId(null) }}
                onNewNotebook={() => { setNewNotebookFor({ spaceId: space.id, parentId: null }); setNewNotebookDraft('') }}
              />
              {isExpanded && (
                <div>
                  {/* Top-level notebooks (no per-space Inbox row anymore;
                      unified Inbox lives in Smart Views). */}
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
            <div style={{ padding: '0 8px 4px', fontSize: 10, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Tags</div>
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

      {/* ── MIDDLE: Note list (hidden in fullscreen, conditional on mobile) ── */}
      <section style={{
        background: 'var(--navy-900)',
        borderRight: (fullscreen || isMobile) ? 'none' : '1px solid var(--navy-700)',
        borderBottom: isMobile ? '1px solid var(--navy-600)' : 'none',
        overflow: fullscreen ? 'hidden' : 'auto',
        visibility: fullscreen ? 'hidden' : 'visible',
        ...(isMobile ? {
          display: mobileListOpen ? 'block' : 'none',
          maxHeight: '60vh',
          flexShrink: 0,
        } : {}),
      }}>
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
              onClick={() => { setSelectedNoteId(note.id); if (isMobile) setMobileListOpen(false) }}
              onTagClick={onJumpToTag}
            />
          ))
        )}
      </section>

      {/* ── RIGHT: Editor ── On mobile this gets flex:1 to consume whatever
          viewport remains after the openers + any expanded dropdowns. */}
      <section style={{ overflowY: 'auto', ...(isMobile ? { flex: 1, minHeight: 0 } : {}) }}>
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            tags={tagsByNote.get(selectedNote.id) ?? []}
            spaces={spaces}
            notebooks={notebooks}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen(v => { const nv = !v; onFocusChange?.(nv); return nv })}
            onPatch={patch => onUpdateNote(selectedNote.id, patch)}
            onSetTags={tags => onSetNoteTags(selectedNote.id, tags)}
            onOpenNoteByTitle={onOpenNoteByTitle}
            onDelete={() => { if (confirm('Delete this note?')) { onDeleteNote(selectedNote.id); setFullscreen(false); onFocusChange?.(false) } }}
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

function SpaceRow({ space, expanded, count, active, onToggle, onSelect, onNewNotebook }: {
  space: Space
  expanded: boolean
  count: number
  active: boolean
  onToggle: () => void
  onSelect: () => void
  onNewNotebook: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: active ? 600 : 600,
        color: active ? 'var(--accent)' : 'var(--navy-100)',
        background: active ? 'var(--accent-dim)' : 'transparent',
      }}
      // Whole-row click selects the space scope. Chevron has its own
      // handler that stops propagation so it can toggle expansion
      // without changing the scope.
      onClick={onSelect}>
      <span
        onClick={e => { e.stopPropagation(); onToggle() }}
        style={{ width: 12, textAlign: 'center', color: 'var(--navy-400)', fontSize: 10, cursor: 'pointer', padding: '2px 0' }}>
        {expanded ? '▾' : '▸'}
      </span>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
      {hover ? (
        <button onClick={e => { e.stopPropagation(); onNewNotebook() }}
          title="New notebook"
          style={{ background: 'none', border: 'none', color: 'var(--navy-300)', padding: '2px 4px', cursor: 'pointer', borderRadius: 3, fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>
          +
        </button>
      ) : (
        count > 0 && <span style={{ fontSize: 10.5, color: active ? 'var(--accent)' : 'var(--navy-400)' }}>{count}</span>
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
          {depth <= 2 && (
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

function NoteListItem({ note, tags, selected, onClick, onTagClick }: {
  note: Note; tags: string[]; selected: boolean; onClick: () => void; onTagClick?: (tag: string) => void
}) {
  const preview = useMemo(() => extractNoteText(note.body).slice(0, 140), [note.body])
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
        {note.pinned_at && <span style={{ fontSize: 10, flexShrink: 0 }} title="Pinned">📌</span>}
        <span style={{ fontSize: 13, fontWeight: 600, color: note.title ? 'var(--navy-50)' : 'var(--navy-400)', fontStyle: note.title ? 'normal' : 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note.title || 'Untitled'}
        </span>
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
          <span key={t}
            onClick={e => { if (onTagClick) { e.stopPropagation(); onTagClick(t) } }}
            style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--indigo-bg)', color: 'var(--indigo-text)', cursor: onTagClick ? 'pointer' : 'default' }}>
            #{t}
          </span>
        ))}
      </div>
    </button>
  )
}

// ── Editor ─────────────────────────────────────────────────────────

function NoteEditor({ note, tags, spaces, notebooks, fullscreen, onToggleFullscreen, onPatch, onSetTags, onOpenNoteByTitle, onDelete }: {
  note: Note;
  tags: string[];
  spaces: Space[];
  notebooks: Notebook[];
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onPatch: (patch: Partial<Note>) => void;
  onSetTags: (tags: string[]) => void;
  onOpenNoteByTitle: (title: string) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(note.title)
  const [tagInput, setTagInput] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const pendingBodyRef = useRef<NoteBody | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Throttle version snapshots: at most one per note per this interval.
  const lastSnapshotRef = useRef<number>(0)
  // Media paths present in the last-saved body. Diffing against this on each
  // save tells us which image/attachment objects a body dropped, so we can GC
  // them without a bucket-listing sweep. Initialised from the mounted note's
  // body; the editor is keyed by note id, so this ref is fresh per note.
  const lastMediaPathsRef = useRef<Set<string> | null>(null)
  if (lastMediaPathsRef.current === null) lastMediaPathsRef.current = collectMediaPaths(note.body)
  // Latest title, readable from async flush without going stale.
  const titleRef = useRef(note.title)
  // Internal-link resolver, kept fresh so the editor plugin never closes over
  // a stale handler.
  const openLinkRef = useRef<(t: string) => void>(() => {})
  openLinkRef.current = onOpenNoteByTitle
  titleRef.current = title

  // Snapshot the current title+body into history, throttled. Best-effort.
  const snapshot = useCallback((body: NoteBody | null) => {
    const now = Date.now()
    if (now - lastSnapshotRef.current < 3 * 60 * 1000) return
    lastSnapshotRef.current = now
    void noteVersionsDb.createVersion(note.id, titleRef.current, body).catch(() => {})
  }, [note.id])

  // Reclaim storage objects a save dropped (e.g. an image backspaced out).
  // Only paths that *were* in the last saved body and are *now* gone are
  // candidates, so an in-flight upload (not yet in any saved body) is never a
  // deletion target. Candidates still referenced by a retained version snapshot
  // are spared so history restore can't surface a broken image. Best-effort.
  const gcRemovedMedia = useCallback(async (body: NoteBody | null) => {
    try {
      const current = collectMediaPaths(body)
      const prev = lastMediaPathsRef.current
      lastMediaPathsRef.current = current
      if (!prev || prev.size === 0) return
      const removed = [...prev].filter(p => !current.has(p))
      if (removed.length === 0) return
      let protectedPaths: Set<string> = current
      try {
        const versions = await noteVersionsDb.listVersions(note.id)
        protectedPaths = new Set(current)
        for (const v of versions)
          for (const p of collectMediaPaths(v.body)) protectedPaths.add(p)
      } catch {
        // Couldn't read history — fall back to protecting only the current body.
      }
      const orphans = removed.filter(p => !protectedPaths.has(p))
      if (orphans.length) void deleteNoteMedia(orphans)
    } catch {
      // GC must never break the editing flow.
    }
  }, [note.id])

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
      snapshot(body)
      void gcRemovedMedia(body)
      setSaveState('saved')
    } catch {
      setSaveState('idle')
    }
  }, [onPatch, snapshot, gcRemovedMedia])

  const [moveOpen, setMoveOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<NoteVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle')
  const [uploadErr, setUploadErr] = useState('Upload failed')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const errTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flashUploadError = useCallback((msg = 'Upload failed') => {
    setUploadErr(msg)
    setUploadState('error')
    if (errTimerRef.current) clearTimeout(errTimerRef.current)
    errTimerRef.current = setTimeout(() => setUploadState('idle'), 3000)
  }, [])

  // Upload image File(s) → insert as path-only image node(s). `at` lets a drop
  // land at the cursor position; paste/picker insert at the current selection.
  const insertImageFiles = useCallback(async (files: File[] | FileList, at?: number) => {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (imgs.length === 0) return
    if (imgs.some(f => f.size > 10 * 1024 * 1024)) { flashUploadError('Image too large — max 10 MB'); return }
    setUploadState('uploading')
    try {
      const nodes: { type: string; attrs: Record<string, unknown> }[] = []
      for (const file of imgs) {
        const { path } = await uploadNoteImage(note.id, file)
        nodes.push({ type: 'image', attrs: { path } })
      }
      const ed = editorRef.current
      if (ed && nodes.length) {
        // insertContentAt(number) inserts WITHOUT replacing; bare insertContent
        // targets the selection and would overwrite a node-selected chip.
        const pos = at != null ? at : ed.state.selection.to
        ed.chain().focus().insertContentAt(pos, nodes).run()
      }
      setUploadState('idle')
    } catch {
      flashUploadError()
    }
  }, [note.id, flashUploadError])

  // Upload arbitrary file(s) → insert as fileAttachment chip node(s).
  const insertAttachmentFiles = useCallback(async (files: File[] | FileList, at?: number) => {
    const list = Array.from(files)
    if (list.length === 0) return
    if (list.some(f => f.size > 50 * 1024 * 1024)) { flashUploadError('File too large — max 50 MB'); return }
    setUploadState('uploading')
    try {
      const nodes: { type: string; attrs: Record<string, unknown> }[] = []
      for (const file of list) {
        const { path, name, size, mime } = await uploadNoteFile(note.id, file)
        nodes.push({ type: 'fileAttachment', attrs: { path, name, size, mime } })
      }
      const ed = editorRef.current
      if (ed && nodes.length) {
        // insertContentAt(number) inserts WITHOUT replacing; bare insertContent
        // targets the selection and would overwrite a node-selected chip.
        const pos = at != null ? at : ed.state.selection.to
        ed.chain().focus().insertContentAt(pos, nodes).run()
      }
      setUploadState('idle')
    } catch {
      flashUploadError()
    }
  }, [note.id, flashUploadError])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Write something…' }),
      ImageWithPath,
      FileAttachment,
      ...tableExtensions,
      createInternalLinks(openLinkRef),
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
      handlePaste: (_view, event) => {
        const all = event.clipboardData?.files
        const list = all ? Array.from(all) : []
        if (list.length === 0) return false
        const imgs = list.filter(f => f.type.startsWith('image/'))
        const others = list.filter(f => !f.type.startsWith('image/'))
        event.preventDefault()
        if (imgs.length) void insertImageFiles(imgs)
        if (others.length) void insertAttachmentFiles(others)
        return true
      },
      handleDrop: (view, event) => {
        const all = event.dataTransfer?.files
        const list = all ? Array.from(all) : []
        if (list.length === 0) return false
        const imgs = list.filter(f => f.type.startsWith('image/'))
        const others = list.filter(f => !f.type.startsWith('image/'))
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (imgs.length) void insertImageFiles(imgs, coords?.pos)
        if (others.length) void insertAttachmentFiles(others, coords?.pos)
        return true
      },
    },
  })
  editorRef.current = editor

  // TipTap v3 doesn't re-render React on selection changes, so contextual UI
  // (the table toolbar) wouldn't appear/disappear as the cursor moves in and
  // out of a table. Bump a counter on selectionUpdate to force the re-render.
  const [, bumpSelection] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!editor) return
    const onSel = () => bumpSelection()
    editor.on('selectionUpdate', onSel)
    return () => { editor.off('selectionUpdate', onSel) }
  }, [editor])

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

  const pinned = !!note.pinned_at
  function togglePin() {
    onPatch({ pinned_at: pinned ? null : new Date().toISOString() })
  }

  function exportMarkdown() {
    const body = editor?.getJSON() ?? note.body
    const md = noteToMarkdown(title, body)
    const safe = (title || 'untitled').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'untitled'
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function openHistory() {
    setHistoryOpen(true)
    setVersionsLoading(true)
    try {
      // Flush any pending edits first so the latest is reflected.
      await flushBody()
      setVersions(await noteVersionsDb.listVersions(note.id))
    } catch {
      setVersions([])
    } finally {
      setVersionsLoading(false)
    }
  }

  function restoreVersion(v: NoteVersion) {
    if (!confirm('Restore this version? Your current note is saved to history first, so this is reversible.')) return
    // Snapshot current state so restore can be undone, bypassing the throttle.
    lastSnapshotRef.current = 0
    snapshot(editor?.getJSON() ?? note.body)
    const body = (v.body ?? EMPTY_DOC) as Content
    editor?.commands.setContent(body)
    setTitle(v.title)
    onPatch({ title: v.title, body: v.body })
    setHistoryOpen(false)
  }

  function moveTo(spaceId: string | null, notebookId: string | null) {
    onPatch({ space_id: spaceId, notebook_id: notebookId })
    setMoveOpen(false)
  }

  // In fullscreen / focus mode, give the editor a much wider column than the
  // cramped default — roomy for tables while keeping prose line-length sane.
  const innerStyle: React.CSSProperties = fullscreen
    ? { maxWidth: 1100, margin: '0 auto', width: '100%' }
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
          <div style={{ position: 'relative', fontSize: 11, color: 'var(--navy-400)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {uploadState === 'uploading' ? 'Uploading…'
              : uploadState === 'error' ? '⚠ ' + uploadErr
              : saveState === 'saving' ? 'Saving…'
              : saveState === 'saved' ? '✓ Saved' : ''}
            <IconBtn title={pinned ? 'Unpin note' : 'Pin note'} active={pinned} onClick={togglePin}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3-1-7z"/></svg>
            </IconBtn>
            <IconBtn title="Move to space / notebook" active={moveOpen} onClick={() => { setHistoryOpen(false); setMoveOpen(o => !o) }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
            </IconBtn>
            <IconBtn title="Version history" active={historyOpen} onClick={() => { setMoveOpen(false); historyOpen ? setHistoryOpen(false) : openHistory() }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>
            </IconBtn>
            <IconBtn title="Export as Markdown" onClick={exportMarkdown}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>
            </IconBtn>
            <button onClick={onToggleFullscreen} title={fullscreen ? 'Exit focus mode' : 'Focus mode (hide panels)'}
              style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--navy-400)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', fontFamily: 'inherit' }}
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
            {moveOpen && (
              <MovePanel spaces={spaces} notebooks={notebooks} note={note} onMove={moveTo} onClose={() => setMoveOpen(false)} />
            )}
            {historyOpen && (
              <HistoryPanel versions={versions} loading={versionsLoading} onRestore={restoreVersion} onClose={() => setHistoryOpen(false)} />
            )}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar
        editor={editor}
        onPickImage={() => fileInputRef.current?.click()}
        onPickFile={() => attachInputRef.current?.click()}
      />
      {editor && editor.isActive('table') && <TableToolbar editor={editor} />}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          const files = e.target.files
          if (files && files.length) void insertImageFiles(files)
          e.target.value = ''
        }}
      />
      <input
        ref={attachInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          const files = e.target.files
          if (files && files.length) void insertAttachmentFiles(files)
          e.target.value = ''
        }}
      />

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
        .notes-editor .note-link {
          color: var(--accent);
          text-decoration: underline;
          text-decoration-style: dotted;
          text-underline-offset: 2px;
          cursor: pointer;
          border-radius: 2px;
        }
        .notes-editor .note-link:hover { background: var(--accent-dim); }
        .notes-editor hr {
          border: none;
          border-top: 1px solid var(--navy-600);
          margin: 18px 0;
        }
        .notes-editor hr.ProseMirror-selectednode {
          border-top-color: var(--accent);
        }
        .notes-editor .tableWrapper { overflow-x: auto; margin: 14px 0; }
        .notes-editor table {
          border-collapse: collapse;
          table-layout: fixed;
          width: 100%;
          margin: 0;
        }
        .notes-editor td, .notes-editor th {
          border: 1px solid var(--navy-600);
          padding: 6px 9px;
          vertical-align: top;
          box-sizing: border-box;
          position: relative;
          min-width: 60px;
        }
        .notes-editor th {
          background: var(--navy-800);
          font-weight: 700;
          text-align: left;
        }
        .notes-editor td > p, .notes-editor th > p { margin: 0 0 4px; }
        .notes-editor td > :last-child, .notes-editor th > :last-child { margin-bottom: 0; }
        .notes-editor .selectedCell:after {
          content: '';
          position: absolute;
          inset: 0;
          background: var(--accent);
          opacity: 0.12;
          pointer-events: none;
        }
        .notes-editor .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 4px;
          background: var(--accent);
          cursor: col-resize;
          z-index: 5;
        }
        .notes-editor.resize-cursor { cursor: col-resize; }
        .notes-editor img.note-image {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 12px 0;
          border-radius: 8px;
          border: 1px solid var(--navy-700);
        }
        .notes-editor img.note-image[data-loading="true"] {
          min-height: 80px;
          width: 180px;
          background: var(--navy-800);
        }
        .notes-editor img.note-image.ProseMirror-selectednode {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .notes-editor .note-file-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 12px 0;
          padding: 9px 12px;
          border: 1px solid var(--navy-700);
          border-radius: 8px;
          background: var(--navy-800);
          max-width: 420px;
          user-select: none;
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s;
        }
        .notes-editor .note-file-chip:hover {
          background: var(--navy-700);
          border-color: var(--navy-500);
        }
        .notes-editor .note-file-chip.ProseMirror-selectednode {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .notes-editor .note-file-badge {
          flex: 0 0 auto;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--accent);
          background: var(--accent-dim);
          border-radius: 4px;
          padding: 4px 6px;
          min-width: 34px;
          text-align: center;
        }
        .notes-editor .note-file-name {
          flex: 1 1 auto;
          font-size: 13px;
          color: var(--navy-50);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .notes-editor .note-file-size {
          flex: 0 0 auto;
          font-size: 11px;
          color: var(--navy-400);
        }
        .notes-editor .note-file-remove {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          background: none;
          border: none;
          color: var(--navy-400);
          cursor: pointer;
          padding: 2px;
          border-radius: 4px;
          opacity: 0.55;
          transition: opacity 0.12s, color 0.12s, background 0.12s;
        }
        .notes-editor .note-file-chip:hover .note-file-remove { opacity: 1; }
        .notes-editor .note-file-remove:hover {
          color: var(--red-text);
          background: var(--navy-900);
        }
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

function IconBtn({ title, active, onClick, children }: {
  title: string; active?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} title={title}
      style={{ marginLeft: 8, background: 'none', border: 'none', color: active ? 'var(--accent)' : 'var(--navy-400)', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', fontFamily: 'inherit' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--navy-100)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--navy-400)' }}>
      {children}
    </button>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 40,
  width: 270, background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
}
const panelHeaderStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 10, fontWeight: 500, letterSpacing: '.16em',
  textTransform: 'uppercase', color: 'var(--nw-label)', borderBottom: '1px solid var(--navy-700)',
}
const panelEmptyStyle: React.CSSProperties = {
  padding: '14px 12px', fontSize: 11.5, color: 'var(--navy-400)', lineHeight: 1.5,
}

function PanelRow({ label, active, onClick, indent, bold }: {
  label: string; active?: boolean; onClick: () => void; indent?: boolean; bold?: boolean
}) {
  return (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
        padding: '6px 10px', paddingLeft: indent ? 26 : 10, border: 'none', borderRadius: 5,
        background: active ? 'var(--accent-dim)' : 'none', color: active ? 'var(--accent)' : 'var(--navy-100)',
        cursor: 'pointer', fontSize: 12.5, fontWeight: bold ? 600 : 500, fontFamily: 'inherit' }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--navy-700)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {active && <span style={{ fontSize: 11 }}>✓</span>}
    </button>
  )
}

function MovePanel({ spaces, notebooks, note, onMove, onClose }: {
  spaces: Space[]; notebooks: Notebook[]; note: Note;
  onMove: (spaceId: string | null, notebookId: string | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  const here = (s: string | null, n: string | null) => note.space_id === s && note.notebook_id === n
  return (
    <div ref={ref} style={panelStyle}>
      <div style={panelHeaderStyle}>Move note</div>
      <div style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }}>
        <PanelRow label="📥 Inbox (no space)" active={here(null, null)} onClick={() => onMove(null, null)} />
        {spaces.map(sp => {
          const nbs = notebooks.filter(nb => nb.space_id === sp.id)
          return (
            <div key={sp.id}>
              <PanelRow label={sp.name} bold active={here(sp.id, null)} onClick={() => onMove(sp.id, null)} />
              {nbs.map(nb => (
                <PanelRow key={nb.id} label={nb.name} indent active={here(sp.id, nb.id)} onClick={() => onMove(sp.id, nb.id)} />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HistoryPanel({ versions, loading, onRestore, onClose }: {
  versions: NoteVersion[]; loading: boolean;
  onRestore: (v: NoteVersion) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  return (
    <div ref={ref} style={panelStyle}>
      <div style={panelHeaderStyle}>Version history</div>
      <div style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }}>
        {loading ? (
          <div style={panelEmptyStyle}>Loading…</div>
        ) : versions.length === 0 ? (
          <div style={panelEmptyStyle}>No earlier versions yet. Snapshots are captured automatically as you edit.</div>
        ) : versions.map(v => (
          <button key={v.id} onClick={() => onRestore(v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left',
              padding: '7px 10px', border: 'none', borderRadius: 5, background: 'none', color: 'var(--navy-100)',
              cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title?.trim() || 'Untitled'}</span>
            <span style={{ fontSize: 10.5, color: 'var(--navy-400)', flexShrink: 0 }}>{formatRelative(v.created_at)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Toolbar({ editor, onPickImage, onPickFile }: { editor: Editor | null; onPickImage: () => void; onPickFile: () => void }) {
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
      {btn(false, () => editor.chain().focus().setHorizontalRule().run(), '―', 'Divider')}
      {sep}
      <button onClick={onPickImage} title="Insert image"
        style={{ background: 'none', color: 'var(--navy-200)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', minWidth: 26, display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
      </button>
      <button onClick={onPickFile} title="Attach file"
        style={{ background: 'none', color: 'var(--navy-200)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', minWidth: 26, display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
      </button>
      <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table"
        style={{ background: 'none', color: 'var(--navy-200)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', minWidth: 26, display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="1" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
      </button>
    </div>
  )
}

function TableToolbar({ editor }: { editor: Editor }) {
  const [showColors, setShowColors] = useState(false)
  const tbtn = (onClick: () => void, label: string, title: string, danger = false) => (
    <button onClick={onClick} title={title}
      style={{ background: 'none', color: danger ? 'var(--red-text)' : 'var(--navy-200)', border: 'none', padding: '3px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      {label}
    </button>
  )
  const div = <span style={{ width: 1, height: 14, background: 'var(--navy-700)', margin: '0 4px' }} />
  return (
    <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, padding: '5px 18px 8px', borderBottom: '1px solid var(--navy-700)' }}>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '.16em', color: 'var(--nw-label)', textTransform: 'uppercase', marginRight: 6 }}>Table</span>
      {tbtn(() => editor.chain().focus().addRowBefore().run(), '+Row↑', 'Add row above')}
      {tbtn(() => editor.chain().focus().addRowAfter().run(), '+Row↓', 'Add row below')}
      {tbtn(() => editor.chain().focus().deleteRow().run(), '−Row', 'Delete row')}
      {div}
      {tbtn(() => editor.chain().focus().addColumnBefore().run(), '+Col←', 'Add column left')}
      {tbtn(() => editor.chain().focus().addColumnAfter().run(), '+Col→', 'Add column right')}
      {tbtn(() => editor.chain().focus().deleteColumn().run(), '−Col', 'Delete column')}
      {div}
      {tbtn(() => editor.chain().focus().toggleHeaderRow().run(), 'Header', 'Toggle header row')}
      {tbtn(() => editor.chain().focus().mergeOrSplit().run(), 'Merge', 'Merge / split cells')}
      {tbtn(() => setShowColors(s => !s), 'Fill ▾', 'Cell color')}
      {div}
      {tbtn(() => editor.chain().focus().deleteTable().run(), '✕ Table', 'Delete table', true)}
      {showColors && (
        <div style={{ position: 'absolute', top: '100%', left: 18, zIndex: 20, display: 'flex', gap: 6, padding: 8, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.35)' }}>
          {CELL_COLORS.map(c => (
            <button key={c.label} title={c.label}
              onClick={() => { editor.chain().focus().setCellAttribute('backgroundColor', c.value).run(); setShowColors(false) }}
              style={{ width: 22, height: 22, borderRadius: 5, cursor: 'pointer', border: '1px solid var(--navy-500)', background: c.value ?? 'transparent', position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              {c.value === null && <span style={{ fontSize: 13, color: 'var(--navy-300)' }}>⊘</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────

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
