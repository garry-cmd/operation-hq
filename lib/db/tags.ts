import { supabase } from '@/lib/supabase'

/**
 * Tag housekeeping. Tags don't have their own table — they're strings
 * in task_tags and note_tags. These helpers maintain consistency by
 * updating both at once.
 *
 * All operations are idempotent and tolerant: if a tag exists in one
 * table but not the other, that's fine.
 *
 * "Rename A → B where B already exists" is functionally a merge, so
 * rename() detects that case and routes through merge(). Callers don't
 * have to know which one to use; they just call rename() with the new
 * name, and the right thing happens.
 */

function normalize(tag: string): string {
  return tag.trim().toLowerCase().replace(/^#/, '')
}

/** Does this tag exist anywhere? */
export async function exists(tag: string): Promise<boolean> {
  const t = normalize(tag)
  if (!t) return false
  const { count: taskCount, error: e1 } = await supabase
    .from('task_tags').select('tag', { count: 'exact', head: true }).eq('tag', t)
  if (e1) throw e1
  if ((taskCount ?? 0) > 0) return true
  const { count: noteCount, error: e2 } = await supabase
    .from('note_tags').select('tag', { count: 'exact', head: true }).eq('tag', t)
  if (e2) throw e2
  return (noteCount ?? 0) > 0
}

/** Count tasks and notes carrying a given tag. */
export async function impactCount(tag: string): Promise<{ tasks: number; notes: number }> {
  const t = normalize(tag)
  const { count: tCount, error: e1 } = await supabase
    .from('task_tags').select('tag', { count: 'exact', head: true }).eq('tag', t)
  if (e1) throw e1
  const { count: nCount, error: e2 } = await supabase
    .from('note_tags').select('tag', { count: 'exact', head: true }).eq('tag', t)
  if (e2) throw e2
  return { tasks: tCount ?? 0, notes: nCount ?? 0 }
}

/**
 * Rename `from` → `to`. If `to` already exists on some items, those
 * collisions are resolved by routing through merge() (no PRIMARY KEY
 * violations on (task_id, tag) / (note_id, tag)).
 *
 * Returns the final canonical tag name.
 */
export async function rename(from: string, to: string): Promise<string> {
  const f = normalize(from)
  const t = normalize(to)
  if (!f || !t) throw new Error('Tag name cannot be empty')
  if (f === t) return t  // No-op rename

  // If `to` already exists, this is a merge.
  if (await exists(t)) {
    return merge(f, t)
  }

  // No collision — simple UPDATE in both tables.
  const { error: e1 } = await supabase.from('task_tags').update({ tag: t }).eq('tag', f)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('note_tags').update({ tag: t }).eq('tag', f)
  if (e2) throw e2
  return t
}

/**
 * Merge `source` into `target`. Every item carrying the source tag
 * gets the target tag (deduped — if it already has both, source is
 * just removed). The source tag is then gone.
 *
 * Returns the target tag name.
 */
export async function merge(source: string, target: string): Promise<string> {
  const s = normalize(source)
  const t = normalize(target)
  if (!s || !t) throw new Error('Tag name cannot be empty')
  if (s === t) return t  // No-op

  // ── task_tags ──
  // Find items carrying the source tag. For each, upsert the target
  // (which is a no-op if they already have it) then delete the source.
  const { data: taskRows, error: tqErr } = await supabase
    .from('task_tags').select('task_id').eq('tag', s)
  if (tqErr) throw tqErr
  if (taskRows && taskRows.length > 0) {
    const upserts = taskRows.map(r => ({ task_id: (r as { task_id: string }).task_id, tag: t }))
    // upsert with ON CONFLICT DO NOTHING semantics — composite PK protects us
    const { error: upErr } = await supabase
      .from('task_tags').upsert(upserts, { onConflict: 'task_id,tag', ignoreDuplicates: true })
    if (upErr) throw upErr
    const { error: delErr } = await supabase.from('task_tags').delete().eq('tag', s)
    if (delErr) throw delErr
  }

  // ── note_tags ── same shape
  const { data: noteRows, error: nqErr } = await supabase
    .from('note_tags').select('note_id').eq('tag', s)
  if (nqErr) throw nqErr
  if (noteRows && noteRows.length > 0) {
    const upserts = noteRows.map(r => ({ note_id: (r as { note_id: string }).note_id, tag: t }))
    const { error: upErr } = await supabase
      .from('note_tags').upsert(upserts, { onConflict: 'note_id,tag', ignoreDuplicates: true })
    if (upErr) throw upErr
    const { error: delErr } = await supabase.from('note_tags').delete().eq('tag', s)
    if (delErr) throw delErr
  }

  return t
}

/** Delete a tag entirely. Items keep existing — they just lose this tag. */
export async function remove(tag: string): Promise<void> {
  const t = normalize(tag)
  if (!t) return
  const { error: e1 } = await supabase.from('task_tags').delete().eq('tag', t)
  if (e1) throw e1
  const { error: e2 } = await supabase.from('note_tags').delete().eq('tag', t)
  if (e2) throw e2
}
