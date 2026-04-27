/**
 * Data layer for the `spaces` table.
 *
 * Spaces are the top-level isolation boundary — every objective, KR, action,
 * and review is scoped to exactly one space. The space itself has only a
 * name, color, and sort_order.
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { Space } from '@/lib/types'

/** Fields a caller supplies when creating a space. */
export type NewSpaceInput = {
  name: string
  color: string
  sort_order: number
}

/** All spaces, ordered by sort_order. */
export async function listAll(): Promise<Space[]> {
  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function create(input: NewSpaceInput): Promise<Space> {
  const { data, error } = await supabase
    .from('spaces')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function update(
  id: string,
  patch: Partial<Space>,
): Promise<Space> {
  const { data, error } = await supabase
    .from('spaces')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
