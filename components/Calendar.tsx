'use client'
/**
 * Calendar — the time-blocking module. An all-spaces weekly view that lays out
 * your reserved capacity template, lets you place HQ items (KR actions + due
 * tasks, each with a duration) onto the week, and auto-fills the week with a
 * greedy planner. Blocks are 'proposed' until committed to Google Calendar.
 *
 * Google read/commit is gated behind a connection state (Stage 2) — until then
 * everything here works natively: define your template, plan the week, nudge
 * blocks. Meetings will overlay and blocks will sync once Google is connected.
 */
import { useMemo, useState } from 'react'
import {
  Space, AnnualObjective, RoadmapItem, WeeklyAction, Task,
  CapacityBlock, CalendarBlock, CapacityKind,
} from '@/lib/types'
import { getMonday, addWeeks, parseDateLocal } from '@/lib/utils'
import * as capDb from '@/lib/db/capacityBlocks'
import * as calDb from '@/lib/db/calendarBlocks'
import { planWeek, minutesToLabel, SchedulableItem, BusyInterval, dateForDow } from '@/lib/calendarPlan'

const GRID_START_H = 6           // 6 AM
const GRID_END_H = 22            // 10 PM
const ROW_H = 44                 // px per hour
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const KIND_LABEL: Record<CapacityKind, string> = {
  kr_action: 'KR actions',
  task: 'Tasks',
  both: 'KR + tasks',
}

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

// Time options for the template form (5:00 → 22:00, every 30 min).
const TIME_OPTS: { v: number; label: string }[] = []
for (let m = 5 * 60; m <= 22 * 60; m += 30) TIME_OPTS.push({ v: m, label: minutesToLabel(m) })

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
  toast: (m: string) => void
}

export default function Calendar({
  spaces, roadmapItems, actions, tasks,
  capacityBlocks, setCapacityBlocks, calendarBlocks, setCalendarBlocks,
  googleConnected, toast,
}: Props) {
  const [viewWeek, setViewWeek] = useState<string>(getMonday())
  const [mode, setMode] = useState<'week' | 'template'>('week')
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const weekEnd = useMemo(() => {
    const d = parseDateLocal(viewWeek); d.setDate(d.getDate() + 6); return ymd(d)
  }, [viewWeek])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateForDow(viewWeek, i)), [viewWeek])
  const todayStr = ymd(new Date())

  const spaceById = useMemo(() => new Map(spaces.map(s => [s.id, s])), [spaces])
  const krById = useMemo(() => new Map(roadmapItems.map(r => [r.id, r])), [roadmapItems])
  const colorFor = (spaceId: string | null) => spaceId ? (spaceById.get(spaceId)?.color ?? 'var(--navy-500)') : 'var(--navy-500)'

  // Blocks placed in the visible week.
  const weekBlocks = useMemo(
    () => calendarBlocks.filter(b => b.block_date >= viewWeek && b.block_date <= weekEnd),
    [calendarBlocks, viewWeek, weekEnd],
  )
  const placedKeys = useMemo(() => {
    const s = new Set<string>()
    for (const b of weekBlocks) s.add(b.task_id ? `task:${b.task_id}` : `action:${b.weekly_action_id}`)
    return s
  }, [weekBlocks])

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

  // Capacity windows for the week, by date.
  const capacityByDate = useMemo(() => {
    const m = new Map<string, { c: CapacityBlock; date: string }[]>()
    for (const c of capacityBlocks) {
      const date = dateForDow(viewWeek, c.day_of_week)
      const arr = m.get(date) ?? []
      arr.push({ c, date }); m.set(date, arr)
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
      // committed blocks stay and count as busy
      const committed = weekBlocks.filter(b => b.status === 'committed')
      const existing: BusyInterval[] = committed.map(b => ({ date: b.block_date, start_minute: b.start_minute, end_minute: b.end_minute }))
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

  async function placeSelectedAt(date: string, minute: number) {
    if (!selectedItemKey || busy) return
    const item = itemByKey.get(selectedItemKey)
    if (!item) return
    // snap to 15-min, clamp inside the grid
    let start = Math.round(minute / 15) * 15
    start = Math.max(GRID_START_H * 60, Math.min(start, GRID_END_H * 60 - item.duration))
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
      setSelectedItemKey(null)
    } catch {
      toast('Could not place block')
    } finally {
      setBusy(false)
    }
  }

  async function removeBlock(b: CalendarBlock) {
    if (busy) return
    setBusy(true)
    try {
      await calDb.remove(b.id)
      setCalendarBlocks(prev => prev.filter(x => x.id !== b.id))
    } catch {
      toast('Could not remove block')
    } finally {
      setBusy(false)
    }
  }

  // ── render ───────────────────────────────────────────────────────
  return (
    <div style={{ padding: '22px 26px 60px', maxWidth: 1320, margin: '0 auto', width: '100%' }}>
      {/* header */}
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
        {/* Google status — gated until OAuth is wired */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
          border: '1px solid var(--navy-600)', borderRadius: 8, padding: '4px 10px',
          color: googleConnected ? 'var(--teal-text)' : 'var(--navy-400)', background: 'var(--navy-800)',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: googleConnected ? 'var(--teal-text)' : 'var(--navy-500)' }} />
          {googleConnected ? 'Google connected' : 'Google not connected'}
        </span>
      </div>

      {mode === 'week'
        ? <WeekView
            weekDates={weekDates} todayStr={todayStr}
            blocks={weekBlocks} capacityByDate={capacityByDate}
            items={items} selectedItemKey={selectedItemKey} setSelectedItemKey={setSelectedItemKey}
            spaceById={spaceById} colorFor={colorFor}
            onPlace={placeSelectedAt} onRemoveBlock={removeBlock}
            onPlan={runPlanner} onClear={clearProposed} busy={busy}
            googleConnected={googleConnected}
          />
        : <TemplateView
            spaces={spaces} capacityBlocks={capacityBlocks} setCapacityBlocks={setCapacityBlocks}
            colorFor={colorFor} toast={toast}
          />
      }
    </div>
  )
}

/* ── Week view ──────────────────────────────────────────────────── */
function WeekView(props: {
  weekDates: string[]; todayStr: string
  blocks: CalendarBlock[]; capacityByDate: Map<string, { c: CapacityBlock; date: string }[]>
  items: SchedulableItem[]; selectedItemKey: string | null; setSelectedItemKey: (k: string | null) => void
  spaceById: Map<string, Space>; colorFor: (id: string | null) => string
  onPlace: (date: string, minute: number) => void; onRemoveBlock: (b: CalendarBlock) => void
  onPlan: () => void; onClear: () => void; busy: boolean; googleConnected: boolean
}) {
  const { weekDates, todayStr, blocks, capacityByDate, items, selectedItemKey, setSelectedItemKey,
    spaceById, colorFor, onPlace, onRemoveBlock, onPlan, onClear, busy, googleConnected } = props
  const hours = Array.from({ length: GRID_END_H - GRID_START_H }, (_, i) => GRID_START_H + i)
  const gridH = (GRID_END_H - GRID_START_H) * ROW_H
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      {/* rail */}
      <aside style={{ width: 248, flexShrink: 0, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 14 }}>
        <h3 style={nwLabel}>Unscheduled · this week</h3>
        <p style={{ fontSize: 11, color: 'var(--navy-400)', margin: '4px 0 12px', lineHeight: 1.45 }}>
          Pick an item, then click a slot to block it. Or auto-fill the week.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button onClick={onPlan} disabled={busy} style={{ ...primaryBtn, flex: 1, opacity: busy ? 0.6 : 1 }}>Plan week</button>
          <button onClick={onClear} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>Clear</button>
        </div>
        {items.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--navy-500)', textAlign: 'center', padding: '14px 0' }}>Nothing left to schedule.</p>
        )}
        {items.map(it => {
          const key = `${it.source}:${it.id}`
          const sel = selectedItemKey === key
          return (
            <div key={key} onClick={() => setSelectedItemKey(sel ? null : key)} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 10,
              background: 'var(--navy-700)', border: `1px solid ${sel ? 'var(--accent)' : 'var(--navy-600)'}`,
              boxShadow: sel ? '0 0 0 1px var(--accent)' : 'none', marginBottom: 8, cursor: 'pointer',
            }}>
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

      {/* grid */}
      <div style={{ flex: 1, minWidth: 0, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, overflow: 'hidden' }}>
        {!googleConnected && (
          <div style={{ padding: '7px 14px', fontSize: 11, color: 'var(--navy-400)', borderBottom: '1px solid var(--navy-600)', background: 'var(--navy-900)' }}>
            Showing HQ blocks only. Your Google meetings will overlay here, and committing blocks will sync, once Google is connected.
          </div>
        )}
        {/* day headers */}
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
        {/* scrollable grid body */}
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, position: 'relative' }}>
            {/* gutter */}
            <div style={{ borderRight: '1px solid var(--navy-600)' }}>
              {hours.map(h => (
                <div key={h} style={{ height: ROW_H, fontSize: 10, color: 'var(--navy-400)', textAlign: 'right', paddingRight: 8, position: 'relative', top: -6 }}>
                  {minutesToLabel(h * 60)}
                </div>
              ))}
            </div>
            {/* day columns */}
            {weekDates.map(date => {
              const today = date === todayStr
              const caps = capacityByDate.get(date) ?? []
              const dayBlocks = blocks.filter(b => b.block_date === date)
              return (
                <div
                  key={date}
                  onClick={selectedItemKey ? (e) => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const minute = GRID_START_H * 60 + (y / ROW_H) * 60
                    onPlace(date, minute)
                  } : undefined}
                  style={{
                    position: 'relative', borderRight: '1px solid var(--navy-700)', height: gridH,
                    background: today ? 'rgba(74,143,255,.04)' : 'transparent',
                    cursor: selectedItemKey ? 'copy' : 'default',
                  }}
                >
                  {/* hour lines */}
                  {hours.map(h => <div key={h} style={{ height: ROW_H, borderBottom: '1px solid var(--navy-700)' }} />)}
                  {/* capacity bands (faint) */}
                  {caps.map(({ c }) => (
                    <div key={c.id} title={`${c.space_id ? spaceById.get(c.space_id)?.name : 'Any space'} · ${KIND_LABEL[c.kind]}`} style={{
                      position: 'absolute', left: 0, right: 0, top: minToTop(c.start_minute), height: durToH(c.end_minute - c.start_minute),
                      background: `color-mix(in srgb, ${colorFor(c.space_id)} 9%, transparent)`,
                      borderLeft: `2px solid color-mix(in srgb, ${colorFor(c.space_id)} 55%, transparent)`,
                      pointerEvents: 'none',
                    }} />
                  ))}
                  {/* now line */}
                  {today && nowMin >= GRID_START_H * 60 && nowMin <= GRID_END_H * 60 && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: minToTop(nowMin), height: 0, borderTop: '2px solid var(--red-text)', zIndex: 5 }} />
                  )}
                  {/* scheduled blocks */}
                  {dayBlocks.map(b => {
                    const proposed = b.status === 'proposed'
                    const col = colorFor(b.space_id)
                    return (
                      <div key={b.id} onClick={(e) => { e.stopPropagation(); onRemoveBlock(b) }} title="Click to remove" style={{
                        position: 'absolute', left: 4, right: 4, top: minToTop(b.start_minute), height: Math.max(durToH(b.end_minute - b.start_minute) - 2, 16),
                        borderRadius: 7, padding: '3px 7px', overflow: 'hidden', cursor: 'pointer', zIndex: 3,
                        background: proposed ? `color-mix(in srgb, ${col} 24%, transparent)` : col,
                        border: proposed ? `1px dashed ${col}` : `1px solid ${col}`,
                        color: proposed ? 'var(--navy-50)' : '#0b0d10',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.title}</div>
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

/* ── Template view ──────────────────────────────────────────────── */
function TemplateView(props: {
  spaces: Space[]; capacityBlocks: CapacityBlock[]
  setCapacityBlocks: (fn: (p: CapacityBlock[]) => CapacityBlock[]) => void
  colorFor: (id: string | null) => string; toast: (m: string) => void
}) {
  const { spaces, capacityBlocks, setCapacityBlocks, colorFor, toast } = props
  const [dow, setDow] = useState(0)
  const [spaceId, setSpaceId] = useState<string>('') // '' = any
  const [kind, setKind] = useState<CapacityKind>('both')
  const [start, setStart] = useState(8 * 60)
  const [end, setEnd] = useState(10 * 60)
  const [saving, setSaving] = useState(false)

  async function add() {
    if (saving) return
    if (end <= start) { toast('End must be after start'); return }
    setSaving(true)
    try {
      const created = await capDb.create({
        space_id: spaceId || null, kind, day_of_week: dow, start_minute: start, end_minute: end,
      })
      setCapacityBlocks(prev => [...prev, created])
    } catch {
      toast('Could not add block')
    } finally {
      setSaving(false)
    }
  }
  async function del(id: string) {
    try {
      await capDb.remove(id)
      setCapacityBlocks(prev => prev.filter(b => b.id !== id))
    } catch {
      toast('Could not delete')
    }
  }

  const byDay = (d: number) => capacityBlocks.filter(b => b.day_of_week === d).sort((a, b) => a.start_minute - b.start_minute)

  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--navy-300)', margin: '0 0 16px', lineHeight: 1.5, maxWidth: 720 }}>
        Your standing weekly template — reserve recurring windows for a kind of work, scoped to a space (or any).
        The planner packs each week&apos;s KR actions and due tasks into matching windows, around your meetings.
      </p>

      {/* add form */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: 14, marginBottom: 20 }}>
        <Field label="Day">
          <select value={dow} onChange={e => setDow(Number(e.target.value))} style={selStyle}>
            {DOW_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </Field>
        <Field label="Space">
          <select value={spaceId} onChange={e => setSpaceId(e.target.value)} style={selStyle}>
            <option value="">Any space</option>
            {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Work">
          <select value={kind} onChange={e => setKind(e.target.value as CapacityKind)} style={selStyle}>
            <option value="both">KR + tasks</option>
            <option value="kr_action">KR actions</option>
            <option value="task">Tasks</option>
          </select>
        </Field>
        <Field label="Start">
          <select value={start} onChange={e => setStart(Number(e.target.value))} style={selStyle}>
            {TIME_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="End">
          <select value={end} onChange={e => setEnd(Number(e.target.value))} style={selStyle}>
            {TIME_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </Field>
        <button onClick={add} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>Add block</button>
      </div>

      {/* week-of-blocks list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
        {DOW_LABELS.map((label, d) => (
          <div key={d} style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: 12, minHeight: 90 }}>
            <div style={{ ...nwLabel, marginBottom: 10 }}>{label}</div>
            {byDay(d).length === 0 && <div style={{ fontSize: 11, color: 'var(--navy-500)' }}>—</div>}
            {byDay(d).map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 8, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', marginBottom: 6 }}>
                <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, background: colorFor(b.space_id), flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--navy-100)', fontWeight: 600 }}>{minutesToLabel(b.start_minute)}–{minutesToLabel(b.end_minute)}</div>
                  <div style={{ fontSize: 10, color: 'var(--navy-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.space_id ? props.spaces.find(s => s.id === b.space_id)?.name : 'Any'} · {KIND_LABEL[b.kind]}
                  </div>
                </div>
                <button onClick={() => del(b.id)} title="Delete" style={{ background: 'none', border: 'none', color: 'var(--navy-400)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={nwLabel}>{label}</span>
      {children}
    </div>
  )
}

/* ── styles ─────────────────────────────────────────────────────── */
const nwLabel: React.CSSProperties = { fontSize: 10, fontWeight: 500, color: 'var(--nw-label)', textTransform: 'uppercase', letterSpacing: '.16em', margin: 0 }
const navBtn: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-300)', fontSize: 14, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { border: '1px solid var(--navy-600)', background: 'var(--navy-800)', color: 'var(--navy-200)', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '6px 11px', cursor: 'pointer' }
const primaryBtn: React.CSSProperties = { border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }
const segBtn = (on: boolean): React.CSSProperties => ({ background: on ? 'var(--accent-dim)' : 'var(--navy-800)', border: 'none', color: on ? 'var(--accent)' : 'var(--navy-400)', fontSize: 12, fontWeight: 600, padding: '6px 13px', cursor: 'pointer' })
const selStyle: React.CSSProperties = { background: 'var(--navy-900)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '6px 9px', fontSize: 12.5, color: 'var(--navy-50)', fontFamily: 'inherit', outline: 'none', minWidth: 96 }
