'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadNoteImage } from '@/lib/db/noteMedia'
import * as notesDb from '@/lib/db/notes'
import { Note } from '@/lib/types'

const MY_OKRS_SPACE_ID = 'd759151f-8a6c-4c28-9fe1-db303f4ecf3a'

// Build a minimal TipTap doc containing a single image node (path-based,
// matches the imageWithPath extension used in the main Notes editor).
function makeImageDoc(path: string) {
  return {
    type: 'doc',
    content: [
      {
        type: 'imageWithPath',
        attrs: { path, src: null, alt: null, title: null },
      },
      { type: 'paragraph', content: [] },
    ],
  }
}

// Append an image node to an existing TipTap doc body.
function appendImageToDoc(
  existing: Record<string, unknown> | null,
  path: string,
): Record<string, unknown> {
  const imageNode = {
    type: 'imageWithPath',
    attrs: { path, src: null, alt: null, title: null },
  }
  const paragraphNode = { type: 'paragraph', content: [] }
  if (!existing || existing.type !== 'doc') {
    return { type: 'doc', content: [imageNode, paragraphNode] }
  }
  const content = Array.isArray(existing.content) ? [...existing.content] : []
  return { ...existing, content: [...content, imageNode, paragraphNode] }
}

type Mode = 'new' | 'existing'
type Phase = 'preview' | 'pick-note' | 'saving' | 'done' | 'error' | 'no-image'

export default function SharePage() {
  const [phase, setPhase] = useState<Phase>('preview')
  const [mode, setMode] = useState<Mode>('new')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNoteId, setSelectedNoteId] = useState<string>('')
  const [noteTitle, setNoteTitle] = useState('')
  const [search, setSearch] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [doneNoteId, setDoneNoteId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // On mount: read the shared file from the POST form data via the
  // FormData API (the browser populates it before the page renders).
  useEffect(() => {
    async function readSharedImage() {
      try {
        // The share target POST lands as a navigation; we read via
        // navigator.serviceWorker share-target interception, but for
        // a simple setup we use the sessionStorage relay approach:
        // iOS Safari stores the share data in a synthetic form and we
        // can read it from the page's own body via fetch('/share', method GET
        // won't work). Instead we read the current URL search params for
        // text/title, and for the file we rely on the service worker
        // relaying it via the Cache API or sessionStorage.
        //
        // Simplest working pattern for Next.js without a custom SW:
        // The POST hits /share, Next.js renders this client component,
        // and the file is NOT available in JS (it was a navigation-level
        // POST). We instead present a camera/file picker immediately so
        // the user can capture or select — this is the correct fallback
        // for the non-SW share target case.
        //
        // For the URL params (title/text), pull them in case user shared
        // a link with text.
        const params = new URLSearchParams(window.location.search)
        const sharedTitle = params.get('title') || ''
        if (sharedTitle) setNoteTitle(sharedTitle)

        // No file available from POST without a service worker relay.
        // Show the camera picker immediately.
        setPhase('preview')
      } catch {
        setPhase('preview')
      }
    }
    readSharedImage()
  }, [])

  // When a file is selected/captured, generate preview.
  useEffect(() => {
    if (!imageFile) return
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  // Load My OKRs notes for the picker.
  useEffect(() => {
    if (phase !== 'pick-note') return
    async function load() {
      const { data } = await supabase
        .from('notes')
        .select('id, title, updated_at, space_id, notebook_id, body, body_format, pinned_at, sort_order, created_at, roadmap_item_id')
        .eq('space_id', MY_OKRS_SPACE_ID)
        .order('updated_at', { ascending: false })
      setNotes((data ?? []) as Note[])
    }
    load()
  }, [phase])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) setImageFile(f)
  }

  async function handleSave() {
    if (!imageFile) return
    setPhase('saving')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in')

      if (mode === 'new') {
        // Create note first (need ID for storage path)
        const note = await notesDb.create({
          space_id: MY_OKRS_SPACE_ID,
          notebook_id: null,
          title: noteTitle.trim() || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        })
        const { path } = await uploadNoteImage(note.id, imageFile)
        await notesDb.update(note.id, { body: makeImageDoc(path) as never })
        setDoneNoteId(note.id)
      } else {
        if (!selectedNoteId) throw new Error('No note selected')
        const note = notes.find(n => n.id === selectedNoteId)
        if (!note) throw new Error('Note not found')
        const { path } = await uploadNoteImage(note.id, imageFile)
        const newBody = appendImageToDoc(
          note.body as Record<string, unknown> | null,
          path,
        )
        await notesDb.update(note.id, { body: newBody as never })
        setDoneNoteId(note.id)
      }
      setPhase('done')
    } catch (e: unknown) {
      setErrorMsg(e && typeof e === 'object' && 'message' in e ? String((e as {message:unknown}).message) : 'Something went wrong')
      setPhase('error')
    }
  }

  const filteredNotes = notes.filter(n =>
    (n.title || 'Untitled').toLowerCase().includes(search.toLowerCase()),
  )

  // ── Styles ──────────────────────────────────────────────────────────────

  const page: React.CSSProperties = {
    minHeight: '100svh',
    background: '#05080a',
    color: '#d4cfc8',
    fontFamily: 'Inter, system-ui, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 20px 48px',
    gap: 24,
  }
  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 420,
    background: '#0e1318',
    borderRadius: 16,
    border: '1px solid #1e2730',
    overflow: 'hidden',
  }
  const btn = (accent = false, disabled = false): React.CSSProperties => ({
    width: '100%',
    padding: '14px 20px',
    borderRadius: 10,
    border: 'none',
    fontFamily: 'inherit',
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    background: accent ? '#2563eb' : '#1a2230',
    color: accent ? '#fff' : '#8e96a8',
    transition: 'opacity .15s',
  })
  const input: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 8,
    border: '1px solid #1e2730',
    background: '#05080a',
    color: '#d4cfc8',
    fontFamily: 'inherit',
    fontSize: 15,
    outline: 'none',
    boxSizing: 'border-box',
  }
  const label: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '.16em',
    color: '#f5b840',
    textTransform: 'uppercase',
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <div style={page}>
        <div style={{ fontSize: 48, marginTop: 32 }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: '#7fe27a' }}>Photo saved</div>
        <div style={{ fontSize: 14, color: '#8e96a8', textAlign: 'center' }}>
          {mode === 'new' ? 'New note created in My OKRs' : 'Photo added to note'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 420 }}>
          <button
            style={btn(true)}
            onClick={() => window.location.href = `/hq?screen=notes&noteId=${doneNoteId}`}
          >
            Open note →
          </button>
          <button style={btn()} onClick={() => window.location.href = '/share'}>
            Add another photo
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={page}>
        <div style={{ fontSize: 48, marginTop: 32 }}>✗</div>
        <div style={{ fontSize: 16, color: '#ff6452', textAlign: 'center' }}>{errorMsg}</div>
        <button style={{ ...btn(), maxWidth: 420 }} onClick={() => setPhase('preview')}>
          Try again
        </button>
      </div>
    )
  }

  if (phase === 'saving') {
    return (
      <div style={page}>
        <div style={{ marginTop: 64, fontSize: 15, color: '#8e96a8' }}>Saving…</div>
      </div>
    )
  }

  if (phase === 'pick-note') {
    return (
      <div style={page}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div style={{ ...label, marginBottom: 12 }}>Pick a note — My OKRs</div>
          <input
            style={{ ...input, marginBottom: 12 }}
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div style={{ ...card, maxHeight: 360, overflowY: 'auto' }}>
            {filteredNotes.length === 0 && (
              <div style={{ padding: 20, color: '#8e96a8', fontSize: 14 }}>No notes found</div>
            )}
            {filteredNotes.map(n => (
              <button
                key={n.id}
                onClick={() => setSelectedNoteId(n.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: selectedNoteId === n.id ? '#1a2a40' : 'transparent',
                  border: 'none',
                  borderBottom: '1px solid #1e2730',
                  color: selectedNoteId === n.id ? '#d4cfc8' : '#8e96a8',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 500, color: '#d4cfc8' }}>{n.title || 'Untitled'}</div>
                <div style={{ fontSize: 12, color: '#5a6070', marginTop: 2 }}>
                  {new Date(n.updated_at).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 10, flexDirection: 'column' }}>
            <button
              style={btn(true, !selectedNoteId)}
              disabled={!selectedNoteId}
              onClick={handleSave}
            >
              Add photo to note
            </button>
            <button style={btn()} onClick={() => setPhase('preview')}>
              ← Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Default: preview phase — show camera picker + mode selector
  return (
    <div style={page}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ ...label, marginBottom: 4 }}>Operation HQ</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#d4cfc8' }}>Add photo to Notes</div>
      </div>

      {/* Image preview / picker */}
      <div style={{ ...card, maxWidth: 420 }}>
        {previewUrl ? (
          <div style={{ position: 'relative' }}>
            <img
              src={previewUrl}
              alt="Preview"
              style={{ width: '100%', maxHeight: 300, objectFit: 'cover', display: 'block' }}
            />
            <button
              onClick={() => { setImageFile(null); setPreviewUrl(null) }}
              style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 20,
                color: '#fff', width: 28, height: 28, cursor: 'pointer', fontSize: 14,
              }}
            >✕</button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 12, width: '100%', padding: '48px 20px',
              background: 'transparent', border: 'none', cursor: 'pointer', color: '#8e96a8',
            }}
          >
            <div style={{ fontSize: 40 }}>📷</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#d4cfc8' }}>Take or choose a photo</div>
            <div style={{ fontSize: 13 }}>Tap to open camera or photo library</div>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* Mode picker */}
      {imageFile && (
        <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={label}>Save to</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['new', 'existing'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '12px 8px', borderRadius: 10, border: '1px solid',
                  borderColor: mode === m ? '#2563eb' : '#1e2730',
                  background: mode === m ? '#0d1e36' : '#0e1318',
                  color: mode === m ? '#93bbff' : '#8e96a8',
                  fontFamily: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                }}
              >
                {m === 'new' ? '+ New note' : 'Existing note'}
              </button>
            ))}
          </div>

          {mode === 'new' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={label}>Note title (optional)</div>
              <input
                style={input}
                placeholder="Leave blank to use today's date"
                value={noteTitle}
                onChange={e => setNoteTitle(e.target.value)}
              />
            </div>
          )}

          {mode === 'new' ? (
            <button style={btn(true)} onClick={handleSave}>
              Create note in My OKRs
            </button>
          ) : (
            <button style={btn(true)} onClick={() => setPhase('pick-note')}>
              Pick a note →
            </button>
          )}
        </div>
      )}

      {!imageFile && (
        <div style={{ fontSize: 13, color: '#5a6070', textAlign: 'center', maxWidth: 300 }}>
          Photos save to your <strong style={{ color: '#8e96a8' }}>My OKRs</strong> space in Notes
        </div>
      )}
    </div>
  )
}
