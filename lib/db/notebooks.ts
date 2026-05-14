import { supabase } from '@/lib/supabase'
import { Notebook, NewNotebookInput } from '@/lib/types'

/**
 * Notebooks DB layer. Notebooks are containers for notes within a
 * space, with optional one-level parent nesting (Stack → Notebook).
 * The 2-level depth cap is enforced in the UI; the schema is permissive.
 */

function rowToNotebook(row: Record<string, unknown>): Notebook {
  return {
    id: row.id as string,
    space_id: row.space_id as string,
    parent_notebook_id: (row.parent_notebook_id as string | null) ?? null,
    name: row.name as string,
    sort_order: (row.sort_order as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<Notebook[]> {
  const { data, error } = await supabase
    .from('notebooks')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowToNotebook)
}

export async function create(input: NewNotebookInput): Promise<Notebook> {
  const { data, error } = await supabase
    .from('notebooks')
    .insert({
      space_id: input.space_id,
      name: input.name,
      parent_notebook_id: input.parent_notebook_id ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return rowToNotebook(data)
}

export async function rename(id: string, name: string): Promise<Notebook> {
  const { data, error } = await supabase
    .from('notebooks')
    .update({ name })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowToNotebook(data)
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('notebooks').delete().eq('id', id)
  if (error) throw error
}
