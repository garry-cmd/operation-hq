/**
 * Data layer for the three checkin tables: habit_checkins, metric_checkins,
 * daily_checkins. They're combined here because they share the "checkin"
 * semantic, but each has its own sub-namespace because the operations differ:
 *
 *  - habit:  per-day inserts; users mark a habit done on a specific date
 *  - metric: weekly upserts on (kr, week_start); revising overwrites
 *  - daily:  list-only today (no UI mutations)
 *
 * Imported as: `import * as checkinsDb from '@/lib/db/checkins'`
 * Used like:   `checkinsDb.habit.create(krId, today)`
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { HabitCheckin, MetricCheckin, DailyCheckin } from '@/lib/types'

// ─── Habit checkins ────────────────────────────────────────────────────
// A row per (kr, date) pair. Simple inserts and deletes; no upsert pattern
// because the UI surface shouldn't double-log a single day, and the DB has
// a unique constraint that surfaces a friendly error if it does.

export const habit = {
  async listAll(): Promise<HabitCheckin[]> {
    const { data, error } = await supabase
      .from('habit_checkins')
      .select('*')
      .order('date', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  /**
   * Log a habit session for a given KR on a given date. Throws on duplicate
   * (kr, date) violations — the unique constraint prevents the same day
   * being logged twice. Caller should surface a helpful toast in that case.
   */
  async create(krId: string, date: string): Promise<HabitCheckin> {
    const { data, error } = await supabase
      .from('habit_checkins')
      .insert({ roadmap_item_id: krId, date })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('habit_checkins')
      .delete()
      .eq('id', id)
    if (error) throw error
  },
}

// ─── Metric checkins ───────────────────────────────────────────────────
// Unique constraint on (roadmap_item_id, week_start) — a KR has at most one
// value per week. Revising in-week should overwrite cleanly, so we upsert
// on that conflict key. updated_at is set explicitly because the column
// doesn't have an ON UPDATE trigger.

export const metric = {
  async listAll(): Promise<MetricCheckin[]> {
    const { data, error } = await supabase
      .from('metric_checkins')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  },

  /**
   * Set the value for a metric KR in a given week. Atomic upsert on
   * (roadmap_item_id, week_start) so re-logging the same week overwrites
   * rather than throwing a uniqueness error. Used by both the standalone
   * MetricLogModal and the in-wizard metric logger.
   */
  async upsertWeekValue(
    krId: string,
    weekStart: string,
    value: number,
  ): Promise<MetricCheckin> {
    const { data, error } = await supabase
      .from('metric_checkins')
      .upsert(
        {
          roadmap_item_id: krId,
          week_start: weekStart,
          value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'roadmap_item_id,week_start' },
      )
      .select()
      .single()
    if (error) throw error
    return data
  },
}

// ─── Daily checkins ────────────────────────────────────────────────────
// Currently list-only — daily_checkins is loaded but no UI surface mutates
// it today. Exposed here for completeness and to keep the loadAll fanout
// consistent across all checkin tables.

export const daily = {
  async listAll(): Promise<DailyCheckin[]> {
    const { data, error } = await supabase
      .from('daily_checkins')
      .select('*')
      .order('checkin_date', { ascending: false })
    if (error) throw error
    return data ?? []
  },
}
