/**
 * Data layer for the `weekly_reviews` table.
 *
 * One review row per (space, week). The wizard creates or updates these on
 * close-week; the Reflect tab surfaces them as an archive and supports
 * editing the rating/win/slipped/notes after the fact.
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { WeeklyReview } from '@/lib/types'

/** Fields a caller supplies when creating a review. */
export type NewReviewInput = {
  space_id: string
  week_start: string
  rating: WeeklyReview['rating']
  win: string
  slipped: string
  adjust_notes: string
  krs_hit: number
  krs_total: number
  // Optional: set on creation by skipWeek (skip-as-close in one write so a
  // skip never leaves a draft behind). commitFinish uses markClosed instead.
  closed_at?: string | null
}

/** All reviews across all spaces, newest first. */
export async function listAll(): Promise<WeeklyReview[]> {
  const { data, error } = await supabase
    .from('weekly_reviews')
    .select('*')
    .order('week_start', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function create(input: NewReviewInput): Promise<WeeklyReview> {
  const { data, error } = await supabase
    .from('weekly_reviews')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function update(
  id: string,
  patch: Partial<WeeklyReview>,
): Promise<WeeklyReview> {
  const { data, error } = await supabase
    .from('weekly_reviews')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Mark a review row as fully closed. Called by the wizard's commitFinish
 * (normal close) and skipWeek (skip-as-close). Drafts have closed_at = null
 * until this fires; the forced-launch effect in app/hq/page.tsx ignores rows
 * with closed_at = null so abandoning the wizard mid-Step-2 doesn't suppress
 * the re-prompt.
 */
export async function markClosed(id: string): Promise<WeeklyReview> {
  return update(id, { closed_at: new Date().toISOString() })
}
