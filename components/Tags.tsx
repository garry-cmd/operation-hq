'use client'
/**
 * Tags — cross-note tag browser. Shows every tag in use across notes.
 * Clicking a tag surfaces the notes with that tag; clicking a note jumps
 * to the Notes module with that note selected.
 *
 *   ┌──────────────┬──────────────────────────────────────────┐
 *   │ Tag list     │ Notes panel                              │
 *   │ alpha-sorted │ Header (#tag + count)                    │
 *   │ counts       │ Notes by recency                         │
 *   └──────────────┴──────────────────────────────────────────┘
 */
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Space, Note, NoteTag } from '@/lib/types'
import * as notesDb from '@/lib/db/notes'

interface Props {
  spaces: Space[]
  onJumpToNote: (noteId: string) => void
  initialTag?: string | null
  toast: (msg: string) => void
}

interface TagSummary {
  tag: string
  noteCount: number
}

export default function Tags({ spaces, onJumpToNote, initialTag, toast }: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [noteTagRows, setNoteTagRows] = useState<NoteTag[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTag, setSelectedTag] = useState<string | null>(initialTag ?? null)
  const [searchQuery, setSearchQuery] = useState('')

  const spaceById = useMemo(() => new Map(spaces.map(s => [s.id, s])), [spaces])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const n = await notesDb.listAll()
      setNotes(n)
      const nt = await notesDb.listTagsForNotes(n.map(x => x.id))
      setNoteTagRows(nt)
    } catch (err) {
      console.error('Tags load failed:', err)
      toast('Failed to load tags')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (initialTag) setSelectedTag(initialTag) }, [initialTag])

  // Build tag summaries
  const tagSummaries: TagSummary[] = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of noteTagRows) {
      map.set(r.tag, (map.get(r.tag) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([tag, noteCount]) => ({ tag, noteCount }))
      .sort((a, b) => a.tag.localeCompare(b.tag))
  }, [noteTagRows])

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tagSummaries
    const q = searchQuery.toLowerCase()
    return tagSummaries.filter(t => t.tag.toLowerCase().includes(q))
  }, [tagSummaries, searchQuery])

  // Notes for the selected tag
  const taggedNoteIds = useMemo(() => {
    if (!selectedTag) return new Set<string>()
    return new Set(noteTagRows.filter(r => r.tag === selectedTag).map(r => r.note_id))
  }, [selectedTag, noteTagRows])

  const taggedNotes = useMemo(() => {
    return notes
      .filter(n => taggedNoteIds.has(n.id))
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }, [notes, taggedNoteIds])

  const selectedTagSummary = tagSummaries.find(t => t.tag === selectedTag)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, color: 'var(--navy-400)', fontSize: 13 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
      Loading tags…
    </div>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'var(--font-body)', overflow: 'hidden' }}>
      {/* Left: tag list */}
      <div style={{
        width: 240, flexShrink: 0, borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', background: 'var(--surface)',
      }}>
        <div style={{ padding: '14px 14px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--nw-label)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
            Tags
          </div>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter tags…"
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 7,
              background: 'var(--navy-800)', border: '1px solid var(--line)',
              color: 'var(--t-0)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredTags.length === 0 ? (
            <div style={{ padding: '20px 16px', fontSize: 12.5, color: 'var(--t-3)', textAlign: 'center' }}>
              No tags yet
            </div>
          ) : filteredTags.map(t => (
            <button key={t.tag} onClick={() => setSelectedTag(t.tag)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                background: selectedTag === t.tag ? 'var(--accent-bg)' : 'none',
                color: selectedTag === t.tag ? 'var(--accent-2)' : 'var(--t-1)',
                fontFamily: 'inherit', fontSize: 13,
              }}
              onMouseEnter={e => { if (selectedTag !== t.tag) e.currentTarget.style.background = 'var(--hover)' }}
              onMouseLeave={e => { if (selectedTag !== t.tag) e.currentTarget.style.background = 'none' }}
            >
              <span>#{t.tag}</span>
              <span style={{ fontSize: 11, color: 'var(--t-3)', fontFamily: 'var(--font-mono)' }}>{t.noteCount}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: notes panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg)' }}>
        {!selectedTag ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--t-3)', fontSize: 13 }}>
            Select a tag
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--t-0)' }}>#{selectedTag}</span>
              {selectedTagSummary && (
                <span style={{ fontSize: 12, color: 'var(--t-3)', fontFamily: 'var(--font-mono)' }}>
                  {selectedTagSummary.noteCount} note{selectedTagSummary.noteCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Notes list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {taggedNotes.length === 0 ? (
                <div style={{ padding: '32px 20px', fontSize: 13, color: 'var(--t-3)', textAlign: 'center' }}>
                  No notes with this tag
                </div>
              ) : taggedNotes.map(n => {
                const space = n.space_id ? spaceById.get(n.space_id) : undefined
                return (
                  <button key={n.id} onClick={() => onJumpToNote(n.id)}
                    style={{
                      width: '100%', display: 'flex', flexDirection: 'column', gap: 3,
                      padding: '10px 20px', border: 'none', borderBottom: '1px solid var(--line-2)',
                      cursor: 'pointer', textAlign: 'left', background: 'none',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-0)' }}>
                        {n.title || 'Untitled'}
                      </span>
                      {space && (
                        <span style={{
                          fontSize: 10, padding: '1px 6px', borderRadius: 99,
                          background: space.color + '22', color: space.color,
                          fontFamily: 'var(--font-mono)', fontWeight: 600,
                        }}>{space.name}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--t-3)' }}>
                      {n.updated_at ? new Date(n.updated_at).toLocaleDateString() : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
