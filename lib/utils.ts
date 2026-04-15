export const COLORS = ['#1D9E75','#378ADD','#D85A30','#7F77DD','#BA7517','#D4537E','#639922','#888780']
export const QUARTERS = ['1Q2026','2Q2026','3Q2026','4Q2026']
export const ACTIVE_Q = '2Q2026'

export function getMonday(d: Date = new Date()): string {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1)
  dt.setDate(diff)
  return dt.toISOString().slice(0, 10)
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
