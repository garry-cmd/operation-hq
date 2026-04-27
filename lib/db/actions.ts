/**
 * Data layer for the `weekly_actions` table.
 *
 * Actions are the weekly to-do items beneath a KR. They have a week_start
 * and a roadmap_item_id; the rest is title + completion + recurring flags.
 *
 * createMany exists separately from create because the wizard's carry-forward
 * logic batch-inserts a mix of recurring re-spawns and incomplete carries —
 * one round-trip is materially better than N.
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { WeeklyAction } from '@/lib/types'

/** Fields a caller supplies when creating an action. */
export type NewActionInput = {
  roadmap_item_id: string
  title: string
  week_start: string
  completed?: boolean
  carried_over?: boolean
  is_recurring?: boolean
}

/** All actions across all weeks, ordered by created_at. */
export async function listAll(): Promise<WeeklyAction[]> {
  const { data, error } = await supabase
    .from('weekly_actions')
    .select('*')
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function create(input: NewActionInput): Promise<WeeklyAction> {
  const { data, error } = await supabase
    .from('weekly_actions')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Batch-insert actions in a single round-trip. Returns rows in DB order,
 * not necessarily input order — caller should not assume positional match.
 * Used by the wizard's carry-forward / recurring-respawn flow.
 */
export async function createMany(inputs: NewActionInput[]): Promise<WeeklyAction[]> {
  if (inputs.length === 0) return []
  const { data, error } = await supabase
    .from('weekly_actions')
    .insert(inputs)
    .select()
  if (error) throw error
  return data ?? []
}

export async function update(
  id: string,
  patch: Partial<WeeklyAction>,
): Promise<WeeklyAction> {
  const { data, error } = await supabase
    .from('weekly_actions')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase
    .from('weekly_actions')
    .delete()
    .eq('id', id)
  if (error) throw error
}
