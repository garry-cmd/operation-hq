/**
 * Bucket math for the dated-KR model.
 *
 * Single source of truth for:
 *   - Mapping a quarter ID ('2Q2026') to its calendar date range
 *   - Default date range for a newly-created KR (current calendar week)
 *   - Countdown chip computation (label + tier + date text) shown on KR rows
 *     in the OKR tab and the Overview swim lane
 *   - Bucket definitions + bucket assignment for the Overview swim lane
 *
 * Weekly-column model (May 25 — capacity-planning rewrite): current quarter
 * shows one column per remaining calendar week, then a trailing "Quarter-
 * bound" column for KRs flagged is_quarter_bound, multi-quarter spans
 * (end_date past quarter end), unplanned defaults, and date-less items.
 * Replaces the prior 3-bucket This Week / Next Week / This Quarter model,
 * which mashed scheduled-future, quarter-intent, and backlog into one cell.
 *
 * The `is_quarter_bound` flag (Chunk 4, May 21) separates two meanings the
 * dashed Q chip used to overload: "unplanned default" (the range still sits
 * at the migration's quarter-wide backfill, dashed) vs. "intentional
 * quarter-level goal" (user explicitly opted in, solid chip). Both live in
 * the Quarter-bound column under the new weekly model.
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
 * Which color/style tier the countdown chip uses.
 *
 * 'quarter-bound' is its own tier (solid Q chip) for items the user
 * explicitly flagged as quarter-level goals — visually distinct from
 * 'default' (dashed Q chip for items that haven't been planned yet).
 *
 * 'multi-quarter' marks KRs whose end_date sits past the viewed quarter's
 * end (e.g. a year-long Net Worth goal viewed in Q2). Placed in the
 * Quarter-bound column with a distinct accent chip so it reads as
 * long-haul rather than spillover.
 */
export type CountdownTier =
  | 'this-week'
  | 'next-week'
  | 'this-quarter'
  | 'quarter-bound' // intentional quarter-level goal (solid chip)
  | 'multi-quarter' // end_date past the viewed quarter (long-haul accent chip)
  | 'default'       // unplanned — range covers whole quarter (dashed chip)
  | 'overdue'       // end_date is in the past

export interface CountdownInfo {
  /** Short label for the chip: "1d", "4w", "Q2", "+3d", "today" */
  label: string
  /** Date text shown next to the chip: "May 21 — 24" or "May 30". Empty when default/quarter-bound. */
  dateText: string
  tier: CountdownTier
}

/**
 * Compute the countdown chip for a KR given its dates and viewing context.
 * Returns null for habits and other dateless KRs — caller should render
 * nothing.
 *
 * Order of checks:
 *   1. is_quarter_bound = true → 'quarter-bound' (solid Qn chip, no date text)
 *   2. end_date null            → null
 *   3. end_date past viewed quarter → 'multi-quarter' (long-haul accent chip)
 *   4. range exactly matches viewed quarter → 'default' (dashed Qn chip)
 *   5. overdue                  → 'overdue'
 *   6. fall into This Week / Next Week / This Quarter by end_date
 */
export function getCountdownInfo(
  kr: { start_date: string | null; end_date: string | null; is_quarter_bound?: boolean },
  viewedQuarter: string,
  today: Date = new Date(),
): CountdownInfo | null {
  // Quarter-bound: intentional quarter-level goal. Renders even if dates
  // don't perfectly match the quarter (defensive — the editor disables
  // date inputs when this is set, but be safe if a stale row slips through).
  if (kr.is_quarter_bound) {
    const qDigit = viewedQuarter.match(/^(\d)Q/)?.[1] ?? '?'
    return { label: `Q${qDigit}`, dateText: '', tier: 'quarter-bound' }
  }

  if (!kr.end_date) return null

  const qRange = getQuarterRange(viewedQuarter)

  // Multi-quarter: end_date past the viewed quarter's end. Show the full
  // span and a distinct accent so it reads as long-haul rather than
  // unplanned spillover.
  if (qRange && kr.end_date > qRange.end) {
    return {
      label: '↗ Multi-Q',
      dateText: formatDateRange(kr.start_date, kr.end_date),
      tier: 'multi-quarter',
    }
  }

  // Default-to-quarter detection: range exactly matches the viewed quarter's
  // calendar bounds AND the user hasn't flagged it as quarter-bound. Shows
  // a quiet dashed "QN" chip with no date text — visible nudge that this KR
  // is still floating at quarter resolution.
  if (qRange && kr.start_date === qRange.start && kr.end_date === qRange.end) {
    const qDigit = viewedQuarter.match(/^(\d)Q/)?.[1] ?? '?'
    return { label: `Q${qDigit}`, dateText: '', tier: 'default' }
  }

  // Days from today to end_date (negative = overdue).
  const end = parseDateLocal(kr.end_date)
  // Zero out today's time so the count is by calendar day, not 24-hour boundary.
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const ms = end.getTime() - todayMidnight.getTime()
  const days = Math.round(ms / (1000 * 60 * 60 * 24))

  const dateText = formatDateRange(kr.start_date, kr.end_date)

  if (days < 0) {
    return { label: `+${-days}d`, dateText, tier: 'overdue' }
  }

  // Label format: today / Nd up to 13 / Nw up to 8 / Nmo beyond.
  let label: string
  if (days === 0) label = 'today'
  else if (days < 14) label = `${days}d`
  else if (days < 63) label = `${Math.round(days / 7)}w`
  else label = `${Math.round(days / 30)}mo`

  // Tier — which bucket end_date lands in. Uses calendar week (Mon-Sun),
  // NOT rolling N-day windows. Matches the 3-bucket dashboard math:
  // anything past Next Week's Sunday falls into This Quarter.
  const thisMonday = getMonday(today)
  const thisSunday = addDays(thisMonday, 6)
  const nextSunday = addDays(thisMonday, 13)

  let tier: CountdownTier
  if (kr.end_date <= thisSunday) tier = 'this-week'
  else if (kr.end_date <= nextSunday) tier = 'next-week'
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

/**
 * "May 25" style — used as the weekly column header label.
 */
function shortMonthDay(dateStr: string): string {
  const d = parseDateLocal(dateStr)
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`
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
  | 'this-week' | 'next-week' | 'this-quarter'   // legacy 3-bucket model (kept for fallback / past quarter)
  | 'month-1'   | 'month-2'   | 'month-3'         // future quarter
  | 'overdue'                                      // virtual prepend
  | 'quarter-bound'                                // weekly model trailing column
  | `week-${string}`                               // weekly model: 'week-YYYY-MM-DD' (Monday of the week)

export interface BucketDef {
  key: BucketKey
  label: string         // column header: "Week of May 25", "Quarter-bound", "Jul"
  rangeText: string     // sub-header: "May 25 — 31" or "Rest of Q2 2026"
  start: string         // YYYY-MM-DD, inclusive. Empty for non-date-bounded buckets (quarter-bound).
  end: string           // YYYY-MM-DD, inclusive. Empty for non-date-bounded buckets.
  /** Marks "this week" — gets accent treatment in the header + cell. */
  isCurrentWeek?: boolean
  /** Marks the trailing "Quarter-bound" column — gets the warm-tinted treatment. */
  isQuarterBound?: boolean
}

/**
 * Time buckets when viewing the CURRENT quarter. One column per remaining
 * calendar week (Mon → Sun, capped at quarter end), then a trailing
 * Quarter-bound column for is_quarter_bound items, unplanned defaults,
 * date-less items, and multi-quarter spans.
 *
 * Earlier models (Chunk 3: 4 buckets; Chunk 4: 3 buckets) conflated
 * scheduled-future, quarter-intent, and backlog into a single "rest of
 * quarter" column. The weekly model splits these so capacity-planning
 * actually works — the load distribution across upcoming weeks is the
 * eye-test signal.
 *
 * Returns at minimum the Quarter-bound column even if today is past
 * quarter end (defensive — should only happen if classification is wrong).
 */
export function getCurrentQuarterBuckets(today: Date, quarter: string): BucketDef[] {
  const qRange = getQuarterRange(quarter)
  const todayMonday = getMonday(today)
  const buckets: BucketDef[] = []

  if (qRange) {
    let weekMonday = todayMonday
    // Cap weekly columns at the week containing quarter end. If quarter end
    // is mid-week, the last column's `end` is clipped to qRange.end so
    // assignment math doesn't bleed into the following quarter.
    while (weekMonday <= qRange.end) {
      const weekSunday = addDays(weekMonday, 6)
      const clippedEnd = minDate(weekSunday, qRange.end)
      buckets.push({
        key: `week-${weekMonday}`,
        label: `Week of ${shortMonthDay(weekMonday)}`,
        rangeText: formatRange(weekMonday, clippedEnd),
        start: weekMonday,
        end: clippedEnd,
        isCurrentWeek: weekMonday === todayMonday,
      })
      weekMonday = addDays(weekMonday, 7)
    }
  }

  buckets.push({
    key: 'quarter-bound',
    label: 'Quarter-bound',
    rangeText: `Rest of ${quarter.replace(/^(\d)Q/, 'Q$1 ')}`,
    start: '',
    end: '',
    isQuarterBound: true,
  })

  return buckets
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
 *
 * NOTE: This is the date-only helper. The weekly Overview uses
 * assignKRToBucket below, which also routes is_quarter_bound, multi-quarter,
 * date-less, and unplanned items into the trailing Quarter-bound column.
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
    if (b.isQuarterBound) continue // skip the trailing non-date column
    if (endDate <= b.end) return b.key
  }
  return null
}

/**
 * KR-aware bucket assignment for the weekly Overview model. Routes:
 *   - is_quarter_bound = true       → 'quarter-bound'
 *   - no end_date                   → 'quarter-bound'
 *   - end_date past quarter end     → 'quarter-bound' (multi-quarter)
 *   - unplanned (range matches Q)   → 'quarter-bound'
 *   - end_date in the past          → 'overdue'
 *   - otherwise                     → first weekly bucket whose end >= end_date
 *
 * If no weekly bucket matches (e.g. KR's end_date is past all weekly columns
 * but still inside the quarter — shouldn't happen with current bucket math
 * but guard anyway), falls through to 'quarter-bound'.
 */
export function assignKRToBucket(
  kr: { start_date: string | null; end_date: string | null; is_quarter_bound?: boolean },
  buckets: BucketDef[],
  today: Date,
  viewedQuarter: string,
): BucketKey | 'overdue' {
  if (kr.is_quarter_bound) return 'quarter-bound'
  if (!kr.end_date) return 'quarter-bound'

  const qRange = getQuarterRange(viewedQuarter)
  if (qRange && kr.end_date > qRange.end) return 'quarter-bound' // multi-quarter

  if (isUnplanned(kr, viewedQuarter)) return 'quarter-bound'

  const todayStr = formatLocalDate(today)
  if (kr.end_date < todayStr) return 'overdue'

  for (const b of buckets) {
    if (b.isQuarterBound) continue
    if (b.end && kr.end_date <= b.end) return b.key
  }
  return 'quarter-bound'
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
 * AND hasn't been explicitly flagged as quarter-bound. These are the
 * items the dashboard surfaces as "unplanned" — pressure to give them
 * a tighter window or commit to quarter-bound.
 *
 * Renamed from `isDefaultDated` in Chunk 4 to make the semantic clearer:
 * quarter-bound items also have quarter-default dates, but they're NOT
 * unplanned (the user explicitly chose that scope).
 */
export function isUnplanned(
  kr: { start_date: string | null; end_date: string | null; is_quarter_bound?: boolean },
  quarter: string,
): boolean {
  if (kr.is_quarter_bound) return false  // intentional quarter-level goal — not unplanned
  const qRange = getQuarterRange(quarter)
  return !!qRange && kr.start_date === qRange.start && kr.end_date === qRange.end
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
