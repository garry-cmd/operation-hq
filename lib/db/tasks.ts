import { supabase } from '@/lib/supabase'
import { Task, NewTaskInput, TaskTag } from '@/lib/types'

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    space_id: (row.space_id as string | null) ?? null,
    list_id: (row.list_id as string | null) ?? null,
    section_id: (row.section_id as string | null) ?? null,
    roadmap_item_id: (row.roadmap_item_id as string | null) ?? null,
    parent_task_id: (row.parent_task_id as string | null) ?? null,
    title: (row.title as string) ?? '',
    description: (row.description as string | null) ?? null,
    priority: ((row.priority as number) ?? 4) as Task['priority'],
    due_date: (row.due_date as string | null) ?? null,
    due_time: (row.due_time as string | null) ?? null,
    deadline_date: (row.deadline_date as string | null) ?? null,
    estimated_minutes: (row.estimated_minutes as number | null) ?? null,
    recurrence_text: (row.recurrence_text as string | null) ?? null,
    recurrence_rule: (row.recurrence_rule as Task['recurrence_rule']) ?? null,
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
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToTask)
}

export async function create(input: NewTaskInput): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: input.title,
      space_id: input.space_id ?? null,
      list_id: input.list_id ?? null,
      section_id: input.section_id ?? null,
      roadmap_item_id: input.roadmap_item_id ?? null,
      parent_task_id: input.parent_task_id ?? null,
      description: input.description ?? null,
      priority: input.priority ?? 4,
      due_date: input.due_date ?? null,
      due_time: input.due_time ?? null,
      deadline_date: input.deadline_date ?? null,
      estimated_minutes: input.estimated_minutes ?? null,
      recurrence_text: input.recurrence_text ?? null,
      recurrence_rule: input.recurrence_rule ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return rowToTask(data)
}

export async function update(
  id: string,
  patch: Partial<Omit<Task, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToTask(data)
}

export async function toggleComplete(task: Task): Promise<Task> {
  const now = new Date().toISOString()
  // Recurring tasks: never mark complete — just advance due_date by interval
  if (task.recurrence_rule && !task.completed_at) {
    const rule = task.recurrence_rule
    const base = task.due_date ? new Date(task.due_date) : new Date()
    const interval = rule.interval ?? 1
    if (rule.freq === 'daily')   base.setDate(base.getDate() + interval)
    if (rule.freq === 'weekly')  base.setDate(base.getDate() + 7 * interval)
    if (rule.freq === 'monthly') base.setMonth(base.getMonth() + interval)
    if (rule.freq === 'yearly')  base.setFullYear(base.getFullYear() + interval)
    return update(task.id, { due_date: base.toISOString().slice(0, 10) })
  }
  const completed_at = task.completed_at ? null : now
  return update(task.id, { completed_at })
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// ── Tags ──────────────────────────────────────────────────────────────────

export async function listTagsForTasks(taskIds: string[]): Promise<TaskTag[]> {
  if (!taskIds.length) return []
  const { data, error } = await supabase
    .from('task_tags')
    .select('task_id, tag')
    .in('task_id', taskIds)
  if (error) throw error
  return (data ?? []) as TaskTag[]
}
