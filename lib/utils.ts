// Object color palette — used for spaces and objectives.
// Tuned to coexist with the cobalt accent: the in-family blue (azure)
// is held to last so it doesn't compete with UI chrome up front.
// All eight read against both dark off-black and light paper bg.
export const COLORS = [
  '#0ea5b8',  // cyan
  '#14b87f',  // emerald
  '#c8a040',  // mustard gold
  '#d4885a',  // warm copper
  '#c44a7c',  // raspberry
  '#8b5cf6',  // violet
  '#6b8caa',  // slate
  '#5b8def',  // azure (sister to accent — picked last)
]

export const ACTIVE_Q = '2Q2026'

export function getRollingQuarters(): string[] {
  const m = ACTIVE_Q.match(/(\d)Q(\d{4})/)
  if (!m) return []
  let q = parseInt(m[1]), y = parseInt(m[2])
  const out: string[] = []
  for (let i = 0; i < 4; i++) {
    out.push(`${q}Q${y}`)
    q++; if (q > 4) { q = 1; y++ }
  }
  return out
}

export function formatQ(q: string): string {
  const m = q.match(/(\d)Q(\d{4})/)
  return m ? `${m[1]}Q ${m[2]}` : q
}

export const QUARTERS = getRollingQuarters()

export function getMonday(d: Date = new Date()): string {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  // Build YYYY-MM-DD from LOCAL components.
  // Previously used toISOString().slice(0,10) which converts to UTC and
  // would shift the date forward by a day when called late in the evening
  // in negative-UTC timezones (e.g. Sunday 8pm Eastern → Monday 00:00 UTC).
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function addWeeks(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + 7 * n)
  return getMonday(d)
}

/**
 * Parse a YYYY-MM-DD date string as a LOCAL calendar date (midnight local time).
 *
 * Avoids the trap where `new Date("2026-04-20")` parses as UTC midnight, which
 * in negative-UTC timezones reads back as the previous day via getDate() —
 * shifting day-bubble math one day backward in places like the Focus tab.
 */
export function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
