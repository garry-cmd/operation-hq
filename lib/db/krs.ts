/**
 * Data layer for the `roadmap_items` table.
 *
 * Note: roadmap_items stores BOTH key results (is_parked = false) AND parking
 * lot items (is_parked = true). The distinction is a flag on the row, not a
 * separate table. This module exposes operations on both.
 *
 * See lib/db/objectives.ts for module-level conventions (throw-on-error,
 * select-and-return-row, namespaced imports).
 */
import { supabase } from '@/lib/supabase'
import type { RoadmapItem, HealthStatus } from '@/lib/types'

/** Fields a caller supplies when creating a KR or parked item. */
export type NewKRInput = {
  space_id: string
  annual_objective_id: string | null
  title: string
  quarter: string | null
  sort_order: number
  status: RoadmapItem['status']
  health_status?: HealthStatus
  progress?: number
  is_parked?: boolean
  is_habit?: boolean
  is_metric?: boolean
  metric_unit?: string | null
  metric_direction?: RoadmapItem['metric_direction']
  start_value?: number | null
  target_value?: number | null
  target_date?: string | null
}

/** All roadmap items across all spaces and quarters, ordered by sort_order. */
export async function listAll(): Promise<RoadmapItem[]> {
  const { data, error } = await supabase
    .from('roadmap_items')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

/** Roadmap items in a specific quarter, ordered by sort_order. Used by the share page. */
export async function listByQuarter(quarter: string): Promise<RoadmapItem[]> {
  const { data, error } = await supabase
    .from('roadmap_items')
    .select('*')
    .eq('quarter', quarter)
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function create(input: NewKRInput): Promise<RoadmapItem> {
  const { data, error } = await supabase
    .from('roadmap_items')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function update(
  id: string,
  patch: Partial<RoadmapItem>,
): Promise<RoadmapItem> {
  const { data, error } = await supabase
    .from('roadmap_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase
    .from('roadmap_items')
    .delete()
    .eq('id', id)
  if (error) throw error
}

/**
 * Cascade-delete all KRs under an objective. Used when deleting an objective
 * via the OKRs tab — the objective itself is removed in objectivesDb.remove(),
 * and this cleans up its KRs first.
 */
export async function removeByObjective(objectiveId: string): Promise<void> {
  const { error } = await supabase
    .from('roadmap_items')
    .delete()
    .eq('annual_objective_id', objectiveId)
  if (error) throw error
}

/**
 * Count roadmap items belonging to an objective. Used to compute sort_order
 * for the next KR being created under that objective. Returns 0 if the count
 * comes back null/undefined (treat as empty).
 */
export async function countByObjective(objectiveId: string): Promise<number> {
  const { count, error } = await supabase
    .from('roadmap_items')
    .select('id', { count: 'exact', head: true })
    .eq('annual_objective_id', objectiveId)
  if (error) throw error
  return count ?? 0
}

// ─── Sugar helpers ─────────────────────────────────────────────────────
// The two most common targeted updates in the codebase. Worth named helpers
// for readability at call sites; less-common multi-field updates (park,
// unpark-and-schedule) use update(id, patch) directly.

/** Set the KR's health pill (on track / off track / blocked / done / etc). */
export async function setHealth(id: string, health: HealthStatus): Promise<RoadmapItem> {
  return update(id, { health_status: health })
}

/** Set the KR's outcome progress percentage (0-100). */
export async function setProgress(id: string, progress: number): Promise<RoadmapItem> {
  return update(id, { progress })
}
