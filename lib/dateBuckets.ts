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

// ────────────────────────────────────────────────────────────────────────────
// All Spaces dashboard — bucket definitions + assignment
// ────────────────────────────────────────────────────────────────────────────

export type BucketKey =
  | 'this-week' | 'next-week' | 'this-month' | 'this-quarter'  // current quarter
  | 'month-1'   | 'month-2'   | 'month-3'                       // future quarter
  | 'overdue'                                                    // virtual prepend

export interface BucketDef {
  key: BucketKey
  label: string         // column header: "This Week", "Jul", etc.
  rangeText: string     // sub-header: "May 20 — 24"
  start: string         // YYYY-MM-DD, inclusive
  end: string           // YYYY-MM-DD, inclusive
}

/**
 * Time buckets when viewing the CURRENT quarter. Cutoffs:
 *   - This Week:    today → upcoming Sunday
 *   - Next Week:    next Mon → next Sun
 *   - This Month:   day after Next Week → end of that calendar month
 *   - This Quarter: day after This Month → end of viewed quarter (catches
 *                   default-dated items: their end_date = quarterEnd lands here)
 *
 * Buckets are capped at quarter end so an item dated in the next quarter
 * never falls into the current-quarter dashboard.
 */
export function getCurrentQuarterBuckets(today: Date, quarter: string): BucketDef[] {
  const qRange = getQuarterRange(quarter)
  const qEnd = qRange?.end ?? formatLocalDate(today)

  const todayStr = formatLocalDate(today)
  const thisMonday = getMonday(today)
  const thisSunday = addDays(thisMonday, 6)
  const nextMonday = addDays(thisMonday, 7)
  const nextSunday = addDays(thisMonday, 13)
  const monthStart = addDays(nextSunday, 1)
  const monthEnd = lastDayOfMonth(parseDateLocal(monthStart))
  const quarterStart = addDays(monthEnd, 1)

  return [
    {
      key: 'this-week',
      label: 'This Week',
      rangeText: formatRange(todayStr, thisSunday),
      start: todayStr,
      end: minDate(thisSunday, qEnd),
    },
    {
      key: 'next-week',
      label: 'Next Week',
      rangeText: formatRange(nextMonday, nextSunday),
      start: nextMonday,
      end: minDate(nextSunday, qEnd),
    },
    {
      key: 'this-month',
      label: 'This Month',
      rangeText: formatRange(monthStart, minDate(monthEnd, qEnd)),
      start: monthStart,
      end: minDate(monthEnd, qEnd),
    },
    {
      key: 'this-quarter',
      label: 'This Quarter',
      rangeText: quarterStart > qEnd ? '—' : `Rest of ${quarter.replace(/^(\d)Q/, 'Q$1 ')}`,
      start: quarterStart,
      end: qEnd,
    },
  ]
}

/**
 * Time buckets for a FUTURE quarter — month-based, since week-level cutoffs
 * stop making sense when "today" isn't inside the viewed range. One column
 * per calendar month of the quarter. Used for planning ahead.
 */
export function getFutureQuarterBuckets(quarter: string): BucketDef[] {
  const m = quarter.match(/^([1-4])Q(\d{4})$/)
  if (!m) return []
  const q = parseInt(m[1], 10)
  const y = parseInt(m[2], 10)
  const months: BucketDef[] = []
  for (let i = 0; i < 3; i++) {
    const monthIdx = (q - 1) * 3 + i  // 0-indexed (Jan = 0)
    const start = new Date(y, monthIdx, 1)
    const end = new Date(y, monthIdx + 1, 0)
    months.push({
      key: `month-${i + 1}` as BucketKey,
      label: start.toLocaleDateString('en-US', { month: 'long' }),
      rangeText: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      start: formatLocalDate(start),
      end: formatLocalDate(end),
    })
  }
  return months
}

/**
 * Drop an item into the first bucket whose end >= item.end_date. Items
 * past the last bucket return null (off-screen, e.g. dated next quarter).
 * Overdue items (end_date < today) get an explicit 'overdue' key so the
 * caller can decide where to surface them.
 */
export function assignToBucket(
  endDate: string | null,
  buckets: BucketDef[],
  today: Date,
): BucketKey | null {
  if (!endDate) return null
  const todayStr = formatLocalDate(today)
  if (endDate < todayStr) return 'overdue'
  for (const b of buckets) {
    if (endDate <= b.end) return b.key
  }
  return null
}

/**
 * Quarter classification for routing the dashboard renderer.
 */
export function classifyQuarter(quarter: string, today: Date): 'past' | 'current' | 'future' {
  const qRange = getQuarterRange(quarter)
  if (!qRange) return 'current'
  const todayStr = formatLocalDate(today)
  if (todayStr > qRange.end) return 'past'
  if (todayStr < qRange.start) return 'future'
  return 'current'
}

/**
 * The previous/next quarter ID (e.g. '2Q2026' → '1Q2026' for back, '3Q2026' for forward).
 */
export function getNeighborQuarter(quarter: string, direction: 'back' | 'forward'): string | null {
  const m = quarter.match(/^([1-4])Q(\d{4})$/)
  if (!m) return null
  let q = parseInt(m[1], 10)
  let y = parseInt(m[2], 10)
  if (direction === 'forward') {
    q++
    if (q > 4) { q = 1; y++ }
  } else {
    q--
    if (q < 1) { q = 4; y-- }
  }
  return `${q}Q${y}`
}

/**
 * True if the KR is sitting at the migration's quarter-default range
 * (i.e. user hasn't planned tighter dates yet). Equivalent of the
 * dashed `QN` chip in the All Spaces dashboard.
 */
export function isDefaultDated(startDate: string | null, endDate: string | null, quarter: string): boolean {
  const qRange = getQuarterRange(quarter)
  return !!qRange && startDate === qRange.start && endDate === qRange.end
}

// Local helpers used by the bucket functions above.
function formatRange(start: string, end: string): string {
  const s = parseDateLocal(start)
  const e = parseDateLocal(end)
  if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) {
    return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${e.getDate()}`
  }
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function minDate(a: string, b: string): string {
  return a < b ? a : b
}
