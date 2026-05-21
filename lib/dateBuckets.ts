/**
 * Bucket math for the dated-KR model.
 *
 * Single source of truth for:
 *   - Mapping a quarter ID ('2Q2026') to its calendar date range
 *   - Default date range for a newly-created KR (current calendar week)
 *   - Countdown chip computation (label + tier + date text) shown on KR rows
 *     in the OKR tab and the All Spaces dashboard
 *
 * Bucket-assignment helpers for the All Spaces swim lane view will land here
 * in Chunk 3. Kept lean otherwise; only helpers actually called from
 * production code live here.
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
  return { start_date: monday, end_date: formatLocalDate(sundayDate) }
}

// ────────────────────────────────────────────────────────────────────────────
// Countdown chip
// ────────────────────────────────────────────────────────────────────────────

/**
 * Which color/style tier the countdown chip uses. Maps 1:1 to the time
 * buckets in the All Spaces dashboard, so the chip's color IS its bucket.
 */
export type CountdownTier =
  | 'this-week'
  | 'next-week'
  | 'this-month'
  | 'this-quarter'
  | 'default'   // unplanned — range covers whole quarter
  | 'overdue'   // end_date is in the past

export interface CountdownInfo {
  /** Short label for the chip: "1d", "4w", "Q2", "+3d", "today" */
  label: string
  /** Date text shown next to the chip: "May 21 — 24" or "May 30". Empty when default. */
  dateText: string
  tier: CountdownTier
}

/**
 * Compute the countdown chip for a KR given its dates and viewing context.
 * Returns null for habits and other dateless KRs — caller should render nothing.
 *
 * The "default" tier (unplanned) is detected by the range covering the whole
 * viewedQuarter — that's exactly what the migration backfilled, and what the
 * editor would produce if the user hadn't given the KR a tighter window yet.
 */
export function getCountdownInfo(
  startDate: string | null,
  endDate: string | null,
  viewedQuarter: string,
  today: Date = new Date(),
): CountdownInfo | null {
  if (!endDate) return null

  // Default-to-quarter detection: range exactly matches the viewed quarter's
  // calendar bounds. Show a quiet "QN" chip with no date text — the visual
  // signal that this KR is still floating at quarter resolution.
  const qRange = getQuarterRange(viewedQuarter)
  if (qRange && startDate === qRange.start && endDate === qRange.end) {
    const qDigit = viewedQuarter.match(/^(\d)Q/)?.[1] ?? '?'
    return { label: `Q${qDigit}`, dateText: '', tier: 'default' }
  }

  // Days from today to end_date (negative = overdue).
  const end = parseDateLocal(endDate)
  // Zero out today's time so the count is by calendar day, not 24-hour boundary.
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const ms = end.getTime() - todayMidnight.getTime()
  const days = Math.round(ms / (1000 * 60 * 60 * 24))

  const dateText = formatDateRange(startDate, endDate)

  if (days < 0) {
    return { label: `+${-days}d`, dateText, tier: 'overdue' }
  }

  // Label format: today / Nd up to 13 / Nw up to 8 / Nmo beyond.
  let label: string
  if (days === 0) label = 'today'
  else if (days < 14) label = `${days}d`
  else if (days < 63) label = `${Math.round(days / 7)}w`
  else label = `${Math.round(days / 30)}mo`

  // Tier — which bucket end_date lands in. Uses calendar week (Mon-Sun) and
  // calendar month, NOT rolling N-day windows. Matches the All Spaces
  // dashboard bucket math.
  const thisMonday = getMonday(today)
  const thisSunday = addDays(thisMonday, 6)
  const nextSunday = addDays(thisMonday, 13)
  const monthEnd = lastDayOfMonth(today)

  let tier: CountdownTier
  if (endDate <= thisSunday) tier = 'this-week'
  else if (endDate <= nextSunday) tier = 'next-week'
  else if (endDate <= monthEnd) tier = 'this-month'
  else tier = 'this-quarter'

  return { label, dateText, tier }
}

// ────────────────────────────────────────────────────────────────────────────
// Local date helpers (keep here to avoid bloating lib/utils with one-off math)
// ────────────────────────────────────────────────────────────────────────────

function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function addDays(dateStr: string, n: number): string {
  const d = parseDateLocal(dateStr)
  d.setDate(d.getDate() + n)
  return formatLocalDate(d)
}

function lastDayOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return formatLocalDate(last)
}

/**
 * Compact date-range formatter for chip-adjacent display.
 *   "2026-05-30" alone           → "May 30"
 *   "2026-05-21" → "2026-05-24"  → "May 21 – 24"     (same month — drop second month)
 *   "2026-05-30" → "2026-06-02"  → "May 30 – Jun 2"  (different months)
 *   Different years              → adds the year
 */
function formatDateRange(start: string | null, end: string | null): string {
  if (!end) return ''
  const e = parseDateLocal(end)
  const monthShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  const eStr = `${monthShort(e)} ${e.getDate()}`

  if (!start || start === end) return eStr

  const s = parseDateLocal(start)
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${monthShort(s)} ${s.getDate()} – ${e.getDate()}`
  }
  if (s.getFullYear() === e.getFullYear()) {
    return `${monthShort(s)} ${s.getDate()} – ${monthShort(e)} ${e.getDate()}`
  }
  return `${monthShort(s)} ${s.getDate()}, ${s.getFullYear()} – ${monthShort(e)} ${e.getDate()}, ${e.getFullYear()}`
}
