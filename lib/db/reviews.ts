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
