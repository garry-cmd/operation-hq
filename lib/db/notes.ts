import { supabase } from '@/lib/supabase'
import { Note, NewNoteInput, NoteBody, NoteTag } from '@/lib/types'

/**
 * Notes DB layer. Mirrors the lib/db/tasks.ts shape: thin wrappers that
 * throw on error. Tag helpers live in this file (parallel to how tasks
 * keeps task_tags here) since note tags are small and always written
 * in lockstep with a note.
 *
 * Body is stored as JSONB (TipTap ProseMirror document). On create we
 * default to null; the editor will write a non-null doc as soon as the
 * user types.
 */

function rowToNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    space_id: row.space_id as string,
    notebook_id: (row.notebook_id as string | null) ?? null,
    title: (row.title as string) ?? '',
    body: (row.body as NoteBody | null) ?? null,
    body_format: (row.body_format as string) ?? 'tiptap_v1',
    pinned_at: (row.pinned_at as string | null) ?? null,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<Note[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToNote)
}

export async function create(input: NewNoteInput): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .insert({
      space_id: input.space_id,
      notebook_id: input.notebook_id ?? null,
      title: input.title ?? '',
      body: input.body ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return rowToNote(data)
}

export async function update(
  id: string,
  patch: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToNote(data)
}

/** Body-only save — keeps the common path explicit and lets callers debounce
 *  on this without worrying about which other fields might be in flight. */
export async function saveBody(id: string, body: NoteBody): Promise<Note> {
  return update(id, { body })
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) throw error
}

// ── Tags ───────────────────────────────────────────────────────────

export async function listTagsForNotes(noteIds: string[]): Promise<NoteTag[]> {
  if (noteIds.length === 0) return []
  const { data, error } = await supabase
    .from('note_tags')
    .select('*')
    .in('note_id', noteIds)
  if (error) throw error
  return (data ?? []) as NoteTag[]
}

export async function setTags(noteId: string, tags: string[]): Promise<void> {
  const clean = Array.from(new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean)))
  const { error: delErr } = await supabase.from('note_tags').delete().eq('note_id', noteId)
  if (delErr) throw delErr
  if (clean.length === 0) return
  const { error: insErr } = await supabase
    .from('note_tags')
    .insert(clean.map(tag => ({ note_id: noteId, tag })))
  if (insErr) throw insErr
}

export async function listAllNoteTags(): Promise<string[]> {
  const { data, error } = await supabase.from('note_tags').select('tag')
  if (error) throw error
  const set = new Set<string>((data ?? []).map((r: { tag: string }) => r.tag))
  return Array.from(set).sort()
}
