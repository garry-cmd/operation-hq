/**
 * Data layer for `objective_links` and `objective_logs` — the two side-cars
 * to annual_objectives. Combined here because they share the same shape
 * (per-objective list of small entries with create + remove) and only ever
 * appear together in the same UI surface (ObjectiveCard).
 *
 * Imported as: `import * as extrasDb from '@/lib/db/objectiveExtras'`
 * Used like:   `extrasDb.links.create(...)`, `extrasDb.logs.remove(id)`
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { ObjectiveLink, ObjectiveLog } from '@/lib/types'

// ─── Objective links ───────────────────────────────────────────────────

export type NewLinkInput = {
  objective_id: string
  url: string
  title: string
  sort_order: number
}

export const links = {
  async listAll(): Promise<ObjectiveLink[]> {
    const { data, error } = await supabase
      .from('objective_links')
      .select('*')
      .order('sort_order')
    if (error) throw error
    return data ?? []
  },

  async create(input: NewLinkInput): Promise<ObjectiveLink> {
    const { data, error } = await supabase
      .from('objective_links')
      .insert(input)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('objective_links')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}

// ─── Objective logs ────────────────────────────────────────────────────

export type NewLogInput = {
  objective_id: string
  title?: string | null
  content: string
  log_date: string
}

export const logs = {
  async listAll(): Promise<ObjectiveLog[]> {
    const { data, error } = await supabase
      .from('objective_logs')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  async create(input: NewLogInput): Promise<ObjectiveLog> {
    const { data, error } = await supabase
      .from('objective_logs')
      .insert(input)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async update(
    id: string,
    patch: Partial<{ title: string | null; content: string; log_date: string }>,
  ): Promise<ObjectiveLog> {
    const { data, error } = await supabase
      .from('objective_logs')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('objective_logs')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}
