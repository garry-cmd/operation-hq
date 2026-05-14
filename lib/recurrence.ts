/**
 * Recurrence engine and natural-language quick-add parser for Tasks.
 *
 * Recurrence model is rolling: completing a recurring task advances its
 * due_date in place rather than spawning a new row. `advanceDate` does
 * that math; `parseRecurrence` turns a human string like "every Monday"
 * into the structured rule the DB stores. `parseQuickAdd` is the big
 * one — it takes an entire quick-add input and pulls out title, date,
 * time, priority, recurrence, and tags.
 *
 * All date math is done in ISO date strings ('YYYY-MM-DD') and treats
 * the user's local timezone as the source of truth, matching how
 * lib/utils.ts handles week starts.
 */

import { RecurrenceRule, Priority } from '@/lib/types'

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
type DayCode = typeof DOW[number]

// ── Date helpers (no external deps) ────────────────────────────────

/** YYYY-MM-DD for a Date in local time. */
function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse 'YYYY-MM-DD' as a local-time Date at midnight. */
function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(iso: string, n: number): string {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

function addMonths(iso: string, n: number): string {
  const d = fromISO(iso)
  d.setMonth(d.getMonth() + n)
  return toISO(d)
}

function addYears(iso: string, n: number): string {
  const d = fromISO(iso)
  d.setFullYear(d.getFullYear() + n)
  return toISO(d)
}

function dayCode(iso: string): DayCode {
  return DOW[fromISO(iso).getDay()]
}

/** Today as ISO. Exported for tests / quick-add. */
export function todayISO(): string {
  return toISO(new Date())
}

// ── Recurrence advancement ─────────────────────────────────────────

/**
 * Given the current due_date and a recurrence rule, return the next
 * occurrence after `from` (or after today if `from` is omitted).
 *
 * Daily/yearly: just add interval. Monthly: add interval months (Date
 * handles end-of-month rollover naturally, with the standard caveat
 * that 'Jan 31 + 1 month' lands on Mar 3, not Feb 28). Weekly with
 * byday: find the next day in the rule that comes after `from`,
 * wrapping into next week (and respecting interval, so "every other
 * Monday" actually skips a week).
 */
export function advanceDate(from: string, rule: RecurrenceRule): string {
  const interval = rule.interval ?? 1
  switch (rule.freq) {
    case 'daily':
      return addDays(from, interval)

    case 'weekly': {
      const days = (rule.byday && rule.byday.length > 0)
        ? rule.byday
        : [dayCode(from)]
      // Search forward day-by-day; first matching weekday wins. Cap at
      // ~14 days for the search loop, then handle multi-week interval.
      for (let i = 1; i <= 7; i++) {
        const candidate = addDays(from, i)
        if (days.includes(dayCode(candidate))) {
          // For interval > 1, after finding the next matching weekday,
          // jump forward (interval - 1) weeks. This makes "every other
          // Wednesday" skip a Wednesday correctly.
          return interval > 1 ? addDays(candidate, (interval - 1) * 7) : candidate
        }
      }
      // Fallback (shouldn't reach): just add interval weeks.
      return addDays(from, interval * 7)
    }

    case 'monthly': {
      // bymonthday is not used for advancement — the day of month from
      // `from` is preserved naturally by JS Date arithmetic.
      return addMonths(from, interval)
    }

    case 'yearly':
      return addYears(from, interval)
  }
}

// ── Recurrence parser (human → rule) ───────────────────────────────

const DOW_NAMES: Record<string, DayCode> = {
  monday: 'MO', mon: 'MO',
  tuesday: 'TU', tue: 'TU', tues: 'TU',
  wednesday: 'WE', wed: 'WE',
  thursday: 'TH', thu: 'TH', thur: 'TH', thurs: 'TH',
  friday: 'FR', fri: 'FR',
  saturday: 'SA', sat: 'SA',
  sunday: 'SU', sun: 'SU',
}

/**
 * Parse a human recurrence string. Returns null if the string doesn't
 * match a recognized pattern. Returns the canonical text + rule pair
 * the DB constraint expects (both set together).
 *
 * Supported:
 *   "every day" / "daily"
 *   "every other day"
 *   "every N days"
 *   "every monday" / "every mon"
 *   "weekly" / "every week" / "every other week"
 *   "every monday, wednesday"  (also: "every mon & wed")
 *   "every 2 weeks"
 *   "monthly" / "every month" / "every N months"
 *   "yearly" / "annually" / "every year"
 */
export function parseRecurrence(input: string): { text: string; rule: RecurrenceRule } | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return null

  // Strip leading "every" / "each" — both equivalent.
  const stripped = s.replace(/^(every|each)\s+/, '')

  // "daily" / "every day" / "every other day" / "every N days"
  if (s === 'daily' || stripped === 'day') {
    return { text: 'every day', rule: { freq: 'daily', interval: 1 } }
  }
  if (stripped === 'other day') {
    return { text: 'every other day', rule: { freq: 'daily', interval: 2 } }
  }
  const dailyN = stripped.match(/^(\d+)\s+days?$/)
  if (dailyN) {
    const n = parseInt(dailyN[1], 10)
    return { text: `every ${n} days`, rule: { freq: 'daily', interval: n } }
  }

  // "weekly" / "every week" / "every other week" / "every N weeks"
  if (s === 'weekly' || stripped === 'week') {
    return { text: 'every week', rule: { freq: 'weekly', interval: 1 } }
  }
  if (stripped === 'other week') {
    return { text: 'every other week', rule: { freq: 'weekly', interval: 2 } }
  }
  const weeklyN = stripped.match(/^(\d+)\s+weeks?$/)
  if (weeklyN) {
    const n = parseInt(weeklyN[1], 10)
    return { text: `every ${n} weeks`, rule: { freq: 'weekly', interval: n } }
  }

  // "monthly" / "every month" / "every N months"
  if (s === 'monthly' || stripped === 'month') {
    return { text: 'every month', rule: { freq: 'monthly', interval: 1 } }
  }
  const monthlyN = stripped.match(/^(\d+)\s+months?$/)
  if (monthlyN) {
    const n = parseInt(monthlyN[1], 10)
    return { text: `every ${n} months`, rule: { freq: 'monthly', interval: n } }
  }

  // "yearly" / "annually" / "every year"
  if (s === 'yearly' || s === 'annually' || stripped === 'year') {
    return { text: 'every year', rule: { freq: 'yearly', interval: 1 } }
  }

  // "every weekday" / "weekdays" / "every weekdays"
  if (stripped === 'weekday' || stripped === 'weekdays' || s === 'weekdays') {
    return {
      text: 'every weekday',
      rule: { freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] },
    }
  }

  // "every monday" / "every monday, wednesday" / "every mon & wed"
  // Split on commas, "and", or "&".
  const dayParts = stripped.split(/[,&]|\s+and\s+/).map(p => p.trim()).filter(Boolean)
  if (dayParts.length > 0 && dayParts.every(p => p in DOW_NAMES)) {
    const days = dayParts.map(p => DOW_NAMES[p])
    const text = `every ${dayParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}`
    return { text, rule: { freq: 'weekly', interval: 1, byday: days } }
  }

  return null
}

// ── Quick-add parser ───────────────────────────────────────────────

export interface QuickAddResult {
  title: string
  due_date?: string
  due_time?: string
  priority?: Priority
  recurrence_text?: string
  recurrence_rule?: RecurrenceRule
  tags?: string[]
}

/**
 * Parse a single quick-add line, e.g.:
 *   "review deck tomorrow 3pm #stellar p1"
 *   "dry-fire practice every day p2 #uspsa"
 *   "call dentist may 22"
 *
 * Recognizes (in any order):
 *   - dates: today, tomorrow, next monday, this friday, monday,
 *     YYYY-MM-DD, "may 22", "5/22"
 *   - times: 3pm, 3:15pm, 15:00
 *   - priority: p1 / p2 / p3 / p4
 *   - recurrence: every day, every monday, weekly, every other day,
 *     every 2 weeks, monthly, yearly
 *   - tags: #foo, #foo-bar, #multi_word
 *
 * Anything not classified becomes part of the title. Recognized tokens
 * are stripped. Multi-word recurrence phrases ("every Monday") are
 * matched against the full input string before tokenization.
 */
export function parseQuickAdd(input: string): QuickAddResult {
  let work = input.trim()
  const result: QuickAddResult = { title: '' }

  // Multi-word recurrence — match the longest plausible phrase first.
  // "every other day", "every 2 weeks", "every monday wednesday" etc.
  // We greedily try a recurrence phrase starting at "every" / "daily" /
  // "weekly" / "monthly" / "yearly" and consuming 1–6 following tokens.
  const recurMatch = matchRecurrencePhrase(work)
  if (recurMatch) {
    result.recurrence_text = recurMatch.parsed.text
    result.recurrence_rule = recurMatch.parsed.rule
    work = (work.slice(0, recurMatch.start) + work.slice(recurMatch.end)).replace(/\s+/g, ' ').trim()
  }

  // Tokenize what's left.
  const tokens = work.split(/\s+/)
  const remaining: string[] = []
  const tags: string[] = []

  // Date phrases may be multi-token ("next monday", "may 22"). Walk the
  // token list with a 2-token lookahead.
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    const next = tokens[i + 1]
    const pair = next ? `${tok} ${next}` : ''

    // Try 2-token date first
    if (pair) {
      const d = parseDateToken(pair)
      if (d) { result.due_date = d; i += 2; continue }
    }
    // Then 1-token
    const d1 = parseDateToken(tok)
    if (d1) { result.due_date = d1; i += 1; continue }

    // Time
    const t = parseTimeToken(tok)
    if (t) { result.due_time = t; i += 1; continue }

    // Priority
    const p = parsePriorityToken(tok)
    if (p) { result.priority = p; i += 1; continue }

    // Tag
    if (tok.startsWith('#') && tok.length > 1) {
      tags.push(tok.slice(1).toLowerCase())
      i += 1
      continue
    }

    remaining.push(tok)
    i += 1
  }

  result.title = remaining.join(' ').trim()
  if (tags.length > 0) result.tags = tags
  return result
}

/** Search the input for a recognized recurrence phrase. Returns the
 *  parsed rule + the substring bounds so the caller can excise it. */
function matchRecurrencePhrase(input: string): { parsed: { text: string; rule: RecurrenceRule }; start: number; end: number } | null {
  const lc = input.toLowerCase()
  // Anchor tokens that can start a recurrence phrase
  const anchors = ['every', 'each', 'daily', 'weekly', 'monthly', 'yearly', 'annually']
  for (const anchor of anchors) {
    let idx = 0
    while (idx < lc.length) {
      const found = lc.indexOf(anchor, idx)
      if (found === -1) break
      // Anchor must be a word boundary
      const before = found === 0 ? ' ' : lc[found - 1]
      if (!/\s/.test(before)) { idx = found + 1; continue }
      // Try expanding the candidate phrase up to 6 tokens forward
      const after = lc.slice(found).split(/\s+/)
      for (let len = Math.min(6, after.length); len >= 1; len--) {
        const phrase = after.slice(0, len).join(' ')
        const parsed = parseRecurrence(phrase)
        if (parsed) {
          const end = found + phrase.length
          return { parsed, start: found, end }
        }
      }
      idx = found + 1
    }
  }
  return null
}

function parseDateToken(raw: string): string | null {
  const t = raw.toLowerCase().trim()
  const today = todayISO()

  if (t === 'today') return today
  if (t === 'tomorrow' || t === 'tmrw') return addDays(today, 1)
  if (t === 'yesterday') return addDays(today, -1)

  // Day-of-week → next occurrence of that day (inclusive of today if matches?
  // No — treating "monday" as the *next* upcoming Monday, never today.)
  if (t in DOW_NAMES) {
    return nextDayOfWeek(today, DOW_NAMES[t], false)
  }
  // "next monday" — same as "monday" for upcoming, but explicit.
  const nextM = t.match(/^next\s+(\w+)$/)
  if (nextM && nextM[1] in DOW_NAMES) {
    return nextDayOfWeek(today, DOW_NAMES[nextM[1]], false)
  }
  // "this monday" — same as bare day name.
  const thisM = t.match(/^this\s+(\w+)$/)
  if (thisM && thisM[1] in DOW_NAMES) {
    return nextDayOfWeek(today, DOW_NAMES[thisM[1]], true)
  }

  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t

  // Month name + day: "may 22", "may 22nd"
  const monthMap: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  }
  const md = t.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/)
  if (md && md[1] in monthMap) {
    const month = monthMap[md[1]]
    const day = parseInt(md[2], 10)
    if (day >= 1 && day <= 31) {
      // Resolve to the next future occurrence (this year or next).
      const now = new Date()
      const year = (month < now.getMonth() + 1 || (month === now.getMonth() + 1 && day < now.getDate()))
        ? now.getFullYear() + 1
        : now.getFullYear()
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  // M/D or M/D/YY
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (slash) {
    const m = parseInt(slash[1], 10)
    const d = parseInt(slash[2], 10)
    let y = slash[3] ? parseInt(slash[3], 10) : new Date().getFullYear()
    if (y < 100) y += 2000
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  return null
}

function nextDayOfWeek(fromISOStr: string, target: DayCode, includeToday: boolean): string {
  const from = fromISO(fromISOStr)
  const targetIdx = DOW.indexOf(target)
  const fromIdx = from.getDay()
  let diff = targetIdx - fromIdx
  if (diff < 0) diff += 7
  if (diff === 0 && !includeToday) diff = 7
  return addDays(fromISOStr, diff)
}

function parseTimeToken(raw: string): string | null {
  const t = raw.toLowerCase().trim()
  // 24h: 15:00 / 9:30
  const h24 = t.match(/^(\d{1,2}):(\d{2})$/)
  if (h24) {
    const h = parseInt(h24[1], 10)
    const m = parseInt(h24[2], 10)
    if (h >= 0 && h < 24 && m >= 0 && m < 60) return `${pad(h)}:${pad(m)}:00`
  }
  // 12h: 3pm, 3:15pm, 12am
  const h12 = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (h12) {
    let h = parseInt(h12[1], 10)
    const m = h12[2] ? parseInt(h12[2], 10) : 0
    const ampm = h12[3]
    if (h >= 1 && h <= 12 && m >= 0 && m < 60) {
      if (ampm === 'pm' && h < 12) h += 12
      if (ampm === 'am' && h === 12) h = 0
      return `${pad(h)}:${pad(m)}:00`
    }
  }
  return null
}

function parsePriorityToken(raw: string): Priority | null {
  const m = raw.toLowerCase().match(/^p([1-4])$/)
  if (m) return parseInt(m[1], 10) as Priority
  return null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ── Recurrence presets (detail-panel dropdown) ─────────────────────

const DAY_NAME_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export type RecurrencePresetId = 'daily' | 'weekly' | 'weekdays' | 'monthly' | 'yearly'

export interface RecurrencePreset {
  id: RecurrencePresetId
  label: string         // e.g. "Every week"
  sublabel?: string     // e.g. "on Thursday"
  text: string          // parser-friendly canonical form stored in recurrence_text
  rule: RecurrenceRule
}

/**
 * Build the preset list shown in the detail-panel dropdown.
 * All anchored to `anchor` (typically todayISO()) so the suggested
 * weekly day, monthly day-of-month, and yearly month/day reflect the
 * day the user is making the choice.
 */
export function buildRecurrencePresets(anchor: string): RecurrencePreset[] {
  const d = fromISO(anchor)
  const dow = d.getDay()
  const code = DOW[dow]
  const dayName = DAY_NAME_LONG[dow]
  const monthName = MONTH_NAME[d.getMonth()]
  const dom = d.getDate()
  return [
    {
      id: 'daily',
      label: 'Every day',
      text: 'every day',
      rule: { freq: 'daily', interval: 1 },
    },
    {
      id: 'weekly',
      label: 'Every week',
      sublabel: `on ${dayName}`,
      text: `every ${dayName.toLowerCase()}`,
      rule: { freq: 'weekly', interval: 1, byday: [code] },
    },
    {
      id: 'weekdays',
      label: 'Every weekday',
      sublabel: '(Mon–Fri)',
      text: 'every weekday',
      rule: { freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] },
    },
    {
      id: 'monthly',
      label: 'Every month',
      sublabel: `on the ${ordinal(dom)}`,
      text: 'every month',
      rule: { freq: 'monthly', interval: 1, bymonthday: dom },
    },
    {
      id: 'yearly',
      label: 'Every year',
      sublabel: `on ${monthName} ${dom}`,
      text: 'every year',
      rule: { freq: 'yearly', interval: 1 },
    },
  ]
}

/**
 * Compute the due_date the task should have once a recurrence rule
 * is applied. Silent snap forward: if the current due_date doesn't
 * fit the new rule, advance from `today` to the first date that does.
 * If the current due_date already fits, keep it.
 */
export function snapDueDateToRule(
  currentDue: string | null,
  rule: RecurrenceRule,
  today: string,
): string {
  switch (rule.freq) {
    case 'daily':
      return currentDue ?? today

    case 'weekly': {
      const tCode = DOW[fromISO(today).getDay()]
      const days = (rule.byday && rule.byday.length > 0) ? rule.byday : [tCode]
      if (currentDue && days.includes(dayCode(currentDue))) return currentDue
      // First matching weekday from today, inclusive
      for (let i = 0; i < 7; i++) {
        const cand = addDays(today, i)
        if (days.includes(dayCode(cand))) return cand
      }
      return today
    }

    case 'monthly': {
      const dom = rule.bymonthday ?? fromISO(today).getDate()
      if (currentDue && fromISO(currentDue).getDate() === dom) return currentDue
      // Walk forward up to ~62 days; finds same-day-of-month in this or next month
      for (let i = 0; i < 62; i++) {
        const cand = addDays(today, i)
        if (fromISO(cand).getDate() === dom) return cand
      }
      return today
    }

    case 'yearly': {
      const t = fromISO(today)
      const month = t.getMonth()
      const day = t.getDate()
      if (currentDue) {
        const c = fromISO(currentDue)
        if (c.getMonth() === month && c.getDate() === day) return currentDue
      }
      const thisYear = new Date(t.getFullYear(), month, day)
      if (thisYear.getTime() >= t.getTime()) return toISO(thisYear)
      return toISO(new Date(t.getFullYear() + 1, month, day))
    }
  }
}

/**
 * Human label for a stored recurrence rule, shown on the detail-panel
 * trigger button. Richer than recurrence_text so e.g. a monthly rule
 * reads as "Every month on the 14th" rather than just "every month".
 */
export function recurrenceLabel(rule: RecurrenceRule, dueDate: string | null): string {
  const interval = rule.interval ?? 1
  switch (rule.freq) {
    case 'daily':
      if (interval === 1) return 'Every day'
      if (interval === 2) return 'Every other day'
      return `Every ${interval} days`

    case 'weekly': {
      const days = rule.byday ?? []
      const isWeekdays =
        days.length === 5 &&
        (['MO', 'TU', 'WE', 'TH', 'FR'] as const).every(d => days.includes(d))
      if (isWeekdays) return 'Every weekday'
      if (days.length === 1) {
        const idx = DOW.indexOf(days[0])
        return interval === 1
          ? `Every week on ${DAY_NAME_LONG[idx]}`
          : `Every ${interval} weeks on ${DAY_NAME_LONG[idx]}`
      }
      if (days.length > 1) {
        const names = days.map(c => DAY_NAME_LONG[DOW.indexOf(c)].slice(0, 3)).join(', ')
        return interval === 1 ? `Weekly · ${names}` : `Every ${interval} weeks · ${names}`
      }
      if (interval === 1) return 'Every week'
      if (interval === 2) return 'Every other week'
      return `Every ${interval} weeks`
    }

    case 'monthly': {
      const dom = rule.bymonthday ?? (dueDate ? fromISO(dueDate).getDate() : null)
      if (dom !== null) {
        return interval === 1
          ? `Every month on the ${ordinal(dom)}`
          : `Every ${interval} months on the ${ordinal(dom)}`
      }
      if (interval === 1) return 'Every month'
      return `Every ${interval} months`
    }

    case 'yearly': {
      if (dueDate) {
        const d = fromISO(dueDate)
        return `Every year on ${MONTH_NAME[d.getMonth()]} ${d.getDate()}`
      }
      return interval === 1 ? 'Every year' : `Every ${interval} years`
    }
  }
}

/**
 * Detect whether a stored rule matches one of the canonical presets,
 * for showing a check mark on the active option. Compares against
 * presets built from `anchor` so the "weekly on Thursday" preset
 * matches only on Thursdays (otherwise picking it would silently
 * change the anchor).
 */
export function matchingPresetId(
  rule: RecurrenceRule,
  anchor: string,
): RecurrencePresetId | null {
  const presets = buildRecurrencePresets(anchor)
  for (const p of presets) {
    if (sameRule(p.rule, rule)) return p.id
  }
  return null
}

function sameRule(a: RecurrenceRule, b: RecurrenceRule): boolean {
  if (a.freq !== b.freq) return false
  if ((a.interval ?? 1) !== (b.interval ?? 1)) return false
  if ((a.bymonthday ?? null) !== (b.bymonthday ?? null)) return false
  const ad = [...(a.byday ?? [])].sort().join(',')
  const bd = [...(b.byday ?? [])].sort().join(',')
  return ad === bd
}
