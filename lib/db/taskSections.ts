import { supabase } from '@/lib/supabase'
import { TaskSection, NewTaskSectionInput } from '@/lib/types'

/**
 * Task sections DB layer. Sections are headers inside a List (Todoist-style);
 * tasks in a list can be grouped under them. Deleting a section orphans its
 * tasks to "no section" via tasks.section_id ON DELETE SET NULL — they stay in
 * the List, just ungrouped. Mirrors the shape of lib/db/taskLists.ts.
 */

function rowToSection(row: Record<string, unknown>): TaskSection {
  return {
    id: row.id as string,
    list_id: row.list_id as string,
    name: row.name as string,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<TaskSection[]> {
  const { data, error } = await supabase
    .from('task_sections')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToSection)
}

export async function create(input: NewTaskSectionInput): Promise<TaskSection> {
  const { data, error } = await supabase
    .from('task_sections')
    .insert({
      list_id: input.list_id,
      name: input.name,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return rowToSection(data)
}

export async function rename(id: string, name: string): Promise<TaskSection> {
  const { data, error } = await supabase
    .from('task_sections')
    .update({ name })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToSection(data)
}

/** Set a section's sort_order (used by the reorder ▲▼ controls). */
export async function setSortOrder(id: string, sort_order: number): Promise<TaskSection> {
  const { data, error } = await supabase
    .from('task_sections')
    .update({ sort_order })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToSection(data)
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('task_sections').delete().eq('id', id)
  if (error) throw error
}
