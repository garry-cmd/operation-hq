/**
 * Data layer for `quarter_reviews` (quarter-close ceremony records)
 * and the `close_score` / `close_note` fields on `roadmap_items`.
 *
 * Conventions: throw on Supabase error; always return the updated row.
 */
import { supabase } from '@/lib/supabase'

export interface QuarterReview {
  id: string
  quarter: string
  space_id: string | null
  proud_of: string | null
  didnt_go: string | null
  next_quarter: string | null
  overall_note: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export type QuarterReviewUpsertInput = {
  quarter: string
  space_id: string | null
  proud_of?: string | null
  didnt_go?: string | null
  next_quarter?: string | null
  overall_note?: string | null
  closed_at?: string | null
}

/** List all sealed quarter reviews, newest first. */
export async function listAll(): Promise<QuarterReview[]> {
  const { data, error } = await supabase
    .from('quarter_reviews')
    .select('*')
    .not('closed_at', 'is', null)
    .order('quarter', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Fetch the review for a given quarter + space (null = all-spaces). Returns null if not started. */
export async function get(quarter: string, space_id: string | null): Promise<QuarterReview | null> {
  let q = supabase.from('quarter_reviews').select('*').eq('quarter', quarter)
  if (space_id) q = q.eq('space_id', space_id)
  else q = q.is('space_id', null)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  return data
}

/** List all reviews for a quarter (all spaces). */
export async function listByQuarter(quarter: string): Promise<QuarterReview[]> {
  const { data, error } = await supabase
    .from('quarter_reviews').select('*').eq('quarter', quarter)
  if (error) throw error
  return data ?? []
}

/** Upsert (create or update) the review for this quarter+space. */
export async function upsert(input: QuarterReviewUpsertInput): Promise<QuarterReview> {
  const { data, error } = await supabase
    .from('quarter_reviews')
    .upsert(input, { onConflict: 'quarter,space_id' })
    .select().single()
  if (error) throw error
  return data
}

/** Save KR close score + note. */
export async function closeKR(
  krId: string,
  score: number | null,
  note: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('roadmap_items')
    .update({ close_score: score, close_note: note })
    .eq('id', krId)
  if (error) throw error
}

/** Seal the quarter: set closed_at to now. */
export async function seal(quarter: string, space_id: string | null): Promise<QuarterReview> {
  return upsert({ quarter, space_id, closed_at: new Date().toISOString() })
}
