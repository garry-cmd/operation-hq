import { supabase } from '@/lib/supabase'
import { NoteVersion, NoteBody } from '@/lib/types'

/**
 * Note version history. Lightweight, append-only snapshots of a note's
 * title + body. Snapshots are created throttled during editing (see
 * NoteEditor), and one is taken before a restore so the action is
 * reversible. Retention is capped per note (KEEP) to keep the table small.
 */

const KEEP = 50

function rowToVersion(row: Record<string, unknown>): NoteVersion {
  return {
    id: row.id as string,
    note_id: row.note_id as string,
    title: (row.title as string) ?? '',
    body: (row.body as NoteBody | null) ?? null,
    body_format: (row.body_format as string) ?? 'tiptap_v1',
    created_at: row.created_at as string,
  }
}

export async function listVersions(noteId: string): Promise<NoteVersion[]> {
  const { data, error } = await supabase
    .from('note_versions')
    .select('*')
    .eq('note_id', noteId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToVersion)
}

/** Insert a snapshot, then prune the note's history down to the newest KEEP. */
export async function createVersion(
  noteId: string,
  title: string,
  body: NoteBody | null,
): Promise<void> {
  const { error } = await supabase
    .from('note_versions')
    .insert({ note_id: noteId, title, body })
  if (error) throw error
  void prune(noteId)
}

async function prune(noteId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('note_versions')
      .select('id')
      .eq('note_id', noteId)
      .order('created_at', { ascending: false })
    const ids = (data ?? []).map((r: { id: string }) => r.id)
    if (ids.length <= KEEP) return
    const stale = ids.slice(KEEP)
    await supabase.from('note_versions').delete().in('id', stale)
  } catch (e) {
    console.warn('prune note versions failed', e)
  }
}
