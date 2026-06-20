import { CapacityBlock, HealthStatus } from '@/lib/types'
import { parseDateLocal } from '@/lib/utils'

/**
 * calendarPlan — pure scheduling logic. Greedy first-fit: meetings are fixed,
 * walk items in priority order (off-track KR actions first), drop each into the
 * earliest matching open capacity window. Predictable and debuggable; the user
 * nudges anything they don't like. No constraint solver.
 */

export interface SchedulableItem {
  source: 'task' | 'action'
  id: string
  title: string
  space_id: string | null
  kind: 'kr_action' | 'task'   // action → kr_action, task → task
  duration: number             // minutes (estimated)
  priority: number             // 1 = highest (tasks); actions default to 2
  due: string | null           // YYYY-MM-DD or null
  health: HealthStatus | null  // owning KR health (actions) — drives off-track-first
}

export interface BusyInterval {
  date: string                 // YYYY-MM-DD
  start_minute: number
  end_minute: number
}

export interface PlacedBlock {
  item: SchedulableItem
  date: string
  start_minute: number
  end_minute: number
  capacity_block_id: string | null
}

export interface PlanResult {
  placed: PlacedBlock[]
  unplaced: SchedulableItem[]
}

const DAY_MS = 86400000

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Date string for `dow` (0=Mon … 6=Sun) within the week starting at weekStart (a Monday). */
function dateForDow(weekStart: string, dow: number): string {
  const d = parseDateLocal(weekStart)
  d.setDate(d.getDate() + dow)
  return ymd(d)
}

function isOffTrack(h: HealthStatus | null): boolean {
  return h === 'off_track' || h === 'blocked'
}

/** Ordering: off-track KR actions first, then priority asc, then due asc
 *  (nulls last), then longer items first within a tier (pack big rocks). */
function compareItems(a: SchedulableItem, b: SchedulableItem): number {
  const ao = isOffTrack(a.health) ? 0 : 1
  const bo = isOffTrack(b.health) ? 0 : 1
  if (ao !== bo) return ao - bo
  if (a.priority !== b.priority) return a.priority - b.priority
  if ((a.due ?? '9999') !== (b.due ?? '9999')) return (a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1
  return b.duration - a.duration
}

interface Window {
  date: string
  start: number
  end: number
  capacity_block_id: string
  space_id: string | null
  kind: CapacityBlock['kind']
}

function windowAccepts(w: Window, item: SchedulableItem): boolean {
  const kindOk = w.kind === 'both' || w.kind === item.kind
  const spaceOk = w.space_id === null || w.space_id === item.space_id
  return kindOk && spaceOk
}

/** Build occupied-minute intervals per date from busy + already-placed. */
function buildOccupied(busy: BusyInterval[]): Map<string, Array<[number, number]>> {
  const map = new Map<string, Array<[number, number]>>()
  for (const b of busy) {
    const arr = map.get(b.date) ?? []
    arr.push([b.start_minute, b.end_minute])
    map.set(b.date, arr)
  }
  return map
}

/** First free start within [winStart,winEnd) of length >= duration, given the
 *  date's sorted occupied intervals. Returns null if it doesn't fit. */
function firstFit(
  winStart: number, winEnd: number, duration: number,
  occupied: Array<[number, number]>,
): number | null {
  const overlapping = occupied
    .filter(([s, e]) => e > winStart && s < winEnd)
    .sort((a, b) => a[0] - b[0])
  let cursor = winStart
  for (const [s, e] of overlapping) {
    if (s - cursor >= duration) return cursor
    cursor = Math.max(cursor, e)
    if (cursor >= winEnd) return null
  }
  if (winEnd - cursor >= duration) return cursor
  return null
}

/**
 * Pack `items` into the week's `capacity` windows around `busy` time.
 * `existing` are HQ blocks already placed (e.g. committed ones) to avoid
 * double-booking; they're treated as busy.
 */
export function planWeek(opts: {
  weekStart: string
  capacity: CapacityBlock[]
  items: SchedulableItem[]
  busy: BusyInterval[]
  existing?: BusyInterval[]
}): PlanResult {
  const { weekStart, capacity, items } = opts

  // Expand the template into concrete dated windows for this week, ordered
  // chronologically so "earliest matching window" means earliest in the week.
  const windows: Window[] = capacity
    .map(c => ({
      date: dateForDow(weekStart, c.day_of_week),
      start: c.start_minute,
      end: c.end_minute,
      capacity_block_id: c.id,
      space_id: c.space_id,
      kind: c.kind,
    }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start)

  const occupied = buildOccupied([...(opts.busy ?? []), ...(opts.existing ?? [])])

  const queue = [...items].sort(compareItems)
  const placed: PlacedBlock[] = []
  const unplaced: SchedulableItem[] = []

  for (const item of queue) {
    if (!item.duration || item.duration <= 0) { unplaced.push(item); continue }
    let done = false
    for (const w of windows) {
      if (!windowAccepts(w, item)) continue
      const occ = occupied.get(w.date) ?? []
      const start = firstFit(w.start, w.end, item.duration, occ)
      if (start === null) continue
      const end = start + item.duration
      placed.push({ item, date: w.date, start_minute: start, end_minute: end, capacity_block_id: w.capacity_block_id })
      occ.push([start, end])
      occupied.set(w.date, occ)
      done = true
      break
    }
    if (!done) unplaced.push(item)
  }

  return { placed, unplaced }
}

/**
 * AI-assigned placement. Claude decides each item's day + scheduling order and
 * supplies the rationale; this function does the deterministic math — find a
 * matching capacity window (preferred day first, then any day chronologically)
 * and first-fit the exact minutes around busy time. Items Claude didn't mention
 * are appended in the default priority order so nothing is silently dropped.
 */
export function planFromAssignments(opts: {
  weekStart: string
  capacity: CapacityBlock[]
  items: SchedulableItem[]
  busy: BusyInterval[]
  existing?: BusyInterval[]
  order: string[]                               // item keys (`${source}:${id}`) in scheduling order
  preferredDay: Record<string, string | null>   // key → YYYY-MM-DD (or null)
}): PlanResult {
  const itemByKey = new Map(opts.items.map(it => [`${it.source}:${it.id}`, it]))

  const windows: Window[] = opts.capacity
    .map(c => ({
      date: dateForDow(opts.weekStart, c.day_of_week),
      start: c.start_minute, end: c.end_minute,
      capacity_block_id: c.id, space_id: c.space_id, kind: c.kind,
    }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start)

  const occupied = buildOccupied([...(opts.busy ?? []), ...(opts.existing ?? [])])

  // Claude's order first; any item it didn't mention is appended by the default
  // priority comparator so it still gets a shot at an open slot.
  const mentioned = new Set(opts.order.filter(k => itemByKey.has(k)))
  const tail = opts.items
    .filter(it => !mentioned.has(`${it.source}:${it.id}`))
    .sort(compareItems)
    .map(it => `${it.source}:${it.id}`)
  const fullOrder = [...opts.order.filter(k => itemByKey.has(k)), ...tail]

  const placed: PlacedBlock[] = []
  const unplaced: SchedulableItem[] = []

  for (const key of fullOrder) {
    const item = itemByKey.get(key)
    if (!item) continue
    if (!item.duration || item.duration <= 0) { unplaced.push(item); continue }
    const matching = windows.filter(w => windowAccepts(w, item))
    const pref = opts.preferredDay[key] ?? null
    const ordered = pref
      ? [...matching.filter(w => w.date === pref), ...matching.filter(w => w.date !== pref)]
      : matching
    let done = false
    for (const w of ordered) {
      const occ = occupied.get(w.date) ?? []
      const start = firstFit(w.start, w.end, item.duration, occ)
      if (start === null) continue
      const end = start + item.duration
      placed.push({ item, date: w.date, start_minute: start, end_minute: end, capacity_block_id: w.capacity_block_id })
      occ.push([start, end]); occupied.set(w.date, occ)
      done = true; break
    }
    if (!done) unplaced.push(item)
  }

  return { placed, unplaced }
}

// ── small shared time helpers (used by the Calendar UI too) ─────────
export function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60)
  const m = min % 60
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export { dateForDow, ymd }
