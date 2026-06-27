import { supabase } from '@/lib/supabase'

/**
 * Client-side CRUD for the agent's long-term memory (agent_memory table).
 *
 * The AGENT writes to this table server-side via its own tools (remember /
 * update_memory / forget in /api/agent), with no approval. This module is the
 * HUMAN control surface — the Settings → Memory panel uses it to review, edit,
 * pin, and delete what the agent has saved. Thin wrappers that throw on error,
 * mirroring lib/db/notes.ts. Single-user app: RLS is owner_all, no user_id.
 *
 * Schema additions (Jun 2026):
 *   kind        — 'preference' | 'fact' | 'observation' | null (null = legacy / unclassified)
 *   source      — free-text provenance (e.g. "Scout – 2026-06-26"), null = operator-authored
 *   expires_at  — timestamptz; when set, the memory self-retires (agent should ignore expired)
 *   reviewed_at — timestamptz; null = unreviewed agent write, non-null = operator confirmed
 */

export type MemoryKind = 'preference' | 'fact' | 'observation'

export interface AgentMemory {
  id: string
  content: string
  pinned: boolean
  kind: MemoryKind | null
  source: string | null
  expires_at: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

function rowToMemory(row: Record<string, unknown>): AgentMemory {
  return {
    id: row.id as string,
    content: (row.content as string) ?? '',
    pinned: Boolean(row.pinned),
    kind: (row.kind as MemoryKind | null) ?? null,
    source: (row.source as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    reviewed_at: (row.reviewed_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

/** All memories, pinned first, then newest. Excludes expired entries. */
export async function listAll(): Promise<AgentMemory[]> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('agent_memory')
    .select('*')
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToMemory)
}

/** Unreviewed agent-written memories (reviewed_at IS NULL, source IS NOT NULL).
 *  These are the ones that need operator confirmation. */
export async function listUnreviewed(): Promise<AgentMemory[]> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('agent_memory')
    .select('*')
    .is('reviewed_at', null)
    .not('source', 'is', null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(rowToMemory)
}

/** Add a memory by hand (the operator's own note-to-self for the agent).
 *  Operator-authored memories are pre-reviewed (reviewed_at = now). */
export async function create(content: string, kind?: MemoryKind): Promise<AgentMemory> {
  const { data, error } = await supabase
    .from('agent_memory')
    .insert({
      content: content.trim(),
      kind: kind ?? null,
      reviewed_at: new Date().toISOString(),
    })
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

/** Pin / unpin. */
export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('agent_memory').update({ pinned }).eq('id', id)
  if (error) throw error
}

/** Confirm (review) an agent-written memory. Sets reviewed_at = now. */
export async function confirm(id: string): Promise<void> {
  const { error } = await supabase
    .from('agent_memory')
    .update({ reviewed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Delete a memory permanently. */
export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('agent_memory').delete().eq('id', id)
  if (error) throw error
}
