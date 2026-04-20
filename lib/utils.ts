// Naval objective colors — work in both submarine dark and battleship light
export const COLORS = [
  '#3a6a9a',  // steel blue
  '#3a7a58',  // sea green
  '#c89828',  // brass gold
  '#5a6a9a',  // slate blue
  '#3a7a7a',  // teal
  '#6a5a3a',  // brass/tan
  '#5a3a6a',  // deep purple (no pink)
  '#6a7a4a',  // olive
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

export function formatWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
