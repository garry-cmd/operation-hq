export const COLORS = ['#4a8a68','#5a7aaa','#6a8a5a','#7a6aaa','#4a7a8a','#6a7a5a','#3a8a7a','#7a7a8a']
export const ACTIVE_Q = '2Q2026'

// Rolling 4 quarters starting from ACTIVE_Q
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
