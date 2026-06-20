'use client'
import { useEffect, useMemo, useState } from 'react'
import type { Space, AnnualObjective, RoadmapItem, WeeklyAction, Task, HabitCheckin, Note } from '@/lib/types'
import { getMonday, addWeeks, parseDateLocal } from '@/lib/utils'
import { quoteForDay } from '@/lib/quotes'
import { spaceDisplayColor } from '@/lib/spaceColor'
import * as actionsDb from '@/lib/db/actions'
import * as tasksDb from '@/lib/db/tasks'
import * as checkinsDb from '@/lib/db/checkins'
import { fetchCalendarEvents, type GoogleBusyEvent, type GoogleAllDayEvent } from '@/lib/db/googleApi'

// ── date helpers (local-tz safe; mirror Calendar.tsx) ──
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateForDow(weekStart: string, dow: number): string {
  const d = parseDateLocal(weekStart); d.setDate(d.getDate() + dow); return ymd(d)
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseDateLocal(b).getTime() - parseDateLocal(a).getTime()) / 86_400_000)
}
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
function shortDow(dateStr: string): string {
  return DOW[(parseDateLocal(dateStr).getDay() + 6) % 7]
}
function fmtRange(weekStart: string): string {
  const a = parseDateLocal(weekStart); const b = parseDateLocal(weekStart); b.setDate(b.getDate() + 6)
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  return a.getMonth() === b.getMonth()
    ? `${mo(a)} ${a.getDate()} – ${b.getDate()}`
    : `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}`
}
function dayPart(h: number): string {
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

interface Props {
  spaces: Space[]
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  actions: WeeklyAction[]
  setActions: React.Dispatch<React.SetStateAction<WeeklyAction[]>>
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  habitCheckins: HabitCheckin[]
  setHabitCheckins: (fn: (h: HabitCheckin[]) => HabitCheckin[]) => void
  notes: Note[]
  googleConnected: boolean
  onOpenNote: (noteId: string) => void
  onOpenTasks: () => void
  onOpenBacklog: () => void
  onOpenCalendar: () => void
  toast: (m: string) => void
}

export default function Home({
  spaces, objectives, roadmapItems, actions, setActions, tasks, setTasks,
  habitCheckins, setHabitCheckins, notes, googleConnected,
  onOpenNote, onOpenTasks, onOpenBacklog, onOpenCalendar, toast,
}: Props) {
  const [weekMonday, setWeekMonday] = useState<string>(getMonday())
  const [selectedKRId, setSelectedKRId] = useState<string | null>(null)
  const [busyEvents, setBusyEvents] = useState<GoogleBusyEvent[]>([])
  const [allDayEvents, setAllDayEvents] = useState<GoogleAllDayEvent[]>([])
  const [nowTick, setNowTick] = useState(() => Date.now())

  const weekEnd = useMemo(() => dateForDow(weekMonday, 6), [weekMonday])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => dateForDow(weekMonday, i)), [weekMonday])
  const todayStr = ymd(new Date())
  const isCurrentWeek = weekMonday === getMonday()

  const krById = useMemo(() => new Map(roadmapItems.map(r => [r.id, r])), [roadmapItems])
  const spaceById = useMemo(() => new Map(spaces.map(s => [s.id, s])), [spaces])
  const colorForSpace = (id: string | null) => {
    const sp = id ? spaceById.get(id) : null
    return sp ? spaceDisplayColor(sp) : 'var(--navy-500)'
  }

  // Tick the now-line every minute (only matters on the current week).
  useEffect(() => {
    if (!isCurrentWeek) return
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [isCurrentWeek])

  // Fetch the week's calendar (busy + all-day) when connected.
  useEffect(() => {
    if (!googleConnected) { setBusyEvents([]); setAllDayEvents([]); return }
    let cancelled = false
    fetchCalendarEvents(weekMonday, weekEnd)
      .then(({ events, allDayEvents }) => { if (!cancelled) { setBusyEvents(events); setAllDayEvents(allDayEvents) } })
      .catch(() => { if (!cancelled) { setBusyEvents([]); setAllDayEvents([]) } })
    return () => { cancelled = true }
  }, [googleConnected, weekMonday, weekEnd])

  const quote = useMemo(() => quoteForDay(new Date()), [])

  // ── Key actions: this week's weekly_actions, grouped by space ──
  const actionGroups = useMemo(() => {
    const weekActions = actions.filter(a => a.week_start === weekMonday)
    const bySpace = new Map<string, WeeklyAction[]>()
    for (const a of weekActions) {
      const kr = krById.get(a.roadmap_item_id)
      if (!kr) continue
      const arr = bySpace.get(kr.space_id) ?? []
      arr.push(a); bySpace.set(kr.space_id, arr)
    }
    const orderedSpaces = [...spaces].sort((a, b) => a.sort_order - b.sort_order)
    let doneTotal = 0, total = 0
    const groups = orderedSpaces
      .filter(sp => bySpace.has(sp.id))
      .map(sp => {
        const list = (bySpace.get(sp.id) ?? []).slice().sort((a, b) => Number(a.completed) - Number(b.completed))
        const open = list.filter(a => !a.completed).length
        const done = list.length - open
        doneTotal += done; total += list.length
        return { space: sp, list, open, done }
      })
    return { groups, doneTotal, total }
  }, [actions, weekMonday, krById, spaces])

  // ── Tasks due this week (open, non-subtask, due in week) ──
  const dueThisWeek = useMemo(() =>
    tasks
      .filter(t => !t.completed_at && !t.parent_task_id && t.due_date && t.due_date >= weekMonday && t.due_date <= weekEnd)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [tasks, weekMonday, weekEnd])

  const backlogCount = useMemo(() =>
    tasks.filter(t => !t.completed_at && !t.parent_task_id && !t.due_date).length,
    [tasks])

  // ── Overdue tasks (needs attention) ──
  const overdue = useMemo(() =>
    tasks
      .filter(t => !t.completed_at && !t.parent_task_id && t.due_date && t.due_date < todayStr)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')),
    [tasks, todayStr])

  // ── Habits: habit KRs × 7-day grid ──
  const habitKRs = useMemo(() =>
    roadmapItems.filter(k => k.is_habit && !k.is_parked && k.health_status !== 'done'),
    [roadmapItems])
  const checkinSet = useMemo(() => {
    const m = new Map<string, string>() // `${kr}:${date}` → checkin id
    for (const c of habitCheckins) m.set(`${c.roadmap_item_id}:${c.date}`, c.id)
    return m
  }, [habitCheckins])

  // ── Notes for the selected KR ──
  const selectedKR = selectedKRId ? krById.get(selectedKRId) ?? null : null
  const krNotes = useMemo(() =>
    selectedKRId ? notes.filter(n => n.roadmap_item_id === selectedKRId) : [],
    [notes, selectedKRId])

  // ── meetings + all-day grouped by date ──
  const busyByDate = useMemo(() => {
    const m = new Map<string, GoogleBusyEvent[]>()
    for (const e of busyEvents) { const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a) }
    for (const a of m.values()) a.sort((x, y) => x.startMinute - y.startMinute)
    return m
  }, [busyEvents])
  const allDayByDate = useMemo(() => {
    const m = new Map<string, GoogleAllDayEvent[]>()
    for (const e of allDayEvents) { const a = m.get(e.date) ?? []; a.push(e); m.set(e.date, a) }
    return m
  }, [allDayEvents])

  // now-line position (current week only)
  const nowLeftPct = useMemo(() => {
    if (!isCurrentWeek) return null
    const now = new Date(nowTick)
    const dayIdx = (now.getDay() + 6) % 7 // Mon=0
    const frac = (now.getHours() * 60 + now.getMinutes()) / 1440
    return ((dayIdx + frac) / 7) * 100
  }, [isCurrentWeek, nowTick])

  // ── mutations ──
  async function toggleAction(a: WeeklyAction) {
    try {
      const updated = await actionsDb.update(a.id, { completed: !a.completed })
      setActions(prev => prev.map(x => x.id === a.id ? updated : x))
    } catch { toast('Could not update action') }
  }
  async function toggleTask(t: Task) {
    try {
      const updated = await tasksDb.toggleComplete(t)
      setTasks(prev => prev.map(x => x.id === t.id ? updated : x))
    } catch { toast('Could not update task') }
  }
  async function toggleHabit(krId: string, date: string) {
    const key = `${krId}:${date}`
    const existing = checkinSet.get(key)
    try {
      if (existing) {
        await checkinsDb.habit.remove(existing)
        setHabitCheckins(prev => prev.filter(c => c.id !== existing))
      } else {
        const created = await checkinsDb.habit.create(krId, date)
        setHabitCheckins(prev => [...prev, created])
      }
    } catch { toast('Could not update habit') }
  }
  async function backlogTask(t: Task) {
    try {
      const updated = await tasksDb.update(t.id, { due_date: null })
      setTasks(prev => prev.map(x => x.id === t.id ? updated : x))
      toast('Moved to backlog')
    } catch { toast('Could not move to backlog') }
  }
  async function snoozeTask(t: Task) {
    const tm = parseDateLocal(todayStr); tm.setDate(tm.getDate() + 1)
    try {
      const updated = await tasksDb.update(t.id, { due_date: ymd(tm) })
      setTasks(prev => prev.map(x => x.id === t.id ? updated : x))
      toast('Snoozed to tomorrow')
    } catch { toast('Could not snooze') }
  }
  async function killTask(t: Task) {
    try {
      await tasksDb.remove(t.id) // hard delete, no confirm (locked decision)
      setTasks(prev => prev.filter(x => x.id !== t.id))
      toast('Deleted')
    } catch { toast('Could not delete') }
  }
  function onPickKR(krId: string) { setSelectedKRId(prev => prev === krId ? prev : krId) }

  const headerSub = isCurrentWeek
    ? `${fmtRange(weekMonday)} · ${DOW_FULL[(new Date().getDay() + 6) % 7]} ${dayPart(new Date().getHours())}`
    : `${fmtRange(weekMonday)}`

  return (
    <div className="home-deck">
      {/* header */}
      <div className="hd-row">
        <h1>{isCurrentWeek ? 'This week' : 'Week of'} <span className="sub">{headerSub}</span></h1>
        <div className="wknav">
          <button onClick={() => setWeekMonday(w => addWeeks(w, -1))} title="Previous week">‹</button>
          {!isCurrentWeek && <button className="today" onClick={() => setWeekMonday(getMonday())} title="This week">●</button>}
          <button onClick={() => setWeekMonday(w => addWeeks(w, 1))} title="Next week">›</button>
        </div>
      </div>

      {/* quote */}
      <div className="quote">
        <span className="mark">“</span>
        <span className="q">{quote.text}</span>
        <span className="by">— {quote.author}</span>
      </div>

      {/* shape of the week */}
      <div className="ribhead">
        <span className="label">Shape of the week</span>
        <span className="cap">meetings · all-day / holidays{googleConnected ? ' · from your calendars' : ''}</span>
        {!googleConnected && <span className="connect" onClick={onOpenCalendar}>Connect Google ↗</span>}
      </div>
      <div className="ribwrap">
        <div className="grid7">
          {nowLeftPct != null && (
            <div className="nowline" style={{ left: `${nowLeftPct}%` }}>
              <span className="nowcap">now</span><span className="nowdot" />
            </div>
          )}
          {weekDates.map((date, i) => {
            const isToday = date === todayStr
            const mtgs = busyByDate.get(date) ?? []
            const ads = allDayByDate.get(date) ?? []
            const MAX_M = 4, MAX_A = 2
            return (
              <div key={date} className={`day${isToday ? ' today' : ''}`}>
                <div className="dtop">
                  <span className="dname">{DOW[i]}{isToday ? ' · today' : ''}</span>
                  <span className="dnum">{parseDateLocal(date).getDate()}</span>
                </div>
                {ads.slice(0, MAX_A).map(e => (
                  <div key={e.id} className={`allday${/holiday/i.test(e.title) ? ' holiday' : ' ev'}`} title={e.title}>{e.title}</div>
                ))}
                {ads.length > MAX_A && <div className="dmore">+{ads.length - MAX_A} all-day</div>}
                {mtgs.slice(0, MAX_M).map(e => (
                  <div key={e.id} className="mtg" title={e.title}>
                    <span className="mdot" />
                    <span className="mt">{e.title}</span>
                    <span className="tm">{fmtMin(e.startMinute)}</span>
                  </div>
                ))}
                {mtgs.length > MAX_M && <div className="dmore">+{mtgs.length - MAX_M} more</div>}
              </div>
            )
          })}
        </div>
      </div>

      {/* body */}
      <div className="hd-body">
        {/* LEFT: key actions */}
        <section>
          <div className="ka-head">
            <span className="label">Key actions · all spaces</span>
            <span className="kadone">{actionGroups.total === 0 ? 'no actions this week' : `${actionGroups.doneTotal} of ${actionGroups.total} done`}</span>
          </div>
          {actionGroups.groups.length === 0 ? (
            <div className="empty">No key actions planned for this week.</div>
          ) : actionGroups.groups.map(({ space, list, open, done }) => (
            <div key={space.id} className="spgrp">
              <div className="sphead">
                <span className="dot" style={{ background: spaceDisplayColor(space) }} />
                {space.name}
                <span className="cnt">· {open > 0 ? `${open} open` : `${done} done`}</span>
              </div>
              {list.map(a => {
                const kr = krById.get(a.roadmap_item_id)
                const health = kr?.health_status
                return (
                  <div key={a.id} className={`act${a.completed ? ' is-done' : ''}`}>
                    <button className={`bub${a.completed ? ' done' : ''}`} onClick={() => toggleAction(a)} title={a.completed ? 'Mark not done' : 'Mark done'}>{a.completed ? '✓' : ''}</button>
                    <span className="atitle">{a.title}</span>
                    {!a.completed && health === 'off_track' && <span className="status off">off track</span>}
                    {!a.completed && health === 'blocked' && <span className="status blocked">blocked</span>}
                    {kr && (
                      <button className={`krpill${selectedKRId === kr.id ? ' on' : ''}`} onClick={() => onPickKR(kr.id)} title="Load this KR's notes">
                        <span className="di">◆</span><span className="kt">{kr.title}</span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </section>

        {/* RIGHT rail */}
        <aside>
          {/* tasks due */}
          <div className="card">
            <div className="chead">
              <span><span className="label">Tasks due this week</span><span className="n">{dueThisWeek.length}</span></span>
              <span className="link" onClick={onOpenBacklog}>Backlog · {backlogCount} ↗</span>
            </div>
            {dueThisWeek.length === 0 ? (
              <div className="empty sm">Nothing due this week.</div>
            ) : <>
              {dueThisWeek.slice(0, 5).map(t => (
                <div key={t.id} className="trow">
                  <button className="cb" onClick={() => toggleTask(t)} title="Complete" />
                  <span className="dot" style={{ background: colorForSpace(t.space_id) }} />
                  <span className="tt">{t.title}</span>
                  <span className="tday">{shortDow(t.due_date!)}</span>
                </div>
              ))}
              {dueThisWeek.length > 5 && (
                <div className="more"><span className="link" onClick={onOpenTasks}>+{dueThisWeek.length - 5} more · open in Tasks ↗</span></div>
              )}
            </>}
          </div>

          {/* habits */}
          {habitKRs.length > 0 && (
            <div className="card">
              <div className="chead"><span className="label">Habits</span></div>
              <div className="hhead"><span /> {DOW.map((d, i) => <span key={i}>{d[0]}</span>)}</div>
              {habitKRs.map(kr => (
                <div key={kr.id} className="habit">
                  <span className="hn"><span className="dot" style={{ background: colorForSpace(kr.space_id) }} />{kr.title}</span>
                  {weekDates.map((date, i) => {
                    const hit = checkinSet.has(`${kr.id}:${date}`)
                    const isToday = date === todayStr
                    return <button key={i} className={`hc${hit ? ' hit' : ''}${isToday ? ' today' : ''}`} onClick={() => toggleHabit(kr.id, date)} title={`${kr.title} · ${date}`} />
                  })}
                </div>
              ))}
            </div>
          )}

          {/* notes (contextual) */}
          <div className="card">
            <div className="chead">
              <span className="label">Notes</span>
              <span className="muted" style={{ fontSize: 11.5 }}>click a <span style={{ color: 'var(--accent)' }}>◆</span> KR</span>
            </div>
            {!selectedKR ? (
              <div className="notes-empty">Click any <span className="di">◆</span> KR bubble to load that KR’s notes.</div>
            ) : (
              <>
                <div className="note-ctx"><span className="dot" style={{ background: colorForSpace(selectedKR.space_id) }} />{selectedKR.title} · {krNotes.length} {krNotes.length === 1 ? 'note' : 'notes'}</div>
                {krNotes.length === 0 ? (
                  <div className="empty sm">No notes linked to this KR yet.</div>
                ) : krNotes.map(n => (
                  <div key={n.id} className="note" onClick={() => onOpenNote(n.id)}>
                    <span className="ntitle">{n.title?.trim() || 'Untitled'}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </aside>
      </div>

      {/* needs attention — below the fold, overdue tasks only */}
      {overdue.length > 0 && (
        <div className="attn">
          <div className="ahead"><span className="label">Needs attention</span><span className="cap">overdue tasks only</span></div>
          {overdue.map(t => (
            <div key={t.id} className="arow">
              <button className="cb" onClick={() => toggleTask(t)} title="Complete" />
              <span className="dot" style={{ background: colorForSpace(t.space_id) }} />
              <span className="at">{t.title}</span>
              <span className="od">{daysBetween(t.due_date!, todayStr)}d overdue</span>
              <span className="acts">
                <button className="abtn" onClick={() => backlogTask(t)}>Backlog</button>
                <button className="abtn" onClick={() => snoozeTask(t)}>Snooze</button>
                <button className="abtn kill" onClick={() => killTask(t)}>Kill</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* FAB deferred — the global FastCapture + already occupies this corner;
          Home's 4-way quick-add (task/action/note/event) lands in the FAB
          follow-up, reconciled with FastCapture rather than stacked on it. */}

      <style>{`
        .home-deck{max-width:1640px;margin:0 auto;padding:8px 4px 90px;}
        .home-deck .label{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--nw-label);}
        .home-deck .muted{color:var(--navy-400);}
        .home-deck .dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;display:inline-block;}
        .home-deck .empty{color:var(--navy-400);font-size:13px;padding:14px 4px;}
        .home-deck .empty.sm{padding:8px 4px;font-size:12px;}

        .hd-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
        .hd-row h1{margin:0;font-family:var(--font-display);font-size:28px;font-weight:700;letter-spacing:-.02em;display:flex;align-items:baseline;gap:13px;color:var(--navy-50);}
        .hd-row h1 .sub{font-size:14.5px;font-weight:500;color:var(--navy-400);letter-spacing:0;}
        .wknav button{width:36px;height:36px;border-radius:50%;background:var(--navy-800);border:1px solid var(--navy-600);color:var(--navy-200);font-size:15px;cursor:pointer;margin-left:8px;}
        .wknav button.today{font-size:9px;color:var(--accent);}

        .quote{position:relative;margin:16px 0 20px;padding:6px 0 6px 22px;border-left:3px solid var(--line-2);display:flex;align-items:center;justify-content:space-between;gap:20px;}
        .quote .mark{position:absolute;left:9px;top:-8px;font-size:30px;color:var(--line-strong);font-family:Georgia,serif;}
        .quote .q{font-size:19px;font-style:italic;color:var(--nw-cream);font-family:Georgia,'Times New Roman',serif;}
        .quote .by{font-family:var(--font-mono);font-size:12px;letter-spacing:.02em;color:var(--navy-300);white-space:nowrap;}

        .ribhead{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;}
        .ribhead .cap{font-size:12px;color:var(--navy-400);}
        .ribhead .connect{font-size:12px;color:var(--accent);cursor:pointer;margin-left:auto;}
        .ribwrap{border:1px solid var(--line);border-radius:14px;background:var(--navy-900);overflow:hidden;margin-bottom:24px;box-shadow:var(--card-shadow);}
        .grid7{position:relative;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));}
        .day{border-right:1px solid var(--line);padding:12px 13px 16px;min-height:122px;display:flex;flex-direction:column;gap:6px;}
        .day:last-child{border-right:none;}
        .day.today{background:rgba(74,143,255,.06);}
        .dtop{display:flex;align-items:baseline;justify-content:space-between;}
        .dname{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--navy-400);}
        .day.today .dname{color:var(--accent);font-weight:700;}
        .dnum{font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:19px;font-weight:600;color:var(--navy-200);line-height:1;}
        .day.today .dnum{color:var(--accent);}
        .mtg{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--navy-200);}
        .mtg .mdot{width:6px;height:6px;border-radius:50%;background:var(--navy-500);flex-shrink:0;}
        .mtg .mt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .mtg .tm{font-family:var(--font-mono);color:var(--navy-400);font-variant-numeric:tabular-nums;flex-shrink:0;}
        .allday{font-size:11px;padding:3px 8px;border-radius:6px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .allday.ev{background:#1c2436;color:#9db8e8;}
        .allday.holiday{background:var(--nw-caution-bg,#251a08);color:var(--nw-caution-text,#f5b840);}
        .dmore{font-size:11px;color:var(--navy-400);padding:1px 0 0 2px;}

        .nowline{position:absolute;top:0;bottom:0;width:2px;background:#e8c060;box-shadow:0 0 8px rgba(232,192,96,.5);z-index:5;pointer-events:none;}
        .nowcap{position:absolute;top:0;left:50%;transform:translateX(-50%);background:#e8c060;color:#1a1406;font-family:var(--font-mono);font-size:9px;font-weight:700;letter-spacing:.1em;padding:2px 6px;border-radius:0 0 5px 5px;text-transform:uppercase;}
        .nowdot{position:absolute;top:-3px;left:50%;width:7px;height:7px;border-radius:50%;background:#e8c060;transform:translateX(-50%);box-shadow:0 0 8px rgba(232,192,96,.5);}

        .hd-body{display:grid;grid-template-columns:1fr 380px;gap:26px;align-items:start;}
        @media (max-width:1100px){.hd-body{grid-template-columns:1fr;}}

        .ka-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;}
        .kadone{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.1em;color:var(--navy-400);text-transform:uppercase;font-variant-numeric:tabular-nums;}
        .spgrp{margin-bottom:18px;}
        .sphead{display:flex;align-items:center;gap:9px;margin:0 0 8px 2px;font-size:13px;font-weight:700;color:var(--navy-100);}
        .sphead .cnt{font-family:var(--font-mono);color:var(--navy-400);font-weight:500;font-size:11px;}
        .act{display:flex;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:10px;box-shadow:var(--card-inset);}
        .bub{width:22px;height:22px;border-radius:50%;border:2px solid var(--line-strong);background:none;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#06140a;font-size:13px;font-weight:800;font-family:inherit;}
        .bub.done{background:var(--nw-nominal-text,#7fe27a);border-color:var(--nw-nominal-text,#7fe27a);}
        .atitle{flex:1;font-size:15px;color:var(--navy-100);}
        .act.is-done .atitle{color:var(--navy-500);text-decoration:line-through;}
        .status{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:6px;}
        .status.off{background:var(--nw-alarm-bg,#2e0a08);color:var(--nw-alarm-text,#ff6452);}
        .status.blocked{background:var(--nw-caution-bg,#251a08);color:var(--nw-caution-text,#f5b840);}
        .krpill{display:inline-flex;align-items:center;gap:8px;padding:6px 13px;border-radius:9px;font-size:13px;background:var(--surface-2);color:var(--navy-100);cursor:pointer;border:1px solid transparent;white-space:nowrap;max-width:240px;font-family:inherit;}
        .krpill:hover{border-color:var(--accent);}
        .krpill.on{border-color:var(--accent);background:var(--accent-dim);color:var(--navy-50);}
        .krpill .di{color:var(--navy-300);font-size:11px;}
        .krpill .kt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

        .card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:var(--card-shadow);}
        .card + .card{margin-top:18px;}
        .chead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;}
        .chead .n{font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--navy-300);font-weight:700;margin-left:6px;font-size:12px;}
        .link{color:var(--accent);font-size:12px;cursor:pointer;}
        .trow{display:flex;align-items:center;gap:11px;padding:8px 2px;}
        .trow .cb{width:20px;height:20px;border-radius:50%;border:2px solid var(--line-strong);background:none;flex-shrink:0;cursor:pointer;}
        .trow .tt{flex:1;font-size:14px;color:var(--navy-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .trow .tday{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--nw-caution-text,#f5b840);flex-shrink:0;}
        .more{text-align:center;margin-top:8px;}

        .hhead{display:grid;grid-template-columns:1fr repeat(7,22px);gap:7px;margin:2px 0 8px;}
        .hhead span{font-family:var(--font-mono);font-size:10px;color:var(--navy-500);text-align:center;}
        .habit{display:grid;grid-template-columns:1fr repeat(7,22px);gap:7px;align-items:center;padding:6px 0;}
        .habit .hn{font-size:13.5px;color:var(--navy-200);display:flex;align-items:center;gap:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .hc{width:22px;height:22px;border-radius:50%;border:2px solid var(--line-strong);background:none;cursor:pointer;padding:0;}
        .hc.hit{background:var(--nw-nominal-text,#7fe27a);border-color:var(--nw-nominal-text,#7fe27a);}
        .hc.today{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-bg);}

        .notes-empty{font-size:13px;color:var(--navy-400);line-height:1.55;padding:18px 6px;text-align:center;}
        .notes-empty .di,.note-ctx .di{color:var(--accent);}
        .note-ctx{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--navy-300);margin-bottom:8px;}
        .note{padding:8px;border-radius:8px;cursor:pointer;border:1px solid transparent;}
        .note:hover{background:var(--hover);border-color:var(--line);}
        .note .ntitle{font-size:13px;color:var(--navy-100);font-weight:600;}

        .attn{margin-top:30px;}
        .attn .ahead{display:flex;align-items:center;gap:11px;margin-bottom:12px;}
        .attn .ahead .cap{font-size:12px;color:var(--navy-400);}
        .arow{display:flex;align-items:center;gap:13px;padding:11px 16px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;box-shadow:var(--card-inset);}
        .arow .cb{width:20px;height:20px;border-radius:50%;border:2px solid var(--line-strong);background:none;flex-shrink:0;cursor:pointer;padding:0;}
        .arow .at{flex:1;font-size:14.5px;color:var(--navy-100);}
        .arow .od{font-family:var(--font-mono);font-size:10.5px;font-weight:600;color:var(--nw-alarm-text,#ff6452);white-space:nowrap;}
        .acts{display:flex;gap:7px;}
        .abtn{font-size:12px;padding:6px 12px;border-radius:7px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--navy-300);cursor:pointer;font-family:inherit;}
        .abtn:hover{background:var(--hover);color:var(--navy-100);}
        .abtn.kill{color:var(--navy-300);}
        .abtn.kill:hover{color:var(--nw-alarm-text,#ff6452);border-color:#3a1512;}
      `}</style>
    </div>
  )
}

function fmtMin(min: number): string {
  let h = Math.floor(min / 60); const m = min % 60
  const ap = h < 12 ? 'a' : 'p'; h = h % 12; if (h === 0) h = 12
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`
}
