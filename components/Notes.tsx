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
import { Space, Notebook, Note, NoteTag, RoadmapItem } from '@/lib/types'
import * as notebooksDb from '@/lib/db/notebooks'
import * as notesDb from '@/lib/db/notes'
import { extractNoteText } from '@/lib/noteText'
import { useIsMobile } from '@/lib/useIsMobile'
import { deleteAllMediaForNote } from '@/lib/db/noteMedia'
import { NoteEditor } from './notes/NoteEditor'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  // All-spaces KR list — powers the editor's Link-to-KR picker.
  roadmapItems: RoadmapItem[]
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

// Pinned notes float to the top (newest pin first); the rest by recency.
function byPinnedThenUpdated(a: Note, b: Note): number {
  const ap = a.pinned_at, bp = b.pinned_at
  if (ap && !bp) return -1
  if (!ap && bp) return 1
  if (ap && bp) return ap < bp ? 1 : -1
  return a.updated_at < b.updated_at ? 1 : -1
}

export default function Notes({ spaces, activeSpaceId, roadmapItems, notebooks, setNotebooks, notes, setNotes, tagsByNote, setTagsByNote, initialNoteId, onConsumeInitialNoteId, onJumpToTag, onFocusChange, toast }: Props) {
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
          <div style={{ padding: '0 8px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Smart views</div>
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
        <div style={{ padding: '14px 14px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Spaces</div>

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
            <div style={{ padding: '0 8px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Tags</div>
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
            roadmapItems={roadmapItems}
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
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--navy-400)', fontVariantNumeric: 'tabular-nums' }}>{formatRelative(note.updated_at)}</span>
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
