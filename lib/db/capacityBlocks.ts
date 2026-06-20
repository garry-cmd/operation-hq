import { supabase } from '@/lib/supabase'
import { CapacityBlock, NewCapacityBlockInput, CapacityKind } from '@/lib/types'

/**
 * capacity_blocks DB layer — the standing weekly template of reserved work
 * windows. Mirrors the other lib/db/* modules: thin Supabase wrappers that
 * throw on error so callers can optimistic-update + .catch().
 */

function rowTo(row: Record<string, unknown>): CapacityBlock {
  return {
    id: row.id as string,
    space_id: (row.space_id as string | null) ?? null,
    kind: (row.kind as CapacityKind) ?? 'both',
    label: (row.label as string | null) ?? null,
    // numerics arrive as JS numbers here, but coerce defensively (Supabase
    // has handed back numeric-as-string before).
    day_of_week: Number(row.day_of_week),
    start_minute: Number(row.start_minute),
    end_minute: Number(row.end_minute),
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<CapacityBlock[]> {
  const { data, error } = await supabase
    .from('calendar_capacity_blocks')
    .select('*')
    .order('day_of_week', { ascending: true })
    .order('start_minute', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowTo)
}

export async function create(input: NewCapacityBlockInput): Promise<CapacityBlock> {
  const { data, error } = await supabase
    .from('calendar_capacity_blocks')
    .insert({
      space_id: input.space_id ?? null,
      kind: input.kind ?? 'both',
      label: input.label ?? null,
      day_of_week: input.day_of_week,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      sort_order: input.sort_order ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return rowTo(data)
}

export async function update(
  id: string,
  patch: Partial<Omit<CapacityBlock, 'id' | 'created_at' | 'updated_at'>>,
): Promise<CapacityBlock> {
  const { data, error } = await supabase
    .from('calendar_capacity_blocks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowTo(data)
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_capacity_blocks').delete().eq('id', id)
  if (error) throw error
}
