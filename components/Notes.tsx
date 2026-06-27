'use client'
/**
 * Notes — restyled Jun 2026 to match Home's instrument-panel aesthetic.
 * Space Grotesk display titles, mono amber section labels, cobalt accent
 * on interactive/selected elements, tabular-mono counts, dense card rows.
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Space, Notebook, Note, RoadmapItem } from '@/lib/types'
import * as notebooksDb from '@/lib/db/notebooks'
import * as notesDb from '@/lib/db/notes'
import { extractNoteText } from '@/lib/noteText'
import { useIsMobile } from '@/lib/useIsMobile'
import { deleteAllMediaForNote } from '@/lib/db/noteMedia'
import { NoteEditor } from './notes/NoteEditor'
import { InboxIcon, LayersIcon, TagIcon, PinIcon, ChevronDown, ChevronRight, Dot, NotebookIcon, NotebookStackIcon } from './Icons'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  roadmapItems: RoadmapItem[]
  notebooks: Notebook[]
  setNotebooks: React.Dispatch<React.SetStateAction<Notebook[]>>
  notes: Note[]
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  tagsByNote: Map<string, string[]>
  setTagsByNote: React.Dispatch<React.SetStateAction<Map<string, string[]>>>
  initialNoteId?: string | null
  onConsumeInitialNoteId?: () => void
  onJumpToTag?: (tag: string) => void
  onFocusChange?: (focused: boolean) => void
  toast: (msg: string) => void
}

type Scope =
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'tag'; tag: string }

function byPinnedThenUpdated(a: Note, b: Note): number {
  const ap = a.pinned_at, bp = b.pinned_at
  if (ap && !bp) return -1
  if (!ap && bp) return 1
  if (ap && bp) return ap < bp ? 1 : -1
  return a.updated_at < b.updated_at ? 1 : -1
}

// ── Design tokens (mirrors Home's instrument-panel palette) ────────
const SIDEBAR_BG   = 'var(--surface)'
const LIST_BG      = 'var(--bg)'
const BORDER       = 'var(--line)'
const LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--nw-label)',
}
const MONO_COUNT: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 10,
  color: 'var(--t-3)',
}

export default function Notes({
  spaces, activeSpaceId, roadmapItems, notebooks, setNotebooks,
  notes, setNotes, tagsByNote, setTagsByNote,
  initialNoteId, onConsumeInitialNoteId, onJumpToTag, onFocusChange, toast,
}: Props) {
  const [scope, setScope] = useState<Scope>({ kind: 'inbox' })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(() => new Set([activeSpaceId]))
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set())
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [newNotebookFor, setNewNotebookFor] = useState<{ spaceId: string; parentId: string | null } | null>(null)
  const [newNotebookDraft, setNewNotebookDraft] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [listView, setListView] = useState<'card' | 'table'>('card')
  const [sortCol, setSortCol] = useState<'title' | 'updated' | 'created' | 'tags'>('updated')
  const [sortAsc, setSortAsc] = useState(false)
  const isMobile = useIsMobile(900)
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false)
  const [mobileListOpen, setMobileListOpen] = useState(false)

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

  const notebooksBySpace = useMemo(() => {
    const map = new Map<string, Notebook[]>()
    for (const nb of notebooks) {
      if (nb.parent_notebook_id !== null) continue
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

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const arr of tagsByNote.values()) for (const t of arr) set.add(t)
    return Array.from(set).sort()
  }, [tagsByNote])

  const counts = useMemo(() => {
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

  const filteredNotes = useMemo(() => {
    if (scope.kind === 'inbox') return notes.filter(n => n.space_id == null && n.notebook_id == null).sort(byPinnedThenUpdated)
    if (scope.kind === 'all') return [...notes].sort(byPinnedThenUpdated)
    if (scope.kind === 'space') return notes.filter(n => n.space_id === scope.spaceId).sort(byPinnedThenUpdated)
    if (scope.kind === 'notebook') {
      const ids = new Set<string>([scope.notebookId])
      for (const c of childrenByParent.get(scope.notebookId) ?? []) ids.add(c.id)
      return notes.filter(n => n.notebook_id && ids.has(n.notebook_id)).sort(byPinnedThenUpdated)
    }
    return notes.filter(n => (tagsByNote.get(n.id) ?? []).includes(scope.tag)).sort(byPinnedThenUpdated)
  }, [notes, scope, childrenByParent, tagsByNote])

  // Sorted note list for table view
  const sortedNotes = useMemo(() => {
    if (listView !== 'table') return filteredNotes
    return [...filteredNotes].sort((a, b) => {
      let av = '', bv = ''
      if (sortCol === 'title') { av = (a.title || '').toLowerCase(); bv = (b.title || '').toLowerCase() }
      else if (sortCol === 'updated') { av = a.updated_at; bv = b.updated_at }
      else if (sortCol === 'created') { av = a.created_at; bv = b.created_at }
      else if (sortCol === 'tags') {
        // sort by tag count then first tag alpha
        const at = tagsByNote.get(a.id) ?? [], bt = tagsByNote.get(b.id) ?? []
        av = at.length > 0 ? `${String(at.length).padStart(3,'0')}${at[0]}` : ''
        bv = bt.length > 0 ? `${String(bt.length).padStart(3,'0')}${bt[0]}` : ''
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortAsc ? cmp : -cmp
    })
  }, [filteredNotes, listView, sortCol, sortAsc, tagsByNote])

  const selectedNote = useMemo(
    () => selectedNoteId ? notes.find(n => n.id === selectedNoteId) ?? null : null,
    [notes, selectedNoteId],
  )

  useEffect(() => {
    if (!selectedNote && fullscreen) { setFullscreen(false); onFocusChange?.(false) }
  }, [selectedNote, fullscreen, onFocusChange])

  // Stats for the stats bar
  const noteStats = useMemo(() => {
    const tagged = filteredNotes.filter(n => (tagsByNote.get(n.id) ?? []).length > 0).length
    const pinned = filteredNotes.filter(n => n.pinned_at).length
    const latest = filteredNotes.length > 0
      ? filteredNotes.reduce((a, b) => a.updated_at > b.updated_at ? a : b).updated_at
      : null
    return { total: filteredNotes.length, tagged, pinned, latest }
  }, [filteredNotes, tagsByNote])

  const middleHeading = useMemo(() => {
    if (scope.kind === 'inbox') return 'Inbox'
    if (scope.kind === 'all') return 'All Notes'
    if (scope.kind === 'space') return spaces.find(s => s.id === scope.spaceId)?.name ?? 'Space'
    if (scope.kind === 'notebook') return notebooks.find(n => n.id === scope.notebookId)?.name ?? 'Notebook'
    return `#${scope.tag}`
  }, [scope, spaces, notebooks])

  // ── Mutations ──────────────────────────────────────────────────────

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
    } catch { toast('Could not create notebook') }
  }, [toast])

  const onRenameNotebook = useCallback(async (id: string, name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const updated = await notebooksDb.rename(id, clean)
      setNotebooks(prev => prev.map(n => n.id === id ? updated : n))
    } catch { toast('Could not rename notebook') }
  }, [toast])

  const onDeleteNotebook = useCallback(async (id: string) => {
    try {
      await notebooksDb.remove(id)
      const cascade = new Set<string>([id])
      let changed = true
      while (changed) {
        changed = false
        for (const nb of notebooks) {
          if (nb.parent_notebook_id && cascade.has(nb.parent_notebook_id) && !cascade.has(nb.id)) {
            cascade.add(nb.id); changed = true
          }
        }
      }
      setNotebooks(prev => prev.filter(n => !cascade.has(n.id)))
      setNotes(prev => prev.map(n => (n.notebook_id && cascade.has(n.notebook_id)) ? { ...n, notebook_id: null } : n))
      if (scope.kind === 'notebook' && cascade.has(scope.notebookId)) {
        const orphan = notes.find(n => n.id === selectedNoteId)
        if (orphan?.space_id) setScope({ kind: 'space', spaceId: orphan.space_id })
        else setScope({ kind: 'inbox' })
      }
    } catch { toast('Could not delete notebook') }
  }, [toast, notebooks, notes, scope, selectedNoteId])

  const onCreateNote = useCallback(async () => {
    let spaceId: string | null = null
    let notebookId: string | null = null
    if (scope.kind === 'notebook') {
      const nb = notebooks.find(n => n.id === scope.notebookId)
      if (!nb) return
      spaceId = nb.space_id; notebookId = nb.id
    } else if (scope.kind === 'space') {
      spaceId = scope.spaceId
    }
    try {
      const created = await notesDb.create({ space_id: spaceId, notebook_id: notebookId })
      setNotes(prev => [created, ...prev])
      setSelectedNoteId(created.id)
    } catch { toast('Could not create note') }
  }, [scope, notebooks, toast])

  const onUpdateNote = useCallback(async (id: string, patch: Partial<Note>) => {
    try {
      const updated = await notesDb.update(id, patch)
      setNotes(prev => prev.map(n => n.id === id ? updated : n))
    } catch { toast('Could not save note') }
  }, [toast])

  const onDeleteNote = useCallback(async (id: string) => {
    try {
      await notesDb.remove(id)
      void deleteAllMediaForNote(id)
      setNotes(prev => prev.filter(n => n.id !== id))
      setTagsByNote(prev => { const next = new Map(prev); next.delete(id); return next })
      if (selectedNoteId === id) setSelectedNoteId(null)
    } catch { toast('Could not delete note') }
  }, [toast, selectedNoteId])

  const onOpenNoteByTitle = useCallback((rawTitle: string) => {
    const title = rawTitle.trim().toLowerCase()
    if (!title) return
    const current = selectedNoteId ? notes.find(n => n.id === selectedNoteId) : null
    const inSpace = current ? notes.find(n => n.space_id === current.space_id && (n.title || '').trim().toLowerCase() === title) : null
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
        if (tags.length === 0) next.delete(id); else next.set(id, tags)
        return next
      })
    } catch { toast('Could not update tags') }
  }, [toast])

  function toggleSpace(spaceId: string) {
    setExpandedSpaces(prev => { const n = new Set(prev); n.has(spaceId) ? n.delete(spaceId) : n.add(spaceId); return n })
  }
  function toggleNotebook(notebookId: string) {
    setExpandedNotebooks(prev => { const n = new Set(prev); n.has(notebookId) ? n.delete(notebookId) : n.add(notebookId); return n })
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div style={{
      display: isMobile ? 'flex' : 'grid',
      flexDirection: isMobile ? 'column' : undefined,
      gridTemplateColumns: isMobile ? undefined : fullscreen ? '0 0 1fr' : '240px 300px 1fr',
      height: 'calc(100vh - 0px)', minHeight: 0,
      transition: 'grid-template-columns .2s ease',
      fontFamily: 'var(--font-body)',
    }}>

      {/* Mobile openers */}
      {isMobile && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, background: SIDEBAR_BG, flexShrink: 0 }}>
          {(['Notebooks', 'Notes'] as const).map((label, i) => {
            const open = i === 0 ? mobileTreeOpen : mobileListOpen
            const toggle = i === 0
              ? () => { setMobileTreeOpen(o => !o); setMobileListOpen(false) }
              : () => { setMobileListOpen(o => !o); setMobileTreeOpen(false) }
            return (
              <button key={label} onClick={toggle} style={{
                flex: 1, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                ...LABEL_STYLE, background: open ? 'var(--hover)' : 'transparent',
                border: 'none', borderRight: i === 0 ? `1px solid ${BORDER}` : 'none', cursor: 'pointer',
              }}>
                <span>{label}</span>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                  <path d="M3 5l3 3 3-3" stroke="var(--t-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )
          })}
        </div>
      )}

      {/* ── LEFT SIDEBAR ── */}
      <aside style={{
        background: SIDEBAR_BG,
        borderRight: (fullscreen || isMobile) ? 'none' : `1px solid ${BORDER}`,
        borderBottom: isMobile ? `1px solid ${BORDER}` : 'none',
        overflow: fullscreen ? 'hidden' : 'auto',
        visibility: fullscreen ? 'hidden' : 'visible',
        ...(isMobile ? { display: mobileTreeOpen ? 'block' : 'none', maxHeight: '60vh', flexShrink: 0 } : {}),
      }}
        onClick={isMobile ? () => setMobileTreeOpen(false) : undefined}>

        {/* SMART VIEWS */}
        <div style={{ padding: '14px 14px 8px' }}>
          <div style={{ ...LABEL_STYLE, marginBottom: 6 }}>Smart views</div>
          <SidebarRow
            icon={<InboxIcon size={13} color="currentColor"/>} label="Inbox" count={counts.inbox}
            active={scope.kind === 'inbox'}
            onClick={() => { setScope({ kind: 'inbox' }); setSelectedNoteId(null) }}
          />
          <SidebarRow
            icon={<LayersIcon size={13} color="currentColor"/>} label="All notes" count={counts.all}
            active={scope.kind === 'all'}
            onClick={() => { setScope({ kind: 'all' }); setSelectedNoteId(null) }}
          />
        </div>

        <div style={{ height: 1, background: BORDER, margin: '4px 0' }} />

        {/* SPACES */}
        <div style={{ padding: '10px 14px 4px' }}>
          <div style={{ ...LABEL_STYLE, marginBottom: 6 }}>Spaces</div>
        </div>

        {spaces.map(space => {
          const isExpanded = expandedSpaces.has(space.id)
          const topLevel = notebooksBySpace.get(space.id) ?? []
          return (
            <div key={space.id}>
              <SpaceRow
                space={space}
                expanded={isExpanded}
                count={counts.bySpace[space.id] ?? 0}
                active={scope.kind === 'space' && scope.spaceId === space.id}
                onToggle={() => toggleSpace(space.id)}
                onSelect={() => { setScope({ kind: 'space', spaceId: space.id }); setSelectedNoteId(null) }}
                onNewNotebook={() => { setNewNotebookFor({ spaceId: space.id, parentId: null }); setNewNotebookDraft('') }}
              />
              {isExpanded && (
                <div>
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
                        if (target && renameDraft.trim() && renameDraft.trim() !== target.name) onRenameNotebook(nbId, renameDraft)
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

        {/* TAGS */}
        {allTags.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 1, background: BORDER, margin: '0 0 4px' }} />
            <div style={{ padding: '10px 14px 4px' }}>
              <div style={{ ...LABEL_STYLE, marginBottom: 6 }}>Tags</div>
            </div>
            {allTags.map(tag => (
              <SidebarRow
                key={tag}
                icon={<TagIcon size={11} color="currentColor"/>}
                label={tag}
                count={counts.byTag[tag] ?? 0}
                active={scope.kind === 'tag' && scope.tag === tag}
                onClick={() => { setScope({ kind: 'tag', tag }); setSelectedNoteId(null) }}
              />
            ))}
          </div>
        )}
      </aside>

      {/* ── MIDDLE: Note list ── */}
      <section style={{
        background: LIST_BG,
        borderRight: (fullscreen || isMobile) ? 'none' : `1px solid ${BORDER}`,
        borderBottom: isMobile ? `1px solid ${BORDER}` : 'none',
        overflow: fullscreen ? 'hidden' : 'auto',
        visibility: fullscreen ? 'hidden' : 'visible',
        display: 'flex', flexDirection: 'column',
        ...(isMobile ? { display: mobileListOpen ? 'flex' : 'none', maxHeight: '60vh', flexShrink: 0 } : {}),
      }}>
        {/* List header — sticky */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px 10px', borderBottom: `1px solid ${BORDER}`,
          position: 'sticky', top: 0, background: LIST_BG, zIndex: 2, flexShrink: 0,
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--t-0)', lineHeight: 1.2 }}>
              {middleHeading}
            </div>
            <div style={{ ...MONO_COUNT, marginTop: 2 }}>{filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {scope.kind !== 'tag' && (
              <button onClick={onCreateNote} title="New note" style={{
                width: 26, height: 26, border: 'none', borderRadius: 5,
                background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, lineHeight: 1, fontFamily: 'inherit', fontWeight: 300, flexShrink: 0,
              }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '.85' }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}>
                +
              </button>
            )}
            {/* View toggle — card / table */}
            {!isMobile && (
              <div style={{ display: 'flex', gap: 2, background: 'var(--surface-2)', borderRadius: 6, padding: 2 }}>
                <button title="Card view" onClick={() => setListView('card')} style={{
                  width: 26, height: 22, background: listView === 'card' ? 'var(--surface)' : 'none',
                  border: 'none', borderRadius: 4, cursor: 'pointer', color: listView === 'card' ? 'var(--accent)' : 'var(--t-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: listView === 'card' ? '0 1px 3px rgba(0,0,0,.3)' : 'none',
                }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="2" width="12" height="5" rx="1"/><rect x="2" y="9" width="12" height="5" rx="1"/>
                  </svg>
                </button>
                <button title="Table view" onClick={() => setListView('table')} style={{
                  width: 26, height: 22, background: listView === 'table' ? 'var(--surface)' : 'none',
                  border: 'none', borderRadius: 4, cursor: 'pointer', color: listView === 'table' ? 'var(--accent)' : 'var(--t-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: listView === 'table' ? '0 1px 3px rgba(0,0,0,.3)' : 'none',
                }}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="1.5" y="2" width="13" height="12" rx="1"/>
                    <path d="M1.5 6h13M1.5 10h13M5.5 2v12M10.5 2v12"/>
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stats bar */}
        {filteredNotes.length > 0 && !isMobile && (
          <div style={{
            display: 'flex', borderBottom: `1px solid ${BORDER}`,
            background: 'var(--surface)', flexShrink: 0,
          }}>
            {([
              { val: noteStats.total, label: 'notes' },
              { val: noteStats.tagged, label: 'tagged' },
              { val: noteStats.pinned, label: 'pinned' },
              { val: noteStats.latest ? formatRelative(noteStats.latest) : '—', label: 'latest' },
            ] as { val: string | number; label: string }[]).map((s, i, arr) => (
              <div key={s.label} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '6px 0', gap: 1,
                borderRight: i < arr.length - 1 ? `1px solid ${BORDER}` : 'none',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                  fontSize: 13, fontWeight: 700, color: 'var(--t-0)', lineHeight: 1,
                }}>{s.val}</div>
                <div style={{ ...LABEL_STYLE, fontSize: 9, letterSpacing: '.14em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {filteredNotes.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8, display: 'block' }}>No notes</div>
            {scope.kind !== 'tag' && (
              <div style={{ fontSize: 12.5, color: 'var(--t-3)' }}>Hit + to create one.</div>
            )}
          </div>
        ) : listView === 'table' ? (
          /* ── TABLE VIEW ── */
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Sort header row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 72px 72px 96px',
              alignItems: 'center', padding: '0 12px', height: 30,
              borderBottom: `1px solid ${BORDER}`,
              background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 1,
            }}>
              {(['title', 'updated', 'created', 'tags'] as const).map(col => (
                <button key={col} onClick={() => {
                  if (sortCol === col) setSortAsc(a => !a)
                  else { setSortCol(col); setSortAsc(col === 'title') }
                }} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
                  letterSpacing: '.12em', textTransform: 'uppercase',
                  color: sortCol === col ? 'var(--nw-label)' : 'var(--t-3)',
                  textAlign: 'left', padding: 0, fontVariantNumeric: 'tabular-nums',
                }}>
                  {col}
                  {sortCol === col && (
                    <span style={{ fontSize: 9 }}>{sortAsc ? '↑' : '↓'}</span>
                  )}
                </button>
              ))}
            </div>
            {/* Table rows */}
            {sortedNotes.map(note => {
              const tags = tagsByNote.get(note.id) ?? []
              const sel = selectedNoteId === note.id
              return (
                <button key={note.id} onClick={() => { setSelectedNoteId(note.id); if (isMobile) setMobileListOpen(false) }}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 72px 72px 96px',
                    alignItems: 'center', width: '100%', padding: '0 12px', height: 36,
                    border: 'none', borderBottom: `1px solid ${BORDER}`,
                    borderLeft: `3px solid ${sel ? 'var(--accent)' : 'transparent'}`,
                    background: sel ? 'var(--accent-bg)' : 'none',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--hover)' }}
                  onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'none' }}>
                  {/* Title */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
                    color: sel ? 'var(--accent-2)' : 'var(--t-0)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    paddingRight: 8,
                  }}>
                    {note.pinned_at && (
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
                    )}
                    {note.title || <span style={{ color: 'var(--t-3)', fontStyle: 'italic' }}>Untitled</span>}
                  </div>
                  {/* Updated */}
                  <div style={{ ...MONO_COUNT, fontSize: 10.5 }}>{formatRelative(note.updated_at)}</div>
                  {/* Created */}
                  <div style={{ ...MONO_COUNT, fontSize: 10.5 }}>{formatDateShort(note.created_at)}</div>
                  {/* Tags */}
                  <div style={{ display: 'flex', gap: 3, overflow: 'hidden' }}>
                    {tags.slice(0, 2).map(t => (
                      <span key={t} style={{
                        fontSize: 9.5, fontWeight: 600, padding: '1px 5px', borderRadius: 99,
                        background: 'var(--accent-bg)', color: 'var(--accent)',
                        fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                      }}>#{t}</span>
                    ))}
                    {tags.length > 2 && <span style={{ ...MONO_COUNT, fontSize: 9.5 }}>+{tags.length - 2}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          /* ── CARD VIEW ── */
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredNotes.map(note => (
              <NoteListItem
                key={note.id}
                note={note}
                tags={tagsByNote.get(note.id) ?? []}
                selected={selectedNoteId === note.id}
                onClick={() => { setSelectedNoteId(note.id); if (isMobile) setMobileListOpen(false) }}
                onTagClick={onJumpToTag}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── RIGHT: Editor ── */}
      <section style={{
        overflowY: 'auto',
        background: 'var(--bg)',
        ...(isMobile ? { flex: 1, minHeight: 0 } : {}),
      }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <div style={{ ...LABEL_STYLE }}>Select a note</div>
            <div style={{ fontSize: 12.5, color: 'var(--t-3)' }}>or hit + to create one</div>
          </div>
        )}
      </section>

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

// ── Sub-components ──────────────────────────────────────────────────

/** Generic sidebar row — smart views, tags */
function SidebarRow({ icon, label, count, active, onClick }: {
  icon?: React.ReactNode; label: string; count?: number; active?: boolean; onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 'calc(100% - 12px)', margin: '1px 6px', display: 'flex', alignItems: 'center', gap: 7,
        padding: '5px 8px', border: 'none', borderRadius: 5, cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : hover ? 'var(--hover)' : 'transparent',
        fontFamily: 'inherit', textAlign: 'left',
        position: 'relative',
      }}>
      {active && <span style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, borderRadius: '0 3px 3px 0', background: 'var(--accent)' }} />}
      {icon && <span style={{ width: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}>{icon}</span>}
      <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 600 : 500, color: active ? 'var(--accent-2)' : 'var(--t-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count != null && count > 0 && <span style={{ ...MONO_COUNT, color: active ? 'var(--accent)' : 'var(--t-3)' }}>{count}</span>}
    </button>
  )
}

/** Space row with color dot — matches Home's space header style */
function SpaceRow({ space, expanded, count, active, onToggle, onSelect, onNewNotebook }: {
  space: Space; expanded: boolean; count: number; active: boolean
  onToggle: () => void; onSelect: () => void; onNewNotebook: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 14px 5px 10px', cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : hover ? 'var(--hover)' : 'transparent',
        position: 'relative',
      }}
      onClick={onSelect}>
      {active && <span style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, borderRadius: '0 3px 3px 0', background: 'var(--accent)' }} />}
      <span onClick={e => { e.stopPropagation(); onToggle() }}
        style={{ width: 14, textAlign: 'center', color: 'var(--t-3)', fontSize: 9, cursor: 'pointer', flexShrink: 0 }}>
        {expanded ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}
      </span>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: space.color, flexShrink: 0, boxShadow: `0 0 0 1px ${space.color}44` }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: active ? 'var(--accent-2)' : 'var(--t-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
      {hover ? (
        <button onClick={e => { e.stopPropagation(); onNewNotebook() }} title="New notebook"
          style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: '1px 4px', cursor: 'pointer', borderRadius: 3, fontSize: 14, lineHeight: 1, fontFamily: 'inherit' }}>
          +
        </button>
      ) : (
        count > 0 && <span style={{ ...MONO_COUNT, color: active ? 'var(--accent)' : 'var(--t-3)' }}>{count}</span>
      )}
    </div>
  )
}

function NotebookBranch(props: {
  notebook: Notebook; depth: number
  childrenByParent: Map<string, Notebook[]>
  counts: { byNotebook: Record<string, number> }
  scope: Scope; expandedNotebooks: Set<string>
  onToggleNotebook: (id: string) => void
  onSelect: (id: string) => void
  onStartRename: (id: string, name: string) => void
  onCommitRename: (id: string) => void
  onCancelRename: () => void
  renamingNotebookId: string | null; renameDraft: string; setRenameDraft: (v: string) => void
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

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

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
          padding: '4px 8px', background: 'var(--surface-2)', border: '1px solid var(--accent)',
          borderRadius: 5, color: 'var(--t-0)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
        }} />
    )
  }

  const indent = 14 + depth * 14

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <button onClick={() => { if (isStack) props.onToggleNotebook(notebook.id); props.onSelect(notebook.id) }}
        style={{
          width: 'calc(100% - 12px)', margin: '1px 6px', display: 'flex', alignItems: 'center', gap: 6,
          padding: `4px 8px 4px ${indent}px`, border: 'none', borderRadius: 5, cursor: 'pointer',
          background: isActive ? 'var(--accent-bg)' : hover ? 'var(--hover)' : 'transparent',
          color: isActive ? 'var(--accent-2)' : 'var(--t-1)',
          fontSize: 12.5, fontWeight: isActive ? 600 : 400, fontFamily: 'inherit', textAlign: 'left',
          position: 'relative',
        }}>
        {isActive && <span style={{ position: 'absolute', left: 6, top: 4, bottom: 4, width: 3, borderRadius: '0 3px 3px 0', background: 'var(--accent)' }} />}
        <span style={{ width: 10, textAlign: 'center', color: 'var(--t-3)', fontSize: 9, flexShrink: 0 }}>
          {isStack ? (expanded ? <ChevronDown size={9}/> : <ChevronRight size={9}/>) : <Dot size={8}/>}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notebook.name}</span>
        {!hover && (props.counts.byNotebook[notebook.id] ?? 0) > 0 && (
          <span style={{ ...MONO_COUNT, color: isActive ? 'var(--accent)' : 'var(--t-3)' }}>{props.counts.byNotebook[notebook.id]}</span>
        )}
      </button>

      {hover && (
        <button onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
          style={{ position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--t-3)', padding: '2px 5px',
            borderRadius: 3, cursor: 'pointer', fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>
          ⋯
        </button>
      )}

      {menuOpen && (
        <div style={{ position: 'absolute', top: '100%', right: 6, zIndex: 30, marginTop: 2,
          background: 'var(--surface)', border: `1px solid ${BORDER}`, borderRadius: 7,
          padding: 4, minWidth: 160, boxShadow: 'var(--card-shadow)' }}>
          {depth <= 2 && (
            <MenuBtn onClick={() => { props.onAddChild(notebook.id); setMenuOpen(false) }}>+ New sub-notebook</MenuBtn>
          )}
          <MenuBtn onClick={() => { props.onStartRename(notebook.id, notebook.name); setMenuOpen(false) }}>Rename</MenuBtn>
          <MenuBtn onClick={() => { props.onDelete(notebook.id, notebook.name); setMenuOpen(false) }} danger>Delete</MenuBtn>
        </div>
      )}

      {expanded && children.map(child => (
        <NotebookBranch key={child.id} {...props} notebook={child} depth={depth + 1} />
      ))}
    </div>
  )
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
      padding: '6px 10px', fontSize: 12.5, color: danger ? 'var(--alarm)' : 'var(--t-1)',
      cursor: 'pointer', borderRadius: 4, fontFamily: 'inherit',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      {children}
    </button>
  )
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
        width: `calc(100% - 20px - ${indent * 14}px)`, marginLeft: 10 + indent * 14, marginRight: 10,
        marginTop: 2, padding: '4px 8px',
        background: 'var(--surface-2)', border: '1px solid var(--accent)',
        borderRadius: 5, color: 'var(--t-0)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
      }} />
  )
}

function SubNotebookInputPortal({ value, setValue, onCommit, onCancel }: {
  parentId: string; value: string; setValue: (v: string) => void; onCommit: () => void; onCancel: () => void
}) {
  return (
    <div style={{ position: 'fixed', bottom: 24, left: 260, zIndex: 50,
      background: 'var(--surface)', border: `1px solid ${BORDER}`, borderRadius: 10,
      padding: '10px 12px', boxShadow: 'var(--card-shadow)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ ...LABEL_STYLE }}>Sub-notebook</span>
      <input autoFocus value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Name…"
        style={{ padding: '4px 8px', background: 'var(--surface-2)', border: `1px solid ${BORDER}`,
          borderRadius: 5, color: 'var(--t-0)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', width: 180 }} />
      <button onClick={onCommit} style={{ padding: '4px 10px', background: 'var(--accent)', border: 'none', borderRadius: 5, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Create</button>
      <button onClick={onCancel} style={{ padding: '4px 6px', background: 'none', border: 'none', color: 'var(--t-3)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>×</button>
    </div>
  )
}

/** Note list row — Space Grotesk title, tighter metadata, cobalt selected state */
function NoteListItem({ note, tags, selected, onClick, onTagClick }: {
  note: Note; tags: string[]; selected: boolean; onClick: () => void; onTagClick?: (tag: string) => void
}) {
  const preview = useMemo(() => extractNoteText(note.body).slice(0, 120), [note.body])
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '10px 16px',
        borderTop: 'none', borderRight: 'none', borderBottom: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${selected ? 'var(--accent)' : 'transparent'}`,
        background: selected ? 'var(--accent-bg)' : hover ? 'var(--hover)' : 'transparent',
        cursor: 'pointer', fontFamily: 'inherit', transition: 'background .1s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
        {note.pinned_at && <PinIcon size={11} color="var(--accent)" style={{ flexShrink: 0 }}/>}
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13.5, fontWeight: 600,
          color: selected ? 'var(--accent-2)' : note.title ? 'var(--t-0)' : 'var(--t-3)',
          fontStyle: note.title ? 'normal' : 'italic',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {note.title || 'Untitled'}
        </span>
      </div>
      {preview && (
        <div style={{
          fontSize: 11.5, color: 'var(--t-2)', lineHeight: 1.45, marginBottom: 6,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {preview}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...MONO_COUNT }}>{formatRelative(note.updated_at)}</span>
        {tags.slice(0, 3).map(t => (
          <span key={t}
            onClick={e => { if (onTagClick) { e.stopPropagation(); onTagClick(t) } }}
            style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
              background: 'var(--accent-bg)', color: 'var(--accent)',
              cursor: onTagClick ? 'pointer' : 'default', fontFamily: 'var(--font-mono)',
            }}>
            #{t}
          </span>
        ))}
        {tags.length > 3 && <span style={{ ...MONO_COUNT }}>+{tags.length - 3}</span>}
      </div>
    </button>
  )
}

function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
