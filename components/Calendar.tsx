'use client'
/**
 * Calendar — the time-blocking module. An all-spaces weekly view that lays out
 * your reserved capacity template, lets you place HQ items (KR actions + due
 * tasks, each with a duration) onto the week, and auto-fills the week with a
 * greedy planner. Blocks are 'proposed' until committed to Google Calendar.
 *
 * Google read/commit is gated behind a connection state (Stage 2) — until then
 * everything here works natively. Meetings overlay and blocks sync once Google
 * is connected.
 */
import { useMemo, useState, useEffect, useRef } from 'react'
import {
  Space, AnnualObjective, RoadmapItem, WeeklyAction, Task,
  CapacityBlock, CalendarBlock, CapacityKind, NewCapacityBlockInput,
} from '@/lib/types'
import { getMonday, addWeeks, parseDateLocal } from '@/lib/utils'
import * as capDb from '@/lib/db/capacityBlocks'
import * as calDb from '@/lib/db/calendarBlocks'
import { planWeek, minutesToLabel, SchedulableItem, BusyInterval, dateForDow } from '@/lib/calendarPlan'
import * as gcal from '@/lib/db/googleApi'
import type { GoogleBusyEvent } from '@/lib/db/googleApi'

const GRID_START_H = 6           // 6 AM
const GRID_END_H = 22            // 10 PM
const ROW_H = 44                 // px per hour
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const KIND_LABEL: Record<CapacityKind, string> = {
  kr_action: 'KR actions',
  task: 'Tasks',
  both: 'KR + tasks',
}

// A read-only "busy" overlay item — committed HQ blocks now, Google meetings
// once connected.
interface Commitment { date: string; start_minute: number; end_minute: number; title: string; source: 'hq' | 'google' }

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtDay(dateStr: string): { dow: string; dnum: string } {
  const d = parseDateLocal(dateStr)
  return { dow: DOW_LABELS[(d.getDay() + 6) % 7], dnum: String(d.getDate()) }
}
function fmtWeekLabel(weekStart: string): string {
  const a = parseDateLocal(weekStart)
  const b = parseDateLocal(weekStart); b.setDate(b.getDate() + 6)
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  if (a.getMonth() === b.getMonth()) return `${mo(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
  return `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}, ${b.getFullYear()}`
}
const minToTop = (m: number) => ((m - GRID_START_H * 60) / 60) * ROW_H
const durToH = (m: number) => (m / 60) * ROW_H

// Time options for the popup selects (5:00 → 22:00, every 15 min).
const TIME_OPTS: { v: number; label: string }[] = []
for (let m = 5 * 60; m <= 22 * 60; m += 15) TIME_OPTS.push({ v: m, label: minutesToLabel(m) })

type Props = {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  tasks: Task[]
  capacityBlocks: CapacityBlock[]
  setCapacityBlocks: (fn: (p: CapacityBlock[]) => CapacityBlock[]) => void
  calendarBlocks: CalendarBlock[]
  setCalendarBlocks: (fn: (p: CalendarBlock[]) => CalendarBlock[]) => void
  googleConnected: boolean
  onConnectGoogle: () => void
  onDisconnectGoogle: () => void
  toast: (m: string) => void
}

export default function Calendar({
  spaces, roadmapItems, actions, tasks,
  capacityBlocks, setCapacityBlocks, calendarBlocks, setCalendarBlocks,
  googleConnected, onConnectGoogle, onDisconnectGoogle, toast,
}: Props) {
  const [viewWeek, setViewWeek] = useState<string>(getMonday())
  const [mode, setMode] = useState<'week' | 'template'>('week')
  const [busy, setBusy] = useState(false)

  // Stage 2 — Google read state. Meetings for the current week, the user's
  // calendar list, and which calendars feed the meetings overlay.
  const [googleEvents, setGoogleEvents] = useState<GoogleBusyEvent[]>([])
  const [calendars, setCalendars] = useState<gcal.GoogleCalendarMeta[]>([])
  const [selectedCalIds, setSelectedCalIds] = useState<string[]>([])
  const [calsLoaded, setCalsLoaded] = useState(false)
  const [showCals, setShowCals] = useState(false)

  const weekEnd = useMemo(() => {
    const d = parseDateLocal(viewWeek); d.setDate(d.getDate() + 6); return ymd(d)
  }, [viewWeek])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateForDow(viewWeek, i)), [viewWeek])
  const todayStr = ymd(new Date())

  // Fetch Google meetings for the visible week (re-runs on week change).
  useEffect(() => {
    if (!googleConnected) { setGoogleEvents([]); return }
    let cancelled = false
    gcal.fetchEvents(viewWeek, weekEnd)
      .then(evs => { if (!cancelled) setGoogleEvents(evs) })
      .catch(() => { if (!cancelled) setGoogleEvents([]) })
    return () => { cancelled = true }
  }, [googleConnected, viewWeek, weekEnd])

  // Load the calendar list + current read selection once per connection.
  useEffect(() => {
    if (!googleConnected) { setCalendars([]); setSelectedCalIds([]); setCalsLoaded(false); return }
    let cancelled = false
    gcal.listCalendars()
      .then(({ calendars, selected }) => { if (!cancelled) { setCalendars(calendars); setSelectedCalIds(selected); setCalsLoaded(true) } })
      .catch(() => { if (!cancelled) setCalsLoaded(true) })
    return () => { cancelled = true }
  }, [googleConnected])

  const spaceById = useMemo(() => new Map(spaces.map(s => [s.id, s])), [spaces])
  const krById = useMemo(() => new Map(roadmapItems.map(r => [r.id, r])), [roadmapItems])
  const colorFor = (spaceId: string | null) => spaceId ? (spaceById.get(spaceId)?.color ?? 'var(--navy-500)') : 'var(--navy-500)'

  const weekBlocks = useMemo(
    () => calendarBlocks.filter(b => b.block_date >= viewWeek && b.block_date <= weekEnd),
    [calendarBlocks, viewWeek, weekEnd],
  )
  const placedKeys = useMemo(() => {
    const s = new Set<string>()
    for (const b of weekBlocks) s.add(b.task_id ? `task:${b.task_id}` : `action:${b.weekly_action_id}`)
    return s
  }, [weekBlocks])

  // Google meetings as read-only commitments (week grid overlay).
  const meetings = useMemo<Commitment[]>(
    () => googleEvents.map(e => ({
      date: e.date, start_minute: e.startMinute, end_minute: e.endMinute, title: e.title, source: 'google' as const,
    })),
    [googleEvents],
  )

  // Committed HQ blocks + Google meetings read as fixed commitments. Used by the
  // planner as busy time and shown on the template. (Week grid renders committed
  // HQ blocks as real blocks already, so it overlays only `meetings`.)
  const commitments = useMemo<Commitment[]>(
    () => [
      ...weekBlocks.filter(b => b.status === 'committed').map(b => ({
        date: b.block_date, start_minute: b.start_minute, end_minute: b.end_minute, title: b.title, source: 'hq' as const,
      })),
      ...meetings,
    ],
    [weekBlocks, meetings],
  )

  // Schedulable items for this week (not already placed). Items without a real
  // estimate default to 30m so they're still plannable.
  const items = useMemo<SchedulableItem[]>(() => {
    const out: SchedulableItem[] = []
    for (const a of actions) {
      if (a.week_start !== viewWeek || a.completed) continue
      if (placedKeys.has(`action:${a.id}`)) continue
      const kr = krById.get(a.roadmap_item_id)
      out.push({
        source: 'action', id: a.id, title: a.title,
        space_id: kr?.space_id ?? null, kind: 'kr_action',
        duration: a.estimated_minutes ?? 30, priority: 2, due: null,
        health: kr?.health_status ?? null,
      })
    }
    for (const t of tasks) {
      if (t.completed_at || t.parent_task_id) continue
      if (!t.due_date || t.due_date < viewWeek || t.due_date > weekEnd) continue
      if (placedKeys.has(`task:${t.id}`)) continue
      out.push({
        source: 'task', id: t.id, title: t.title,
        space_id: t.space_id, kind: 'task',
        duration: t.estimated_minutes ?? 30, priority: t.priority, due: t.due_date,
        health: null,
      })
    }
    return out
  }, [actions, tasks, viewWeek, weekEnd, placedKeys, krById])

  const itemByKey = useMemo(() => {
    const m = new Map<string, SchedulableItem>()
    for (const it of items) m.set(`${it.source}:${it.id}`, it)
    return m
  }, [items])

  const capacityByDate = useMemo(() => {
    const m = new Map<string, CapacityBlock[]>()
    for (const c of capacityBlocks) {
      const date = dateForDow(viewWeek, c.day_of_week)
      const arr = m.get(date) ?? []
      arr.push(c); m.set(date, arr)
    }
    return m
  }, [capacityBlocks, viewWeek])

  // ── actions ──────────────────────────────────────────────────────
  async function runPlanner() {
    if (busy) return
    if (capacityBlocks.length === 0) { toast('Add capacity blocks in the Template first'); return }
    setBusy(true)
    try {
      const removedIds = await calDb.removeProposedInRange(viewWeek, weekEnd)
      const removed = new Set(removedIds)
      const existing: BusyInterval[] = commitments.map(c => ({ date: c.date, start_minute: c.start_minute, end_minute: c.end_minute }))
      const { placed, unplaced } = planWeek({
        weekStart: viewWeek, capacity: capacityBlocks, items, busy: [], existing,
      })
      const created = await calDb.createMany(placed.map(p => ({
        task_id: p.item.source === 'task' ? p.item.id : null,
        weekly_action_id: p.item.source === 'action' ? p.item.id : null,
        space_id: p.item.space_id,
        capacity_block_id: p.capacity_block_id,
        title: p.item.title,
        block_date: p.date,
        start_minute: p.start_minute,
        end_minute: p.end_minute,
        status: 'proposed',
      })))
      setCalendarBlocks(prev => [...prev.filter(b => !removed.has(b.id)), ...created])
      toast(unplaced.length === 0
        ? `Planned ${created.length} block${created.length === 1 ? '' : 's'}`
        : `Planned ${created.length} · ${unplaced.length} didn't fit`)
    } catch {
      toast('Planning failed')
    } finally {
      setBusy(false)
    }
  }

  async function clearProposed() {
    if (busy) return
    setBusy(true)
    try {
      const removedIds = await calDb.removeProposedInRange(viewWeek, weekEnd)
      const removed = new Set(removedIds)
      setCalendarBlocks(prev => prev.filter(b => !removed.has(b.id)))
      toast('Cleared proposed blocks')
    } catch {
      toast('Clear failed')
    } finally {
      setBusy(false)
    }
  }

  async function placeItemAt(itemKey: string, date: string, start: number) {
    const item = itemByKey.get(itemKey)
    if (!item || busy) return
    const end = start + item.duration
    setBusy(true)
    try {
      const created = await calDb.create({
        task_id: item.source === 'task' ? item.id : null,
        weekly_action_id: item.source === 'action' ? item.id : null,
        space_id: item.space_id,
        title: item.title,
        block_date: date, start_minute: start, end_minute: end, status: 'proposed',
      })
      setCalendarBlocks(prev => [...prev, created])
    } catch {
      toast('Could not place block')
    } finally {
      setBusy(false)
    }
  }

  // Drag an existing block to a new slot — keeps its duration, optimistic.
  // Committed blocks sync the move to Google; proposed blocks are local.
  async function moveBlockAt(blockId: string, date: string, start: number) {
    if (busy) return
    const b = calendarBlocks.find(x => x.id === blockId)
    if (!b) return
    const dur = b.end_minute - b.start_minute
    if (b.block_date === date && b.start_minute === start) return
    const end = start + dur
    setCalendarBlocks(prev => prev.map(x => x.id === blockId ? { ...x, block_date: date, start_minute: start, end_minute: end } : x))
    try {
      if (b.status === 'committed') await gcal.moveCommittedBlock(blockId, date, start)
      else await calDb.update(blockId, { block_date: date, start_minute: start, end_minute: end })
    } catch {
      toast('Could not move block')
      setCalendarBlocks(prev => prev.map(x => x.id === blockId
        ? { ...x, block_date: b.block_date, start_minute: b.start_minute, end_minute: b.end_minute } : x))
    }
  }

  async function removeBlock(b: CalendarBlock) {
    if (busy) return
    setBusy(true)
    try {
      if (b.status === 'committed') await gcal.deleteCommittedBlock(b.id) // also deletes the Google event
      else await calDb.remove(b.id)
      setCalendarBlocks(prev => prev.filter(x => x.id !== b.id))
    } catch {
      toast('Could not remove block')
    } finally {
      setBusy(false)
    }
  }

  // Push this week's proposed blocks to the HQ Google calendar → committed.
  async function commitWeek() {
    if (busy) return
    const proposed = weekBlocks.filter(b => b.status === 'proposed')
    if (proposed.length === 0) { toast('No proposed blocks to commit'); return }
    setBusy(true)
    try {
      const { committed, failed } = await gcal.commitWeek(viewWeek, weekEnd)
      const byId = new Map(committed.map(b => [b.id, b]))
      setCalendarBlocks(prev => prev.map(b => byId.get(b.id) ?? b))
      toast(failed.length === 0
        ? `Committed ${committed.length} to Google`
        : `Committed ${committed.length} · ${failed.length} failed`)
    } catch {
      toast('Commit failed')
    } finally {
      setBusy(false)
    }
  }

  // Toggle a read-source calendar, persist, and refresh the meetings overlay.
  async function toggleCal(id: string) {
    const next = selectedCalIds.includes(id) ? selectedCalIds.filter(x => x !== id) : [...selectedCalIds, id]
    setSelectedCalIds(next)
    try {
      await gcal.saveReadCalendars(next)
      const evs = await gcal.fetchEvents(viewWeek, weekEnd)
      setGoogleEvents(evs)
    } catch {
      toast('Could not update calendars')
    }
  }

  // ── render ───────────────────────────────────────────────────────
  return (
    <div style={{ padding: '22px 26px 60px', maxWidth: 1320, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.01em', margin: 0 }}>Calendar</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setViewWeek(w => addWeeks(w, -1))} style={navBtn}>‹</button>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-100)', minWidth: 168, textAlign: 'center' }}>{fmtWeekLabel(viewWeek)}</span>
          <button onClick={() => setViewWeek(w => addWeeks(w, 1))} style={navBtn}>›</button>
        </div>
        <button onClick={() => setViewWeek(getMonday())} style={ghostBtn}>Today</button>
        <div style={{ display: 'inline-flex', border: '1px solid var(--navy-600)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => setMode('week')} style={segBtn(mode === 'week')}>Week</button>
          <button onClick={() => setMode('template')} style={segBtn(mode === 'template')}>Template</button>
        </div>
        <div style={{ flex: 1 }} />
        {googleConnected ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowCals(s => !s)} style={ghostBtn}>
                Calendars{selectedCalIds.length ? ` · ${selectedCalIds.length}` : ''} ▾
              </button>
              {showCals && (
                <>
                  <div onClick={() => setShowCals(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, width: 286, maxHeight: 340, overflowY: 'auto',
                    background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: 10, boxShadow: '0 16px 50px rgba(0,0,0,.5)',
                  }}>
                    <div style={{ ...nwLabel, margin: '2px 4px 8px' }}>Read meetings from</div>
                    {!calsLoaded && <div style={{ fontSize: 12, color: 'var(--navy-400)', padding: '8px 4px' }}>Loading…</div>}
                    {calsLoaded && calendars.length === 0 && <div style={{ fontSize: 12, color: 'var(--navy-400)', padding: '8px 4px' }}>No calendars found.</div>}
                    {calendars.map(c => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 4px', cursor: 'pointer', fontSize: 12.5, color: 'var(--navy-100)' }}>
                        <input type="checkbox" checked={selectedCalIds.includes(c.id)} onChange={() => toggleCal(c.id)} />
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: c.backgroundColor || 'var(--navy-500)', flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {c.summary}{c.primary ? ' · primary' : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
              border: '1px solid var(--navy-600)', borderRadius: 8, padding: '4px 10px',
              color: 'var(--teal-text)', background: 'var(--navy-800)',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--teal-text)' }} />
              Google connected
            </span>
            <button onClick={onDisconnectGoogle} style={ghostBtn}>Disconnect</button>
          </div>
        ) : (
          <button onClick={onConnectGoogle} style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />
            Connect Google Calendar
          </button>
        )}
      </div>

      {mode === 'week'
        ? <WeekView
            weekDates={weekDates} todayStr={todayStr}
            blocks={weekBlocks} capacityByDate={capacityByDate}
            items={items} meetings={meetings}
            spaceById={spaceById} colorFor={colorFor}
            onPlaceItem={placeItemAt} onMoveBlock={moveBlockAt} onRemoveBlock={removeBlock}
            onPlan={runPlanner} onClear={clearProposed} onCommit={commitWeek}
            proposedCount={weekBlocks.filter(b => b.status === 'proposed').length}
            busy={busy} googleConnected={googleConnected} toast={toast}
          />
        : <TemplateView
            spaces={spaces} capacityBlocks={capacityBlocks} setCapacityBlocks={setCapacityBlocks}
            colorFor={colorFor} spaceById={spaceById}
            weekDates={weekDates} todayStr={todayStr}
            commitments={commitments} googleConnected={googleConnected} toast={toast}
          />
      }
    </div>
  )
}

/* ── shared grid scaffolding ───────────────────────────────────── */
function HourGutter() {
  const hours = Array.from({ length: GRID_END_H - GRID_START_H }, (_, i) => GRID_START_H + i)
  return (
    <div style={{ borderRight: '1px solid var(--navy-600)' }}>
      {hours.map(h => (
        <div key={h} style={{ height: ROW_H, fontSize: 10, color: 'var(--navy-400)', textAlign: 'right', paddingRight: 8, position: 'relative', top: -6 }}>
          {minutesToLabel(h * 60)}
        </div>
      ))}
    </div>
  )
}
function HourLines() {
  const hours = Array.from({ length: GRID_END_H - GRID_START_H }, (_, i) => GRID_START_H + i)
  return <>{hours.map(h => <div key={h} style={{ height: ROW_H, borderBottom: '1px solid var(--navy-700)' }} />)}</>
}
function DayHeaders({ weekDates, todayStr }: { weekDates: string[]; todayStr: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, borderBottom: '1px solid var(--navy-600)' }}>
      <div style={{ borderRight: '1px solid var(--navy-600)' }} />
      {weekDates.map(d => {
        const { dow, dnum } = fmtDay(d); const today = d === todayStr
        return (
          <div key={d} style={{ padding: '9px 8px', textAlign: 'center', borderRight: '1px solid var(--navy-600)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: today ? 'var(--accent)' : 'var(--navy-400)' }}>{dow}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: today ? 'var(--accent)' : 'var(--navy-100)', marginTop: 2 }}>{dnum}</div>
          </div>
        )
      })}
    </div>
  )
}
function CommitmentBlock({ c }: { c: Commitment }) {
  return (
    <div title={`${c.title} (${c.source === 'google' ? 'Google' : 'committed'})`} style={{
      position: 'absolute', left: 3, right: 3, top: minToTop(c.start_minute), height: Math.max(durToH(c.end_minute - c.start_minute) - 2, 14),
      borderRadius: 6, padding: '2px 6px', overflow: 'hidden', zIndex: 2, pointerEvents: 'none',
      background: 'repeating-linear-gradient(45deg, var(--navy-700), var(--navy-700) 5px, var(--navy-600) 5px, var(--navy-600) 10px)',
      border: '1px dashed var(--navy-500)', color: 'var(--navy-200)',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
    </div>
  )
}

/* ── Week view ──────────────────────────────────────────────────── */
function WeekView(props: {
  weekDates: string[]; todayStr: string
  blocks: CalendarBlock[]; capacityByDate: Map<string, CapacityBlock[]>
  items: SchedulableItem[]; meetings: Commitment[]
  spaceById: Map<string, Space>; colorFor: (id: string | null) => string
  onPlaceItem: (itemKey: string, date: string, start: number) => void
  onMoveBlock: (blockId: string, date: string, start: number) => void
  onRemoveBlock: (b: CalendarBlock) => void
  onPlan: () => void; onClear: () => void; onCommit: () => void
  proposedCount: number; busy: boolean; googleConnected: boolean
  toast: (m: string) => void
}) {
  const { weekDates, todayStr, blocks, capacityByDate, items, meetings,
    spaceById, colorFor, onPlaceItem, onMoveBlock, onRemoveBlock, onPlan, onClear, onCommit,
    proposedCount, busy, googleConnected, toast } = props
  const gridH = (GRID_END_H - GRID_START_H) * ROW_H
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const [over, setOver] = useState<{ date: string; valid: boolean } | null>(null)
  // What's being dragged — drives valid-window highlighting + drop validation.
  const [dragCtx, setDragCtx] = useState<{ kind: 'kr_action' | 'task'; spaceId: string | null; duration: number } | null>(null)

  const itemMap = useMemo(() => new Map(items.map(it => [`${it.source}:${it.id}`, it])), [items])

  // Does a capacity block accept this kind+space? (mirrors the planner)
  const accepts = (c: CapacityBlock, kind: 'kr_action' | 'task', spaceId: string | null) =>
    (c.kind === 'both' || c.kind === kind) && (c.space_id === null || c.space_id === spaceId)

  // Resolve a drop to a start minute inside a matching capacity window, or null
  // if the position isn't in a window that accepts this item / it doesn't fit.
  function resolveSlot(kind: 'kr_action' | 'task', spaceId: string | null, duration: number, date: string, minute: number): number | null {
    const caps = capacityByDate.get(date) ?? []
    for (const c of caps) {
      if (!accepts(c, kind, spaceId)) continue
      if (minute < c.start_minute || minute >= c.end_minute) continue
      if (c.end_minute - c.start_minute < duration) continue
      const snapped = Math.round(minute / 15) * 15
      return Math.min(Math.max(snapped, c.start_minute), c.end_minute - duration)
    }
    return null
  }

  function ctxFor(payload: string): { kind: 'kr_action' | 'task'; spaceId: string | null; duration: number } | null {
    if (payload.startsWith('new:')) {
      const it = itemMap.get(payload.slice(4)); if (!it) return null
      return { kind: it.kind, spaceId: it.space_id, duration: it.duration }
    }
    if (payload.startsWith('move:')) {
      const b = blocks.find(x => x.id === payload.slice(5)); if (!b) return null
      return { kind: b.task_id ? 'task' : 'kr_action', spaceId: b.space_id, duration: b.end_minute - b.start_minute }
    }
    return null
  }

  function handleDragOver(date: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!dragCtx) { e.dataTransfer.dropEffect = 'move'; return }
    const rect = e.currentTarget.getBoundingClientRect()
    const minute = GRID_START_H * 60 + ((e.clientY - rect.top) / ROW_H) * 60
    const start = resolveSlot(dragCtx.kind, dragCtx.spaceId, dragCtx.duration, date, minute)
    const valid = start !== null
    e.dataTransfer.dropEffect = valid ? 'move' : 'none'
    setOver(prev => (prev && prev.date === date && prev.valid === valid) ? prev : { date, valid })
  }

  function handleDrop(date: string, e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const payload = e.dataTransfer.getData('text/plain')
    const ctx = ctxFor(payload)
    const rect = e.currentTarget.getBoundingClientRect()
    const minute = GRID_START_H * 60 + ((e.clientY - rect.top) / ROW_H) * 60
    setOver(null); setDragCtx(null)
    if (!ctx) return
    const start = resolveSlot(ctx.kind, ctx.spaceId, ctx.duration, date, minute)
    if (start === null) { toast('No capacity reserved here for this item — add a matching window in the Template'); return }
    if (payload.startsWith('new:')) onPlaceItem(payload.slice(4), date, start)
    else if (payload.startsWith('move:')) onMoveBlock(payload.slice(5), date, start)
  }

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <aside style={{ width: 248, flexShrink: 0, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 14 }}>
        <h3 style={nwLabel}>Unscheduled · this week</h3>
        <p style={{ fontSize: 11, color: 'var(--navy-400)', margin: '4px 0 12px', lineHeight: 1.45 }}>
          Drag an item onto a matching capacity window, or auto-fill the week.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={onPlan} disabled={busy} style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.6 : 1 }}>Plan week</button>
          <button onClick={onClear} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>Clear</button>
        </div>
        {googleConnected && (
          <button
            onClick={onCommit}
            disabled={busy || proposedCount === 0}
            title={proposedCount === 0 ? 'No proposed blocks this week' : 'Write proposed blocks to your HQ Google calendar'}
            style={{ ...ghostBtn, width: '100%', marginBottom: 12, opacity: busy || proposedCount === 0 ? 0.5 : 1 }}
          >
            Commit {proposedCount > 0 ? `${proposedCount} ` : ''}to Google
          </button>
        )}
        {items.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '14px 0' }}>Nothing left to schedule.</p>
        )}
        {items.map(it => {
          const key = `${it.source}:${it.id}`
          return (
            <div
              key={key}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', `new:${key}`); e.dataTransfer.effectAllowed = 'move'; setDragCtx({ kind: it.kind, spaceId: it.space_id, duration: it.duration }) }}
              onDragEnd={() => { setOver(null); setDragCtx(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 10,
                background: 'var(--navy-700)', border: '1px solid var(--navy-600)', marginBottom: 8, cursor: 'grab',
              }}
            >
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, background: colorFor(it.space_id), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--navy-100)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {it.kind === 'kr_action' && <span title="KR action" style={{ color: 'var(--navy-400)', marginRight: 4 }}>◆</span>}
                {it.title}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-300)', background: 'var(--navy-600)', borderRadius: 6, padding: '1px 6px', flexShrink: 0 }}>
                {it.duration}m
              </span>
            </div>
          )
        })}
      </aside>

      <div style={{ flex: 1, minWidth: 0, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, overflow: 'hidden' }}>
        {!googleConnected && (
          <div style={{ padding: '7px 14px', fontSize: 11, color: 'var(--navy-400)', borderBottom: '1px solid var(--navy-600)', background: 'var(--navy-900)' }}>
            Showing HQ blocks only. Your Google meetings will overlay here, and committing blocks will sync, once Google is connected.
          </div>
        )}
        <DayHeaders weekDates={weekDates} todayStr={todayStr} />
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, position: 'relative' }}>
            <HourGutter />
            {weekDates.map(date => {
              const today = date === todayStr
              const caps = capacityByDate.get(date) ?? []
              const dayBlocks = blocks.filter(b => b.block_date === date)
              const dayMeetings = meetings.filter(m => m.date === date)
              const overThis = over?.date === date
              return (
                <div
                  key={date}
                  onDragOver={(e) => handleDragOver(date, e)}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(o => (o?.date === date ? null : o)) }}
                  onDrop={(e) => handleDrop(date, e)}
                  style={{
                    position: 'relative', borderRight: '1px solid var(--navy-700)', height: gridH,
                    background: overThis ? (over!.valid ? 'rgba(74,143,255,.12)' : 'rgba(255,90,80,.09)') : today ? 'rgba(74,143,255,.04)' : 'transparent',
                  }}
                >
                  <HourLines />
                  {/* Google meetings (read-only, behind HQ blocks) */}
                  {dayMeetings.map((m, i) => <CommitmentBlock key={`m${i}`} c={m} />)}
                  {caps.map(c => {
                    const lit = dragCtx ? accepts(c, dragCtx.kind, dragCtx.spaceId) : false
                    return (
                      <div key={c.id} title={`${c.space_id ? spaceById.get(c.space_id)?.name : 'Any space'} · ${KIND_LABEL[c.kind]}`} style={{
                        position: 'absolute', left: 0, right: 0, top: minToTop(c.start_minute), height: durToH(c.end_minute - c.start_minute),
                        background: `color-mix(in srgb, ${colorFor(c.space_id)} ${lit ? 22 : 9}%, transparent)`,
                        borderLeft: `2px solid color-mix(in srgb, ${colorFor(c.space_id)} ${lit ? 95 : 55}%, transparent)`,
                        boxShadow: lit ? `inset 0 0 0 1px color-mix(in srgb, ${colorFor(c.space_id)} 45%, transparent)` : 'none',
                        pointerEvents: 'none',
                      }} />
                    )
                  })}
                  {today && nowMin >= GRID_START_H * 60 && nowMin <= GRID_END_H * 60 && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: minToTop(nowMin), height: 0, borderTop: '2px solid var(--red-text)', zIndex: 5 }} />
                  )}
                  {dayBlocks.map(b => {
                    const proposed = b.status === 'proposed'
                    const col = colorFor(b.space_id)
                    return (
                      <div
                        key={b.id}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', `move:${b.id}`); e.dataTransfer.effectAllowed = 'move'; setDragCtx({ kind: b.task_id ? 'task' : 'kr_action', spaceId: b.space_id, duration: b.end_minute - b.start_minute }) }}
                        onDragEnd={() => { setOver(null); setDragCtx(null) }}
                        title="Drag to move"
                        style={{
                          position: 'absolute', left: 4, right: 4, top: minToTop(b.start_minute), height: Math.max(durToH(b.end_minute - b.start_minute) - 2, 16),
                          borderRadius: 7, padding: '3px 7px', overflow: 'hidden', cursor: 'grab', zIndex: 4,
                          background: proposed ? `color-mix(in srgb, ${col} 24%, transparent)` : col,
                          border: proposed ? `1px dashed ${col}` : `1px solid ${col}`,
                          color: proposed ? 'var(--navy-50)' : '#0b0d10',
                        }}
                      >
                        <button
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); onRemoveBlock(b) }}
                          title="Remove"
                          style={{ position: 'absolute', top: 1, right: 3, background: 'none', border: 'none', color: proposed ? 'var(--navy-200)' : '#0b0d10', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, opacity: 0.7 }}
                        >×</button>
                        <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>{b.title}</div>
                        <div style={{ fontSize: 9.5, opacity: 0.85 }}>{minutesToLabel(b.start_minute)}{proposed ? ' · proposed' : ''}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Template view — drag-to-create week grid ───────────────────── */
function TemplateView(props: {
  spaces: Space[]
  capacityBlocks: CapacityBlock[]
  setCapacityBlocks: (fn: (p: CapacityBlock[]) => CapacityBlock[]) => void
  colorFor: (id: string | null) => string
  spaceById: Map<string, Space>
  weekDates: string[]
  todayStr: string
  commitments: Commitment[]
  googleConnected: boolean
  toast: (m: string) => void
}) {
  const { spaces, capacityBlocks, setCapacityBlocks, colorFor, spaceById, weekDates, todayStr, commitments, googleConnected, toast } = props
  const gridH = (GRID_END_H - GRID_START_H) * ROW_H

  const dragRef = useRef<{ dayIndex: number; date: string; rectTop: number; startMin: number; curMin: number } | null>(null)
  const [drag, setDrag] = useState<{ dayIndex: number; date: string; rectTop: number; startMin: number; curMin: number } | null>(null)
  const [draft, setDraft] = useState<{ dayIndex: number; date: string; start: number; end: number } | null>(null)

  const snap = (m: number) => Math.round(m / 15) * 15
  const clampMin = (m: number) => Math.max(GRID_START_H * 60, Math.min(GRID_END_H * 60, m))
  const minFromY = (clientY: number, rectTop: number) => clampMin(GRID_START_H * 60 + ((clientY - rectTop) / ROW_H) * 60)

  useEffect(() => {
    function move(e: MouseEvent) {
      const d = dragRef.current; if (!d) return
      d.curMin = snap(minFromY(e.clientY, d.rectTop))
      setDrag({ ...d })
    }
    function up() {
      const d = dragRef.current; if (!d) return
      const a = Math.min(d.startMin, d.curMin)
      let b = Math.max(d.startMin, d.curMin)
      if (b - a < 30) b = Math.min(a + 30, GRID_END_H * 60)
      dragRef.current = null
      setDrag(null)
      if (b > a) setDraft({ dayIndex: d.dayIndex, date: d.date, start: a, end: b })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  function startDrag(dayIndex: number, date: string, e: React.MouseEvent<HTMLDivElement>) {
    if (draft) return
    const rectTop = e.currentTarget.getBoundingClientRect().top
    const m = snap(minFromY(e.clientY, rectTop))
    const d = { dayIndex, date, rectTop, startMin: m, curMin: m }
    dragRef.current = d; setDrag({ ...d })
  }

  async function saveDraft(input: NewCapacityBlockInput) {
    try {
      const created = await capDb.create(input)
      setCapacityBlocks(prev => [...prev, created])
      setDraft(null)
    } catch {
      toast('Could not add block')
    }
  }
  async function del(id: string) {
    try { await capDb.remove(id); setCapacityBlocks(prev => prev.filter(b => b.id !== id)) }
    catch { toast('Could not delete') }
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--navy-300)', margin: '0 0 12px', lineHeight: 1.5, maxWidth: 760 }}>
        Your standing weekly template. <b style={{ color: 'var(--navy-100)' }}>Drag on a day</b> to reserve a window, then set the space and work kind.
        The planner packs each week&apos;s KR actions and due tasks into matching windows, around your commitments.
      </p>
      <div style={{ padding: '7px 12px', fontSize: 11, color: 'var(--navy-400)', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, marginBottom: 14 }}>
        {googleConnected
          ? 'Hatched blocks are committed time / Google meetings — draw capacity around them.'
          : 'Hatched blocks are your committed HQ time. Your Google meetings will appear here once connected — for now, the week shown is ' + fmtWeekLabel(weekDates[0]) + '.'}
      </div>

      <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, overflow: 'hidden', userSelect: 'none' }}>
        <DayHeaders weekDates={weekDates} todayStr={todayStr} />
        <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, position: 'relative' }}>
          <HourGutter />
          {weekDates.map((date, dayIndex) => {
            const today = date === todayStr
            const caps = capacityBlocks.filter(c => c.day_of_week === dayIndex).sort((a, b) => a.start_minute - b.start_minute)
            const dayCommits = commitments.filter(c => c.date === date)
            const showDrag = drag && drag.dayIndex === dayIndex
            const dragA = showDrag ? Math.min(drag!.startMin, drag!.curMin) : 0
            const dragB = showDrag ? Math.max(drag!.startMin, drag!.curMin) : 0
            return (
              <div
                key={date}
                onMouseDown={(e) => startDrag(dayIndex, date, e)}
                style={{
                  position: 'relative', borderRight: '1px solid var(--navy-700)', height: gridH,
                  background: today ? 'rgba(74,143,255,.04)' : 'transparent', cursor: 'crosshair',
                }}
              >
                <HourLines />
                {/* commitments (read-only, behind capacity) */}
                {dayCommits.map((c, i) => <CommitmentBlock key={i} c={c} />)}
                {/* existing capacity bands */}
                {caps.map(c => (
                  <div key={c.id} style={{
                    position: 'absolute', left: 0, right: 0, top: minToTop(c.start_minute), height: durToH(c.end_minute - c.start_minute),
                    background: `color-mix(in srgb, ${colorFor(c.space_id)} 16%, transparent)`,
                    borderLeft: `2px solid ${colorFor(c.space_id)}`, zIndex: 3,
                    pointerEvents: 'none', padding: '2px 6px', overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-100)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.space_id ? spaceById.get(c.space_id)?.name : 'Any'}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--navy-400)' }}>{KIND_LABEL[c.kind]}</div>
                    <button
                      onMouseDown={(e) => { e.stopPropagation() }}
                      onClick={(e) => { e.stopPropagation(); del(c.id) }}
                      title="Delete"
                      style={{ position: 'absolute', top: 2, right: 4, pointerEvents: 'auto', background: 'none', border: 'none', color: 'var(--navy-300)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0 }}
                    >×</button>
                  </div>
                ))}
                {/* live drag selection */}
                {showDrag && dragB > dragA && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, top: minToTop(dragA), height: durToH(dragB - dragA),
                    background: 'color-mix(in srgb, var(--accent) 22%, transparent)', border: '1px solid var(--accent)',
                    zIndex: 6, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>{minutesToLabel(dragA)}–{minutesToLabel(dragB)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {draft && (
        <CapacityDraftPopup
          draft={draft} spaces={spaces}
          onCancel={() => setDraft(null)}
          onSave={saveDraft}
        />
      )}
    </div>
  )
}

/* ── popup to designate a drawn capacity block ──────────────────── */
function CapacityDraftPopup(props: {
  draft: { dayIndex: number; date: string; start: number; end: number }
  spaces: Space[]
  onCancel: () => void
  onSave: (input: NewCapacityBlockInput) => void
}) {
  const { draft, spaces, onCancel, onSave } = props
  const [spaceId, setSpaceId] = useState('')
  const [kind, setKind] = useState<CapacityKind>('both')
  const [start, setStart] = useState(draft.start)
  const [end, setEnd] = useState(draft.end)

  function save() {
    if (end <= start) return
    onSave({ space_id: spaceId || null, kind, day_of_week: draft.dayIndex, start_minute: start, end_minute: end })
  }

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 320, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: 'var(--navy-50)' }}>Reserve capacity</h3>
        <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 14 }}>{DOW_LABELS[draft.dayIndex]} · {minutesToLabel(start)}–{minutesToLabel(end)}</div>

        <label style={fieldLabel}>Space</label>
        <select value={spaceId} onChange={e => setSpaceId(e.target.value)} style={{ ...selStyle, width: '100%', marginBottom: 12 }}>
          <option value="">Any space</option>
          {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label style={fieldLabel}>Work</label>
        <select value={kind} onChange={e => setKind(e.target.value as CapacityKind)} style={{ ...selStyle, width: '100%', marginBottom: 12 }}>
          <option value="both">KR + tasks</option>
          <option value="kr_action">KR actions</option>
          <option value="task">Tasks</option>
        </select>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>Start</label>
            <select value={start} onChange={e => setStart(Number(e.target.value))} style={{ ...selStyle, width: '100%' }}>
              {TIME_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabel}>End</label>
            <select value={end} onChange={e => setEnd(Number(e.target.value))} style={{ ...selStyle, width: '100%' }}>
              {TIME_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ ...ghostBtn, flex: 1 }}>Cancel</button>
          <button onClick={save} disabled={end <= start} style={{ ...primaryBtn, flex: 1, opacity: end <= start ? 0.5 : 1 }}>Reserve</button>
        </div>
      </div>
    </div>
  )
}

/* ── styles ─────────────────────────────────────────────────────── */
const nwLabel: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: 'var(--nw-label)', textTransform: 'uppercase', letterSpacing: '.16em', margin: 0 }
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 10, fontWeight: 500, color: 'var(--nw-label)', textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: 5 }
const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-300)', fontSize: 14, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-200)', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }
const segBtn = (on: boolean): React.CSSProperties => ({ background: on ? 'var(--accent-dim)' : 'var(--navy-800)', border: 'none', color: on ? 'var(--accent)' : 'var(--navy-400)', fontSize: 12, fontWeight: 600, padding: '6px 13px', cursor: 'pointer' })
const selStyle: React.CSSProperties = { background: 'var(--navy-900)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '6px 9px', fontSize: 12.5, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none' }
