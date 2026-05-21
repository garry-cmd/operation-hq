/**
 * Bucket math for the dated-KR model.
 *
 * Single source of truth for:
 *   - Mapping a quarter ID ('2Q2026') to its calendar date range
 *   - Default date range for a newly-created KR (current calendar week)
 *
 * More bucket utilities will land here as the All Spaces dashboard ships
 * (lib/dateBuckets — see Chunk 2/3 in the dated-KR rollout). Kept lean for
 * now; only the helpers actually called from production code live here.
 */
import { getMonday, parseDateLocal } from '@/lib/utils'

/**
 * Resolve a quarter ID like '2Q2026' to its calendar start/end dates
 * (inclusive). Returns null if the format doesn't match — caller should
 * treat that as "no range" rather than crashing.
 */
export function getQuarterRange(quarter: string): { start: string; end: string } | null {
  const m = quarter.match(/^([1-4])Q(\d{4})$/)
  if (!m) return null
  const q = parseInt(m[1], 10)
  const y = parseInt(m[2], 10)
  const startMonth = (q - 1) * 3 + 1  // 1, 4, 7, 10
  const endMonth = q * 3              // 3, 6, 9, 12
  // Day-0 of next month = last day of this month (cross-platform safe).
  const lastDay = new Date(y, endMonth, 0).getDate()
  return {
    start: `${y}-${String(startMonth).padStart(2, '0')}-01`,
    end: `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

/**
 * Default date range for newly-created KRs. Per the planning philosophy:
 * default to the current calendar week (Mon → Sun) so unplanned items
 * land in "This Week" with visible pressure to plan them properly.
 *
 * Habits should NOT use this — they're ongoing, not bounded; pass nulls
 * for both fields when creating habit KRs.
 */
export function getDefaultNewKRRange(today: Date = new Date()): { start_date: string; end_date: string } {
  const monday = getMonday(today)
  const sundayDate = parseDateLocal(monday)
  sundayDate.setDate(sundayDate.getDate() + 6)
  const y = sundayDate.getFullYear()
  const m = String(sundayDate.getMonth() + 1).padStart(2, '0')
  const d = String(sundayDate.getDate()).padStart(2, '0')
  return { start_date: monday, end_date: `${y}-${m}-${d}` }
}
