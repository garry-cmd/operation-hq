/**
 * Data layer for the `annual_objectives` table.
 *
 * Conventions for all lib/db/* modules:
 *  - Functions throw on Supabase error. Callers wrap in try/catch and surface
 *    a toast — error UX lives in one place per call site, not here.
 *  - Inserts and updates always `.select().single()` and return the typed row,
 *    so callers always get DB-generated fields (id, created_at) and never
 *    drift from server defaults.
 *  - Naming is namespaced via `import * as objectivesDb from '@/lib/db/objectives'`,
 *    so terse verbs (create, update, remove) read clearly at call sites.
 */
import { supabase } from '@/lib/supabase'
import type { AnnualObjective } from '@/lib/types'

/** Fields a caller supplies when creating an objective. */
export type NewObjectiveInput = {
  name: string
  color: string
  sort_order: number
  status: AnnualObjective['status']
  space_id: string
  notes?: string
}

/** All objectives across all spaces, ordered by sort_order. */
export async function listAll(): Promise<AnnualObjective[]> {
  const { data, error } = await supabase
    .from('annual_objectives')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

/** Objectives within a single space, ordered by sort_order. Used by the share page. */
export async function listBySpace(spaceId: string): Promise<AnnualObjective[]> {
  const { data, error } = await supabase
    .from('annual_objectives')
    .select('*')
    .eq('space_id', spaceId)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function create(input: NewObjectiveInput): Promise<AnnualObjective> {
  const { data, error } = await supabase
    .from('annual_objectives')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function update(
  id: string,
  patch: Partial<AnnualObjective>,
): Promise<AnnualObjective> {
  const { data, error } = await supabase
    .from('annual_objectives')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase
    .from('annual_objectives')
    .delete()
    .eq('id', id)
  if (error) throw error
}
