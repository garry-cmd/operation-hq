import { supabase } from '@/lib/supabase'
import { Task, NewTaskInput, TaskTag, RecurrenceRule } from '@/lib/types'
import { advanceDate } from '@/lib/recurrence'

/**
 * Tasks DB layer. Mirrors the shape of the other lib/db/* modules:
 * thin wrappers around Supabase that throw on error so the caller can
 * .catch() with a sensible fallback. Tag operations are kept here too
 * (rather than a separate taskTags.ts) since tags are always written
 * in lockstep with the parent task and the surface is small.
 *
 * The interesting bit is `toggleComplete`: for recurring tasks, it
 * advances due_date instead of setting completed_at, so the row keeps
 * rolling. For one-shots it just flips completed_at.
 */

/** Map a DB row to the Task interface, casting jsonb → typed rule. */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    space_id: (row.space_id as string | null) ?? null,
    list_id: (row.list_id as string | null) ?? null,
    roadmap_item_id: (row.roadmap_item_id as string | null) ?? null,
    parent_task_id: (row.parent_task_id as string | null) ?? null,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    priority: row.priority as 1 | 2 | 3 | 4,
    due_date: (row.due_date as string | null) ?? null,
    due_time: (row.due_time as string | null) ?? null,
    recurrence_text: (row.recurrence_text as string | null) ?? null,
    recurrence_rule: (row.recurrence_rule as RecurrenceRule | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToTask)
}

export async function listBySpace(spaceId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('space_id', spaceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToTask)
}

export async function listByList(listId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToTask)
}

export async function create(input: NewTaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      space_id: input.space_id ?? null,
      list_id: input.list_id ?? null,
      title: input.title,
      roadmap_item_id: input.roadmap_item_id ?? null,
      parent_task_id: input.parent_task_id ?? null,
      description: input.description ?? null,
      priority: input.priority ?? 4,
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
      recurrence_text: input.recurrence_text ?? null,
      recurrence_rule: input.recurrence_rule ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return rowToTask(data)
}

export async function update(id: string, patch: Partial<Omit<Task, 'id' | 'created_at' | 'updated_at'>>): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToTask(data)
}

/**
 * Toggle the completion state of a task.
 *
 *   - One-shot, currently open → mark completed_at = now()
 *   - One-shot, currently done → re-open (completed_at = null)
 *   - Recurring (rule != null), always: advance due_date to next
 *     occurrence. completed_at stays null so the task remains visible
 *     in active views; "done for today" is conveyed by the due_date
 *     moving forward.
 *
 * Returns the updated row.
 */
export async function toggleComplete(task: Task): Promise<Task> {
  if (task.recurrence_rule && task.due_date) {
    const next = advanceDate(task.due_date, task.recurrence_rule)
    return update(task.id, { due_date: next })
  }
  if (task.completed_at) {
    return update(task.id, { completed_at: null })
  }
  return update(task.id, { completed_at: new Date().toISOString() })
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// ── Tags ───────────────────────────────────────────────────────────

export async function listTagsForTasks(taskIds: string[]): Promise<TaskTag[]> {
  if (taskIds.length === 0) return []
  const { data, error } = await supabase
    .from('task_tags')
    .select('*')
    .in('task_id', taskIds)
  if (error) throw error
  return (data ?? []) as TaskTag[]
}

/** Replace the entire tag set on a task with `tags` (deduped, lowercased).
 *  No-op rows are fine; we just delete-all then insert. Race-safe enough
 *  for solo-user; if multi-user ever lands, switch to upsert + diff. */
export async function setTags(taskId: string, tags: string[]): Promise<void> {
  const clean = Array.from(new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean)))
  const { error: delErr } = await supabase.from('task_tags').delete().eq('task_id', taskId)
  if (delErr) throw delErr
  if (clean.length === 0) return
  const { error: insErr } = await supabase
    .from('task_tags')
    .insert(clean.map(tag => ({ task_id: taskId, tag })))
  if (insErr) throw insErr
}

/** All tags currently in use across all tasks (for the tag sidebar). */
export async function listAllTags(): Promise<string[]> {
  const { data, error } = await supabase.from('task_tags').select('tag')
  if (error) throw error
  const set = new Set<string>((data ?? []).map((r: { tag: string }) => r.tag))
  return Array.from(set).sort()
}
