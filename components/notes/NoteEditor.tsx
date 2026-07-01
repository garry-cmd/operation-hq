import { useIsMobile } from '@/lib/useIsMobile'
'use client'
import React from 'react'
import { InboxIcon } from '../Icons'
/**
 * NoteEditor — the standalone TipTap note editor, extracted from Notes.tsx so
 * it can be mounted anywhere (the Notes module's right pane AND the Home
 * cockpit's KR/note work views). Owns its own autosave, version snapshots,
 * media upload + GC, internal-link resolution, tables, and the move/link/
 * history panels. The host supplies the note + persistence callbacks.
 */
import { useEffect, useState, useCallback, useRef, useReducer } from 'react'
import { Space, Notebook, Note, NoteBody, NoteVersion, RoadmapItem } from '@/lib/types'
import * as noteVersionsDb from '@/lib/db/noteVersions'
import { noteToMarkdown } from '@/lib/notes/noteMarkdown'
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
import { uploadNoteImage, uploadNoteFile, deleteNoteMedia } from '@/lib/db/noteMedia'

const EMPTY_DOC: NoteBody = { type: 'doc', content: [{ type: 'paragraph' }] }

export function NoteEditor({ note, tags, spaces, roadmapItems, notebooks, fullscreen, onToggleFullscreen, onPatch, onSetTags, onOpenNoteByTitle, onDelete }: {
  note: Note;
  tags: string[];
  spaces: Space[];
  roadmapItems: RoadmapItem[];
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
  const [linkOpen, setLinkOpen] = useState(false)
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

  // KR link: the note's linked KR (if any), and the setter the picker calls.
  const linkedKR = note.roadmap_item_id
    ? roadmapItems.find(k => k.id === note.roadmap_item_id) ?? null
    : null
  function linkTo(krId: string | null) {
    onPatch({ roadmap_item_id: krId })
    setLinkOpen(false)
  }

  // In fullscreen / focus mode, give the editor a much wider column than the
  // cramped default — roomy for tables while keeping prose line-length sane.
  const innerStyle: React.CSSProperties = fullscreen
    ? { maxWidth: 1100, margin: '0 auto', width: '100%' }
    : {}

  // Breadcrumb: resolve space + notebook names
  const noteSpace = note.space_id ? spaces.find(s => s.id === note.space_id) : null
  const noteNotebook = note.notebook_id ? notebooks.find(n => n.id === note.notebook_id) : null

  const [moreOpen, setMoreOpen] = useState(false)
  const isMobile = useIsMobile(900)
  const moreRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!moreOpen) return
    function onDoc(e: MouseEvent) { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Breadcrumb bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 16px', height: 40, flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
      }}>
        {/* Back / collapse */}
        {!isMobile && <button onClick={onToggleFullscreen} title={fullscreen ? 'Exit focus mode' : 'Focus mode'}
          style={{ background: 'none', border: 'none', color: 'var(--t-3)', cursor: 'pointer', padding: '4px', display: 'inline-flex', alignItems: 'center', borderRadius: 4 }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--t-1)'; e.currentTarget.style.background = 'var(--hover)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-3)'; e.currentTarget.style.background = 'none' }}>
          {fullscreen
            ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M10 1.5v3.5h3.5M10 5l4-4M6 14.5v-3.5H2.5M6 11l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            : <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          }
        </button>}

        {/* Breadcrumb path */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' }}>
          {noteSpace && (
            <>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: noteSpace.color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-2)', whiteSpace: 'nowrap' }}>{noteSpace.name}</span>
            </>
          )}
          {noteNotebook && (
            <>
              <span style={{ color: 'var(--t-3)', fontSize: 11 }}>›</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{noteNotebook.name}</span>
            </>
          )}
          {!noteSpace && !noteNotebook && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-3)' }}>Inbox</span>
          )}
        </div>

        {/* Save state */}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--t-3)', flexShrink: 0 }}>
          {uploadState === 'uploading' ? 'Uploading…'
            : uploadState === 'error' ? '⚠ ' + uploadErr
            : saveState === 'saving' ? 'Saving…'
            : saveState === 'saved' ? '✓' : ''}
        </span>

        {/* ⋯ More menu */}
        <div ref={moreRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => { setMoreOpen(o => !o); setMoveOpen(false); setLinkOpen(false); setHistoryOpen(false) }}
            title="More options"
            style={{
              background: moreOpen ? 'var(--hover)' : 'none', border: 'none', borderRadius: 5,
              color: 'var(--t-2)', cursor: 'pointer', padding: '7px 10px',
              display: 'inline-flex', alignItems: 'center', fontSize: 16, lineHeight: 1,
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
            onMouseLeave={e => { if (!moreOpen) e.currentTarget.style.background = 'none' }}>
            ⋯
          </button>

          {moreOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50,
              width: 220, background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 9, padding: 4, boxShadow: '0 8px 32px rgba(0,0,0,.5)',
            }}>
              {/* Pin */}
              <MoreItem icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 11v4"/><path d="M5.5 2h5l-.75 5 2.25 2H4l2.25-2L5.5 2z"/></svg>
              } label={pinned ? 'Unpin' : 'Pin to top'} onClick={() => { togglePin(); setMoreOpen(false) }} active={pinned} />

              {/* Link to KR */}
              <MoreItem icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l1.5-1.5a3.5 3.5 0 0 0-5-5l-.75.75"/><path d="M9.5 6.5a3.5 3.5 0 0 0-5 0L3 8a3.5 3.5 0 0 0 5 5l.75-.75"/></svg>
              } label={linkedKR ? 'Change KR link' : 'Link to KR'} active={!!linkedKR}
                onClick={() => { setMoreOpen(false); setMoveOpen(false); setHistoryOpen(false); setLinkOpen(o => !o) }} />

              <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />

              {/* Move */}
              <MoreItem icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 6a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V6z"/></svg>
              } label="Move" onClick={() => { setMoreOpen(false); setLinkOpen(false); setHistoryOpen(false); setMoveOpen(o => !o) }} />

              <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />

              {/* History */}
              <MoreItem icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2v4h4"/><path d="M2.05 9A7 7 0 1 0 4 4.8L2 7"/><path d="M8 5v4l2.5 1.5"/></svg>
              } label="Note history" onClick={() => { setMoreOpen(false); setLinkOpen(false); setMoveOpen(false); openHistory() }} />

              {/* Export */}
              <MoreItem icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9"/><path d="M5 8l3 3 3-3"/><path d="M3 13h10"/></svg>
              } label="Export as Markdown" onClick={() => { setMoreOpen(false); exportMarkdown() }} />

              <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />

              {/* Delete */}
              <MoreItem icon={
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 4h11M5.5 4V2.5h5V4M6.5 7v5M9.5 7v5M3.5 4l.75 9.5h7.5L12.5 4"/></svg>
              } label="Delete note" danger onClick={() => { setMoreOpen(false); onDelete() }} />
            </div>
          )}
        </div>
      </div>

      {/* Floating panels — anchored below breadcrumb bar */}
      <div style={{ position: 'relative' }}>
        {moveOpen && (
          <div style={{ position: 'absolute', top: 0, right: 8, zIndex: 40 }}>
            <MovePanel spaces={spaces} notebooks={notebooks} note={note} onMove={moveTo} onClose={() => setMoveOpen(false)} />
          </div>
        )}
        {linkOpen && (
          <div style={{ position: 'absolute', top: 0, right: 8, zIndex: 40 }}>
            <LinkKRPanel spaces={spaces} roadmapItems={roadmapItems} note={note} onLink={linkTo} onClose={() => setLinkOpen(false)} />
          </div>
        )}
        {historyOpen && (
          <div style={{ position: 'absolute', top: 0, right: 8, zIndex: 40 }}>
            <HistoryPanel versions={versions} loading={versionsLoading} onRestore={restoreVersion} onClose={() => setHistoryOpen(false)} />
          </div>
        )}
      </div>

      {/* ── Title ── */}
      <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
        <div style={innerStyle}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
            placeholder="Title"
            style={{
              width: '100%', border: 'none', background: 'transparent',
              fontSize: 30, fontWeight: 700, color: 'var(--t-0)',
              letterSpacing: '-.03em', lineHeight: 1.2,
              outline: 'none', fontFamily: 'var(--font-display)', padding: '0',
            }} />
        </div>
      </div>

      {/* ── Tags + KR link row ── */}
      <div style={{ padding: '10px 28px 12px', flexShrink: 0 }}>
        <div style={{ ...innerStyle, display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {linkedKR && (() => {
            const krSpace = spaces.find(s => s.id === linkedKR.space_id) ?? null
            return (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--accent-bg)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 220 }}>
                {krSpace && <span style={{ width: 6, height: 6, borderRadius: '50%', background: krSpace.color, flexShrink: 0 }} />}
                <button onClick={() => { setMoreOpen(false); setMoveOpen(false); setHistoryOpen(false); setLinkOpen(true) }}
                  title={`Linked KR: ${linkedKR.title}`}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 11, fontFamily: 'inherit', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {linkedKR.title}
                </button>
                <button onClick={() => linkTo(null)} title="Unlink KR" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
              </span>
            )
          })()}
          {tags.map(t => (
            <span key={t} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'var(--accent-bg)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)' }}>
              #{t}
              <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}>×</button>
            </span>
          ))}
          <input value={tagInput} onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="+ tag"
            style={{ background: 'none', border: 'none', color: 'var(--t-3)', fontSize: 11.5, fontFamily: 'var(--font-mono)', outline: 'none', width: 64 }} />
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 28px 60px' }}>
        <div style={innerStyle}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Editor styles injected once; scoped to .notes-editor */}
      <style>{`
        .notes-editor { outline: none; min-height: 200px; color: var(--t-0); font-size: 14.5px; line-height: 1.7; }
        .notes-editor p { margin: 0 0 12px; }
        .notes-editor h1 { font-family: var(--font-display); font-size: 22px; font-weight: 700; margin: 20px 0 10px; color: var(--t-0); }
        .notes-editor h2 { font-family: var(--font-display); font-size: 18px; font-weight: 700; margin: 18px 0 8px; color: var(--t-0); }
        .notes-editor h3 { font-family: var(--font-display); font-size: 15px; font-weight: 700; margin: 14px 0 6px; color: var(--t-0); }
        .notes-editor ul { list-style-type: disc; padding-left: 22px; margin: 0 0 10px; }
        .notes-editor ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 10px; }
        .notes-editor ul ul { list-style-type: circle; }
        .notes-editor ul ul ul { list-style-type: square; }
        .notes-editor li { margin: 3px 0; }
        .notes-editor code { background: var(--surface-2, var(--navy-700)); padding: 1px 5px; border-radius: 3px; font-family: var(--font-mono); font-size: 12.5px; }
        .notes-editor pre { background: var(--surface); padding: 10px 14px; border-radius: 7px; margin: 0 0 12px; overflow-x: auto; }
        .notes-editor pre code { background: none; padding: 0; }
        .notes-editor blockquote { border-left: 3px solid var(--accent); padding-left: 14px; margin: 12px 0; color: var(--t-2); }
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
          color: var(--t-3);
          float: left;
          height: 0;
          pointer-events: none;
          font-style: italic;
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

function MoreItem({ icon, label, onClick, danger, active }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; active?: boolean
}) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
      padding: '6px 10px', border: 'none', borderRadius: 5, cursor: 'pointer',
      background: 'none', fontFamily: 'inherit', fontSize: 13,
      color: danger ? 'var(--alarm, #e05c5c)' : active ? 'var(--accent)' : 'var(--t-1)',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', color: danger ? 'var(--alarm, #e05c5c)' : active ? 'var(--accent)' : 'var(--t-3)', flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 40,
  width: 270, background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
}
const panelHeaderStyle: React.CSSProperties = {
  padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em',
  textTransform: 'uppercase', color: 'var(--nw-label)', borderBottom: '1px solid var(--navy-700)',
}
const panelEmptyStyle: React.CSSProperties = {
  padding: '14px 12px', fontSize: 11.5, color: 'var(--navy-400)', lineHeight: 1.5,
}

function PanelRow({ label, active, onClick, indent, bold }: {
  label: React.ReactNode; active?: boolean; onClick: () => void; indent?: boolean; bold?: boolean
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
        <PanelRow label={<span style={{display:'inline-flex',alignItems:'center',gap:4}}><InboxIcon size={12}/>Inbox (no space)</span>} active={here(null, null)} onClick={() => onMove(null, null)} />
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

function LinkKRPanel({ spaces, roadmapItems, note, onLink, onClose }: {
  spaces: Space[]; roadmapItems: RoadmapItem[]; note: Note;
  onLink: (krId: string | null) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  // Linkable KRs = live ones (not parked, not done), grouped by space in the
  // app's space order; only spaces with ≥1 linkable KR appear.
  const linkable = roadmapItems.filter(k => !k.is_parked && k.health_status !== 'done')
  const groups = spaces
    .map(sp => ({ space: sp, krs: linkable.filter(k => k.space_id === sp.id) }))
    .filter(g => g.krs.length > 0)
  return (
    <div ref={ref} style={panelStyle}>
      <div style={panelHeaderStyle}>Link to KR</div>
      <div style={{ maxHeight: 340, overflowY: 'auto', padding: 4 }}>
        <PanelRow label="✕ No KR link" active={!note.roadmap_item_id} onClick={() => onLink(null)} />
        {groups.length === 0 ? (
          <div style={panelEmptyStyle}>No active KRs to link. Create a KR on the Roadmap first.</div>
        ) : groups.map(({ space, krs }) => (
          <div key={space.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: space.color, flexShrink: 0 }} />
              {space.name}
            </div>
            {krs.map(kr => (
              <PanelRow key={kr.id} label={kr.title} indent active={note.roadmap_item_id === kr.id} onClick={() => onLink(kr.id)} />
            ))}
          </div>
        ))}
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
        background: active ? 'var(--accent-bg)' : 'none',
        color: active ? 'var(--accent)' : 'var(--t-2)',
        border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit', minWidth: 26,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--hover)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}>
      {label}
    </button>
  )
  const sep = <span style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 2px' }} />
  return (
    <div style={{ display: 'flex', gap: 2, padding: '4px 22px 8px', borderBottom: '1px solid var(--line)', background: 'var(--surface)', flexShrink: 0, flexWrap: 'wrap' }}>
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
        style={{ background: 'none', color: 'var(--t-2)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', minWidth: 26, display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
      </button>
      <button onClick={onPickFile} title="Attach file"
        style={{ background: 'none', color: 'var(--t-2)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', minWidth: 26, display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
      </button>
      <button onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table"
        style={{ background: 'none', color: 'var(--t-2)', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', minWidth: 26, display: 'inline-flex', alignItems: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
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
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
      {label}
    </button>
  )
  const div = <span style={{ width: 1, height: 14, background: 'var(--line)', margin: '0 4px' }} />
  return (
    <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, padding: '5px 22px 8px', borderBottom: '1px solid var(--line)', background: 'var(--surface)', flexShrink: 0 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', color: 'var(--nw-label)', textTransform: 'uppercase', marginRight: 6 }}>Table</span>
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

// ── Helpers (duplicated from Notes.tsx; tiny pure date formatter) ──
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
