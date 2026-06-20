import { supabase } from '@/lib/supabase'

/**
 * Client-side CRUD for the agent's long-term memory (agent_memory table).
 *
 * The AGENT writes to this table server-side via its own tools (remember /
 * update_memory / forget in /api/agent), with no approval. This module is the
 * HUMAN control surface — the Settings → Memory panel uses it to review, edit,
 * pin, and delete what the agent has saved. Thin wrappers that throw on error,
 * mirroring lib/db/notes.ts. Single-user app: RLS is owner_all, no user_id.
 */

export interface AgentMemory {
  id: string
  content: string
  pinned: boolean
  created_at: string
  updated_at: string
}

function rowToMemory(row: Record<string, unknown>): AgentMemory {
  return {
    id: row.id as string,
    content: (row.content as string) ?? '',
    pinned: Boolean(row.pinned),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

/** All memories, pinned first, then newest. */
export async function listAll(): Promise<AgentMemory[]> {
  const { data, error } = await supabase
    .from('agent_memory')
    .select('*')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToMemory)
}

/** Add a memory by hand (the operator's own note-to-self for the agent). */
export async function create(content: string): Promise<AgentMemory> {
  const { data, error } = await supabase
    .from('agent_memory')
    .insert({ content: content.trim() })
    .select('*')
    .single()
  if (error) throw error
  return rowToMemory(data)
}

/** Edit a memory's text. */
export async function updateContent(id: string, content: string): Promise<void> {
  const { error } = await supabase
    .from('agent_memory')
    .update({ content: content.trim() })
    .eq('id', id)
  if (error) throw error
}

/** Pin / unpin (pinned memories sort first and are flagged 📌 in the agent's context). */
export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('agent_memory').update({ pinned }).eq('id', id)
  if (error) throw error
}

/** Delete a memory permanently. */
export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('agent_memory').delete().eq('id', id)
  if (error) throw error
}
