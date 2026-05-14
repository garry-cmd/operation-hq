import { supabase } from '@/lib/supabase'
import { TaskList, NewTaskListInput } from '@/lib/types'

/**
 * Task lists DB layer. Lists are containers for tasks that don't belong
 * to a space (groceries, books to read, etc.). The exclusive-container
 * CHECK constraint on tasks ensures a task lives in either a space or a
 * list, never both.
 */

function rowToList(row: Record<string, unknown>): TaskList {
  return {
    id: row.id as string,
    name: row.name as string,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<TaskList[]> {
  const { data, error } = await supabase
    .from('task_lists')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToList)
}

export async function create(input: NewTaskListInput): Promise<TaskList> {
  const { data, error } = await supabase
    .from('task_lists')
    .insert({
      name: input.name,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return rowToList(data)
}

export async function rename(id: string, name: string): Promise<TaskList> {
  const { data, error } = await supabase
    .from('task_lists')
    .update({ name })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToList(data)
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('task_lists').delete().eq('id', id)
  if (error) throw error
}
