'use client'
/**
 * Tasks v1 — desktop three-pane task manager.
 *
 *   ┌─ Sub-sidebar 220 ──┬─── Task list flex:1 ─┬─ Detail 340 ─┐
 *   │ smart views        │ Quick-add            │ Title        │
 *   │ spaces             │ Sections (Overdue,   │ Priority     │
 *   │ tags               │   Today, Tomorrow,   │ Due          │
 *   │                    │   This week, Later,  │ Recurrence   │
 *   │                    │   No date, Done)     │ Tags         │
 *   │                    │                      │ Description  │
 *   └────────────────────┴──────────────────────┴──────────────┘
 *
 * State is local to this component for v1. When the nav-rail badge or
 * global search needs to know about tasks, lift to page.tsx.
 *
 * The interesting bits: quick-add uses parseQuickAdd to extract date /
 * time / priority / recurrence / tags from a single typed line; the
 * checkbox handler routes recurring tasks through toggleComplete which
 * advances due_date in place rather than completing the row.
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Space, AnnualObjective, RoadmapItem, Task, TaskTag, TaskList, Priority } from '@/lib/types'
import * as tasksDb from '@/lib/db/tasks'
import * as taskListsDb from '@/lib/db/taskLists'
import {
  parseQuickAdd,
  parseRecurrence,
  todayISO,
  buildRecurrencePresets,
  snapDueDateToRule,
  recurrenceLabel,
  matchingPresetId,
  type RecurrencePreset,
  type RecurrencePresetId,
} from '@/lib/recurrence'

interface Props {
  spaces: Space[]
  activeSpaceId: string
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  toast: (msg: string) => void
}

type SmartView = 'today' | 'upcoming' | 'inbox' | 'all'
type ScopeFilter =
  | { kind: 'smart'; view: SmartView }
  | { kind: 'space'; spaceId: string }
  | { kind: 'list'; listId: string }
  | { kind: 'tag'; tag: string }

const PRIORITY_COLOR: Record<Priority, string> = {
  1: '#d12d2d',
  2: '#d4885a',
  3: '#5b8def',
  4: 'transparent',
}

const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'P1 · Urgent',
  2: 'P2 · High',
  3: 'P3 · Medium',
  4: 'P4 · None',
}

// ── Sidebar icons (match NavRail line-art family) ────────────────
function TodayIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.4"/><path d="M2 6h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="8" cy="10" r="1.4" fill="currentColor"/></svg>
}
function UpcomingIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4l4 4-4 4M8 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function InboxIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 9v4a1 1 0 001 1h10a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M2 9l1.4-5.4a1 1 0 011-.7h7.2a1 1 0 011 .7L14 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 9h3l1 1.5h4l1-1.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function AllOpenIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4.8 8c0-1.4-1-2.4-2.2-2.4S.5 6.6.5 8s1 2.4 2.2 2.4c1 0 1.6-.6 2.4-1.6.8-1 1.6-2.8 3.2-2.8 1.2 0 2.2 1 2.2 2.4s-1 2.4-2.2 2.4c-1 0-1.6-.6-2.4-1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function ListIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="2.5" cy="4" r="0.9" fill="currentColor"/><circle cx="2.5" cy="8" r="0.9" fill="currentColor"/><circle cx="2.5" cy="12" r="0.9" fill="currentColor"/></svg>
}
function HashIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 1.5L4.5 14.5M11.5 1.5L10 14.5M1.5 5h13M1.5 11h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
}

export default function Tasks({ spaces, activeSpaceId, roadmapItems, toast }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [lists, setLists] = useState<TaskList[]>([])
  const [tagsByTask, setTagsByTask] = useState<Map<string, string[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<ScopeFilter>({ kind: 'smart', view: 'today' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState('')
  const quickAddRef = useRef<HTMLInputElement>(null)
  // List sidebar UI state — kebab menu open for which list, inline rename, new-list input
  const [listMenuOpenId, setListMenuOpenId] = useState<string | null>(null)
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [renamingDraft, setRenamingDraft] = useState('')
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListDraft, setNewListDraft] = useState('')

  // Load all tasks + their tags + lists on mount.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [list, listRows] = await Promise.all([
          tasksDb.listAll(),
          taskListsDb.listAll(),
        ])
        if (cancelled) return
        setTasks(list)
        setLists(listRows)
        const tagRows = await tasksDb.listTagsForTasks(list.map(t => t.id))
        if (cancelled) return
        const map = new Map<string, string[]>()
        for (const row of tagRows) {
          const arr = map.get(row.task_id) ?? []
          arr.push(row.tag)
          map.set(row.task_id, arr)
        }
        setTagsByTask(map)
      } catch (e) {
        console.error('tasks load failed', e)
        toast('Failed to load tasks')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [toast])

  // Derived: all tags across all tasks (for the sidebar).
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const arr of tagsByTask.values()) for (const t of arr) set.add(t)
    return Array.from(set).sort()
  }, [tagsByTask])

  // Counts shown next to each sidebar entry. Reflect "what would the
  // user see if they clicked this" — same filter as the main view.
  const today = todayISO()
  const counts = useMemo(() => {
    const open = tasks.filter(t => !t.completed_at)
    return {
      today: open.filter(t => t.due_date && t.due_date <= today).length,
      upcoming: open.filter(t => t.due_date && t.due_date > today).length,
      inbox: open.filter(t => !t.due_date).length,
      all: open.length,
      bySpace: spaces.reduce<Record<string, number>>((acc, s) => {
        acc[s.id] = open.filter(t => t.space_id === s.id).length
        return acc
      }, {}),
      byList: lists.reduce<Record<string, number>>((acc, l) => {
        acc[l.id] = open.filter(t => t.list_id === l.id).length
        return acc
      }, {}),
      byTag: allTags.reduce<Record<string, number>>((acc, tag) => {
        acc[tag] = open.filter(t => (tagsByTask.get(t.id) ?? []).includes(tag)).length
        return acc
      }, {}),
    }
  }, [tasks, spaces, lists, allTags, tagsByTask, today])

  // Filtered list under the current scope. Order is: open first
  // (sorted by due-then-priority), then completed at the bottom.
  const filtered = useMemo(() => {
    let pool = tasks
    if (scope.kind === 'smart') {
      pool = pool.filter(t => !t.completed_at)
      if (scope.view === 'today')    pool = pool.filter(t => t.due_date && t.due_date <= today)
      if (scope.view === 'upcoming') pool = pool.filter(t => t.due_date && t.due_date > today)
      if (scope.view === 'inbox')    pool = pool.filter(t => !t.due_date)
      // 'all' = no further filter
    } else if (scope.kind === 'space') {
      pool = pool.filter(t => t.space_id === scope.spaceId)
    } else if (scope.kind === 'list') {
      pool = pool.filter(t => t.list_id === scope.listId)
    } else if (scope.kind === 'tag') {
      const tag = scope.tag
      pool = pool.filter(t => (tagsByTask.get(t.id) ?? []).includes(tag))
    }
    return pool.sort((a, b) => {
      // Completed at the end
      if (!!a.completed_at !== !!b.completed_at) return a.completed_at ? 1 : -1
      // Then by due_date (nulls last)
      if (a.due_date !== b.due_date) {
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date < b.due_date ? -1 : 1
      }
      // Then by priority (1 first)
      if (a.priority !== b.priority) return a.priority - b.priority
      return a.created_at < b.created_at ? -1 : 1
    })
  }, [tasks, scope, tagsByTask, today])

  // Section the filtered list by due bucket. Sections render in this
  // fixed order. We compute the buckets up-front to keep the JSX flat.
  const sections = useMemo(() => {
    const overdue: Task[] = []
    const todayBucket: Task[] = []
    const tomorrowBucket: Task[] = []
    const thisWeek: Task[] = []
    const later: Task[] = []
    const noDate: Task[] = []
    const done: Task[] = []
    const tomorrow = isoAddDays(today, 1)
    const weekEnd = isoAddDays(today, 7)

    for (const t of filtered) {
      if (t.completed_at) { done.push(t); continue }
      if (!t.due_date)    { noDate.push(t); continue }
      if (t.due_date < today)             overdue.push(t)
      else if (t.due_date === today)      todayBucket.push(t)
      else if (t.due_date === tomorrow)   tomorrowBucket.push(t)
      else if (t.due_date <= weekEnd)     thisWeek.push(t)
      else                                later.push(t)
    }
    return [
      { name: 'Overdue',   tasks: overdue,        accent: 'var(--red-text)' },
      { name: 'Today',     tasks: todayBucket,    accent: 'var(--accent)' },
      { name: 'Tomorrow',  tasks: tomorrowBucket, accent: undefined },
      { name: 'This week', tasks: thisWeek,       accent: undefined },
      { name: 'Later',     tasks: later,          accent: undefined },
      { name: 'No date',   tasks: noDate,         accent: undefined },
      { name: 'Done',      tasks: done,           accent: 'var(--navy-400)' },
    ].filter(s => s.tasks.length > 0)
  }, [filtered, today])

  const selected = useMemo(
    () => selectedId ? tasks.find(t => t.id === selectedId) ?? null : null,
    [tasks, selectedId]
  )

  // ── Mutations ────────────────────────────────────────────────────

  const onQuickAdd = useCallback(async () => {
    const raw = quickAdd.trim()
    if (!raw) return
    const parsed = parseQuickAdd(raw)
    if (!parsed.title) { toast('Need a title'); return }
    // Pick the target container: if scope is a list, target that list;
    // if scope is a specific space, target that space; otherwise fall
    // back to activeSpaceId (the rail's selected space).
    let targetSpaceId: string | null = null
    let targetListId: string | null = null
    if (scope.kind === 'list') {
      targetListId = scope.listId
    } else if (scope.kind === 'space') {
      targetSpaceId = scope.spaceId
    } else {
      targetSpaceId = activeSpaceId
    }
    if (!targetSpaceId && !targetListId) { toast('Pick a space or list first'); return }
    try {
      const created = await tasksDb.create({
        space_id: targetSpaceId,
        list_id: targetListId,
        title: parsed.title,
        priority: parsed.priority,
        due_date: parsed.due_date,
        due_time: parsed.due_time,
        recurrence_text: parsed.recurrence_text,
        recurrence_rule: parsed.recurrence_rule,
      })
      if (parsed.tags && parsed.tags.length > 0) {
        await tasksDb.setTags(created.id, parsed.tags)
        setTagsByTask(prev => {
          const next = new Map(prev)
          next.set(created.id, parsed.tags!)
          return next
        })
      }
      setTasks(prev => [...prev, created])
      setQuickAdd('')
      // If the scope is "Inbox" but the new task has a date, switch to
      // Today so the user sees what they just created. Otherwise leave
      // the scope alone.
      if (scope.kind === 'smart' && scope.view === 'inbox' && parsed.due_date) {
        setScope({ kind: 'smart', view: 'today' })
      }
    } catch (e) {
      console.error('quick add failed', e)
      toast('Could not create task')
    }
  }, [quickAdd, scope, activeSpaceId, toast])

  const onToggle = useCallback(async (task: Task) => {
    try {
      const updated = await tasksDb.toggleComplete(task)
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    } catch (e) {
      console.error('toggle failed', e)
      toast('Could not update task')
    }
  }, [toast])

  const onPatch = useCallback(async (id: string, patch: Partial<Task>) => {
    try {
      const updated = await tasksDb.update(id, patch)
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    } catch (e) {
      console.error('patch failed', e)
      toast('Could not update task')
    }
  }, [toast])

  const onDelete = useCallback(async (id: string) => {
    try {
      await tasksDb.remove(id)
      setTasks(prev => prev.filter(t => t.id !== id))
      setTagsByTask(prev => { const next = new Map(prev); next.delete(id); return next })
      if (selectedId === id) setSelectedId(null)
    } catch (e) {
      console.error('delete failed', e)
      toast('Could not delete task')
    }
  }, [toast, selectedId])

  const onSetTags = useCallback(async (id: string, tags: string[]) => {
    try {
      await tasksDb.setTags(id, tags)
      setTagsByTask(prev => {
        const next = new Map(prev)
        if (tags.length === 0) next.delete(id)
        else next.set(id, tags)
        return next
      })
    } catch (e) {
      console.error('set tags failed', e)
      toast('Could not update tags')
    }
  }, [toast])

  // ── List mutations ───────────────────────────────────────────────

  const onCreateList = useCallback(async (name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const created = await taskListsDb.create({
        name: clean,
        sort_order: lists.length,
      })
      setLists(prev => [...prev, created])
      // Jump scope to the newly created list so the user lands ready to add tasks
      setScope({ kind: 'list', listId: created.id })
      setSelectedId(null)
    } catch (e) {
      console.error('create list failed', e)
      toast('Could not create list')
    }
  }, [lists.length, toast])

  const onRenameList = useCallback(async (id: string, name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const updated = await taskListsDb.rename(id, clean)
      setLists(prev => prev.map(l => l.id === id ? updated : l))
    } catch (e) {
      console.error('rename list failed', e)
      toast('Could not rename list')
    }
  }, [toast])

  const onDeleteList = useCallback(async (id: string) => {
    try {
      await taskListsDb.remove(id)
      // ON DELETE CASCADE removes the tasks too; mirror that locally.
      setLists(prev => prev.filter(l => l.id !== id))
      setTasks(prev => prev.filter(t => t.list_id !== id))
      if (scope.kind === 'list' && scope.listId === id) {
        setScope({ kind: 'smart', view: 'today' })
      }
      setSelectedId(null)
    } catch (e) {
      console.error('delete list failed', e)
      toast('Could not delete list')
    }
  }, [scope, toast])

  // ── Rendering ────────────────────────────────────────────────────

  const heading = useMemo(() => {
    if (scope.kind === 'smart') {
      return { title: scope.view === 'today' ? 'Today'
                    : scope.view === 'upcoming' ? 'Upcoming'
                    : scope.view === 'inbox' ? 'Inbox'
                    : 'All tasks',
               subtitle: scope.view === 'today' ? formatLongDate(today) : '' }
    }
    if (scope.kind === 'space') {
      const space = spaces.find(s => s.id === scope.spaceId)
      return { title: space?.name ?? 'Space', subtitle: '' }
    }
    if (scope.kind === 'list') {
      const list = lists.find(l => l.id === scope.listId)
      return { title: list?.name ?? 'List', subtitle: '' }
    }
    return { title: `#${scope.tag}`, subtitle: '' }
  }, [scope, spaces, lists, today])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--navy-400)', fontSize: 13 }}>
        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
        <span style={{ marginLeft: 10 }}>Loading tasks…</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `220px 1fr ${selected ? '340px' : '0'}`, height: 'calc(100vh - 0px)' }}>
      {/* ── Sub-sidebar ── */}
      <aside style={{ background: 'var(--navy-800)', borderRight: '1px solid var(--navy-600)', overflowY: 'auto' }}>
        <SidebarSection label="Smart views">
          <SidebarRow icon={<TodayIcon />}    label="Today"    count={counts.today}    active={scope.kind === 'smart' && scope.view === 'today'}    onClick={() => { setScope({ kind: 'smart', view: 'today' });    setSelectedId(null) }} />
          <SidebarRow icon={<UpcomingIcon />} label="Upcoming" count={counts.upcoming} active={scope.kind === 'smart' && scope.view === 'upcoming'} onClick={() => { setScope({ kind: 'smart', view: 'upcoming' }); setSelectedId(null) }} />
          <SidebarRow icon={<InboxIcon />}    label="Inbox"    count={counts.inbox}    active={scope.kind === 'smart' && scope.view === 'inbox'}    onClick={() => { setScope({ kind: 'smart', view: 'inbox' });    setSelectedId(null) }} />
          <SidebarRow icon={<AllOpenIcon />}  label="All open" count={counts.all}      active={scope.kind === 'smart' && scope.view === 'all'}      onClick={() => { setScope({ kind: 'smart', view: 'all' });      setSelectedId(null) }} />
        </SidebarSection>

        {spaces.length > 0 && (
          <SidebarSection label="Spaces">
            {spaces.map(s => (
              <SidebarRow key={s.id}
                dot={s.color}
                label={s.name}
                count={counts.bySpace[s.id] ?? 0}
                active={scope.kind === 'space' && scope.spaceId === s.id}
                onClick={() => { setScope({ kind: 'space', spaceId: s.id }); setSelectedId(null) }} />
            ))}
          </SidebarSection>
        )}

        <SidebarSection label="Lists">
          {lists.map(l => (
            <ListSidebarRow key={l.id}
              list={l}
              count={counts.byList[l.id] ?? 0}
              active={scope.kind === 'list' && scope.listId === l.id}
              menuOpen={listMenuOpenId === l.id}
              renaming={renamingListId === l.id}
              renameDraft={renamingDraft}
              setRenameDraft={setRenamingDraft}
              onClick={() => { setScope({ kind: 'list', listId: l.id }); setSelectedId(null) }}
              onOpenMenu={() => setListMenuOpenId(l.id)}
              onCloseMenu={() => setListMenuOpenId(null)}
              onStartRename={() => { setRenamingListId(l.id); setRenamingDraft(l.name); setListMenuOpenId(null) }}
              onCommitRename={() => {
                if (renamingDraft.trim() && renamingDraft.trim() !== l.name) onRenameList(l.id, renamingDraft)
                setRenamingListId(null)
              }}
              onCancelRename={() => setRenamingListId(null)}
              onDelete={() => {
                if (confirm(`Delete list "${l.name}" and all its tasks? This can't be undone.`)) {
                  onDeleteList(l.id)
                }
                setListMenuOpenId(null)
              }} />
          ))}
          {newListOpen ? (
            <input autoFocus
              value={newListDraft}
              onChange={e => setNewListDraft(e.target.value)}
              onBlur={() => {
                if (newListDraft.trim()) onCreateList(newListDraft)
                setNewListOpen(false)
                setNewListDraft('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { setNewListOpen(false); setNewListDraft('') }
              }}
              placeholder="List name…"
              style={{
                width: 'calc(100% - 12px)', margin: '0 6px',
                padding: '7px 12px', background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
                borderRadius: 6, color: 'var(--navy-50)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
              }} />
          ) : (
            <button onClick={() => { setNewListOpen(true); setNewListDraft('') }}
              style={{
                width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                background: 'none', color: 'var(--navy-400)', fontSize: 13.5, fontFamily: 'inherit', textAlign: 'left',
                transition: 'background .15s, color .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-600)'; e.currentTarget.style.color = 'var(--navy-100)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--navy-400)' }}>
              <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.85 }}><PlusIcon /></span>
              <span>New list</span>
            </button>
          )}
        </SidebarSection>

        {allTags.length > 0 && (
          <SidebarSection label="Tags">
            {allTags.map(tag => (
              <SidebarRow key={tag}
                icon={<HashIcon />}
                label={tag}
                count={counts.byTag[tag] ?? 0}
                active={scope.kind === 'tag' && scope.tag === tag}
                onClick={() => { setScope({ kind: 'tag', tag }); setSelectedId(null) }} />
            ))}
          </SidebarSection>
        )}
      </aside>

      {/* ── Main task list ── */}
      <main style={{ overflowY: 'auto', padding: '20px 24px 60px' }}>
        <header style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--navy-50)' }}>{heading.title}</h1>
          {heading.subtitle && <div style={{ fontSize: 13, color: 'var(--navy-300)', marginTop: 2 }}>{heading.subtitle}</div>}
        </header>

        {sections.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--navy-300)', fontSize: 13 }}>
            Nothing here. {scope.kind === 'smart' && scope.view === 'today' && 'Enjoy your day.'}
          </div>
        )}

        {sections.map(section => (
          <section key={section.name} style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: section.accent ?? 'var(--navy-300)', letterSpacing: '0.04em', textTransform: 'uppercase', margin: '0 0 8px', padding: '0 12px' }}>
              {section.name} · {section.tasks.length}
            </h2>
            {section.tasks.map(task => (
              <TaskRow key={task.id} task={task}
                tags={tagsByTask.get(task.id) ?? []}
                space={spaces.find(s => s.id === task.space_id)}
                list={lists.find(l => l.id === task.list_id)}
                selected={selectedId === task.id}
                onToggle={() => onToggle(task)}
                onClick={() => setSelectedId(task.id)} />
            ))}
          </section>
        ))}

        {/* Quick-add — sits at the bottom of the list, after all sections */}
        <form onSubmit={e => { e.preventDefault(); onQuickAdd() }} style={{ marginTop: 18 }}>
          <input ref={quickAddRef}
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            placeholder='+ Add task… try "review deck tomorrow 3pm #stellar p1"'
            style={{
              width: '100%', padding: '10px 14px',
              background: 'var(--navy-800)', border: '1px dashed var(--navy-500)', borderRadius: 8,
              color: 'var(--navy-100)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
              transition: 'border-color .15s',
            }}
            onFocus={e => { e.currentTarget.style.borderStyle = 'solid'; e.currentTarget.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.currentTarget.style.borderStyle = 'dashed'; e.currentTarget.style.borderColor = 'var(--navy-500)' }} />
        </form>
      </main>

      {/* ── Detail panel ── */}
      {selected && (
        <DetailPanel task={selected}
          tags={tagsByTask.get(selected.id) ?? []}
          spaces={spaces}
          lists={lists}
          roadmapItems={roadmapItems}
          onPatch={patch => onPatch(selected.id, patch)}
          onSetTags={tags => onSetTags(selected.id, tags)}
          onDelete={() => onDelete(selected.id)}
          onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: '14px 18px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--navy-300)' }}>{label}</div>
      {children}
    </div>
  )
}

function SidebarRow({ icon, dot, label, count, active, onClick }: { icon?: React.ReactNode; dot?: string; label: string; count?: number; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
        background: active ? 'var(--accent-dim)' : 'none',
        color: active ? 'var(--accent)' : 'var(--navy-100)',
        fontSize: 13.5, fontWeight: active ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
        transition: 'background .15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--navy-600)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}>
      {icon && <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.85 }}>{icon}</span>}
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0, margin: '0 5px' }} />}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count != null && count > 0 && (
        <span style={{
          fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 99, lineHeight: 1.4,
          background: active ? 'var(--accent)' : 'var(--navy-600)',
          color: active ? '#fff' : 'var(--navy-300)',
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

function ListSidebarRow(props: {
  list: TaskList
  count: number
  active: boolean
  menuOpen: boolean
  renaming: boolean
  renameDraft: string
  setRenameDraft: (v: string) => void
  onClick: () => void
  onOpenMenu: () => void
  onCloseMenu: () => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onDelete: () => void
}) {
  const { list, count, active, menuOpen, renaming } = props
  const [hover, setHover] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Close kebab menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) props.onCloseMenu()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (renaming) {
    return (
      <input autoFocus
        value={props.renameDraft}
        onChange={e => props.setRenameDraft(e.target.value)}
        onBlur={props.onCommitRename}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') props.onCancelRename()
        }}
        style={{
          width: 'calc(100% - 12px)', margin: '0 6px',
          padding: '7px 12px', background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
          borderRadius: 6, color: 'var(--navy-50)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none',
        }} />
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button onClick={props.onClick}
        style={{
          width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 10,
          padding: '7px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
          background: active ? 'var(--accent-dim)' : (hover ? 'var(--navy-600)' : 'none'),
          color: active ? 'var(--accent)' : 'var(--navy-100)',
          fontSize: 13.5, fontWeight: active ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
          transition: 'background .15s',
        }}>
        <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: 0.85 }}><ListIcon /></span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>
        {!hover && count > 0 && (
          <span style={{
            fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 99, lineHeight: 1.4,
            background: active ? 'var(--accent)' : 'var(--navy-600)',
            color: active ? '#fff' : 'var(--navy-300)',
          }}>
            {count}
          </span>
        )}
      </button>
      {hover && (
        <button onClick={e => { e.stopPropagation(); props.onOpenMenu() }}
          style={{
            position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)',
            background: 'none', border: 'none', padding: '2px 4px', borderRadius: 3,
            color: 'var(--navy-300)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-600)'; e.currentTarget.style.color = 'var(--navy-50)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--navy-300)' }}>
          ⋯
        </button>
      )}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: '100%', right: 6, zIndex: 30, marginTop: 2,
          background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 6,
          padding: 4, minWidth: 130, boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}>
          <button onClick={props.onStartRename}
            style={menuItemStyle}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Rename
          </button>
          <button onClick={props.onDelete}
            style={{ ...menuItemStyle, color: 'var(--red-text)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
  padding: '6px 10px', fontSize: 12, color: 'var(--navy-100)', cursor: 'pointer',
  borderRadius: 4, fontFamily: 'inherit',
}

function TaskRow({ task, tags, space, list, selected, onToggle, onClick }: {
  task: Task; tags: string[]; space?: Space; list?: TaskList; selected: boolean; onToggle: () => void; onClick: () => void
}) {
  const done = !!task.completed_at
  return (
    <button onClick={onClick}
      style={{
        width: '100%', display: 'grid', gridTemplateColumns: '22px 10px 1fr auto auto', gap: 10, alignItems: 'center',
        padding: '8px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
        background: selected ? 'var(--accent-dim)' : 'none', textAlign: 'left',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--navy-800)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'none' }}>
      <span onClick={e => { e.stopPropagation(); onToggle() }}
        style={{
          width: 17, height: 17, borderRadius: '50%',
          border: `1.5px solid ${done ? 'var(--teal-text)' : 'var(--navy-400)'}`,
          background: done ? 'var(--teal-text)' : 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 10, transition: 'all .15s',
        }}>
        {done && '✓'}
      </span>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: task.priority < 4 ? PRIORITY_COLOR[task.priority] : 'transparent' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, color: done ? 'var(--navy-400)' : 'var(--navy-50)', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title}
        </span>
        {(space || list || tags.length > 0 || task.recurrence_text) && (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {space && <span style={{ fontSize: 10.5, color: 'var(--navy-300)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: space.color }} />{space.name}
            </span>}
            {list && <span style={{ fontSize: 10.5, color: 'var(--navy-300)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, textAlign: 'center', opacity: 0.7 }}>☰</span>{list.name}
            </span>}
            {tags.map(tag => <span key={tag} style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--indigo-bg)', color: 'var(--indigo-text)' }}>#{tag}</span>)}
            {task.recurrence_text && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--slate-bg)', color: 'var(--slate-text)' }}>↻ {task.recurrence_text}</span>}
          </span>
        )}
      </div>
      <span style={{ fontSize: 11, color: dueColor(task.due_date), fontWeight: 500 }}>
        {formatDue(task.due_date, task.due_time)}
      </span>
    </button>
  )
}

function DetailPanel({ task, tags, spaces, lists, roadmapItems, onPatch, onSetTags, onDelete, onClose }: {
  task: Task; tags: string[]; spaces: Space[]; lists: TaskList[]; roadmapItems: RoadmapItem[];
  onPatch: (patch: Partial<Task>) => void;
  onSetTags: (tags: string[]) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title)
  const [desc, setDesc] = useState(task.description ?? '')
  const [tagInput, setTagInput] = useState('')
  const [recurrenceInput, setRecurrenceInput] = useState(task.recurrence_text ?? '')
  const [recurrenceError, setRecurrenceError] = useState<string | null>(null)
  const [recMenuOpen, setRecMenuOpen] = useState(false)
  const [recCustomOpen, setRecCustomOpen] = useState(false)
  const recMenuRef = useRef<HTMLDivElement | null>(null)
  // Keep local state in sync when the selected task changes
  useEffect(() => {
    setTitle(task.title)
    setDesc(task.description ?? '')
    setRecurrenceInput(task.recurrence_text ?? '')
    setRecurrenceError(null)
    setRecMenuOpen(false)
    setRecCustomOpen(false)
  }, [task.id])
  // Close the recurrence menu on outside click
  useEffect(() => {
    if (!recMenuOpen) return
    function onDocClick(e: MouseEvent) {
      if (recMenuRef.current && !recMenuRef.current.contains(e.target as Node)) {
        setRecMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [recMenuOpen])

  // Today (anchor for presets) — read once per render. Cheap.
  const todayAnchor = todayISO()
  const presets = useMemo(() => buildRecurrencePresets(todayAnchor), [todayAnchor])
  const activePresetId: RecurrencePresetId | null =
    task.recurrence_rule ? matchingPresetId(task.recurrence_rule, todayAnchor) : null
  const triggerLabel = task.recurrence_rule
    ? recurrenceLabel(task.recurrence_rule, task.due_date)
    : 'One-shot'

  const list = lists.find(l => l.id === task.list_id)
  const linkedKR = task.roadmap_item_id ? roadmapItems.find(r => r.id === task.roadmap_item_id) : null
  const containerValue = task.space_id ? `s:${task.space_id}` : (task.list_id ? `l:${task.list_id}` : '')

  function onChangeContainer(value: string) {
    const [kind, id] = value.split(':')
    if (kind === 's') {
      onPatch({ space_id: id, list_id: null })
    } else if (kind === 'l') {
      // List-tasks can't link to a KR (DB CHECK constraint), so clear it on move.
      onPatch({ space_id: null, list_id: id, roadmap_item_id: null })
    }
  }

  function commitTitle() {
    if (title.trim() && title !== task.title) onPatch({ title: title.trim() })
  }
  function commitDesc() {
    const v = desc.trim() || null
    if (v !== task.description) onPatch({ description: v })
  }
  function commitRecurrence() {
    const trimmed = recurrenceInput.trim()
    setRecurrenceError(null)
    if (!trimmed) {
      if (task.recurrence_text) onPatch({ recurrence_text: null, recurrence_rule: null })
      return
    }
    if (trimmed === task.recurrence_text) return
    const parsed = parseRecurrence(trimmed)
    if (!parsed) {
      setRecurrenceError("Couldn't parse — try 'every monday', 'daily', 'every 2 weeks'")
      return
    }
    // DB CHECK constraint: recurring task must have a due_date.
    // If none set, default to today so the row is valid.
    const patch: Partial<Task> = {
      recurrence_text: parsed.text,
      recurrence_rule: parsed.rule,
    }
    if (!task.due_date) patch.due_date = todayISO()
    onPatch(patch)
    setRecurrenceInput(parsed.text) // normalize displayed text
  }
  function applyPreset(preset: RecurrencePreset) {
    const newDue = snapDueDateToRule(task.due_date, preset.rule, todayAnchor)
    const patch: Partial<Task> = {
      recurrence_text: preset.text,
      recurrence_rule: preset.rule,
    }
    if (newDue !== task.due_date) patch.due_date = newDue
    onPatch(patch)
    setRecurrenceInput(preset.text)
    setRecurrenceError(null)
    setRecMenuOpen(false)
    setRecCustomOpen(false)
  }
  function clearRecurrence() {
    onPatch({ recurrence_text: null, recurrence_rule: null })
    setRecurrenceInput('')
    setRecurrenceError(null)
    setRecMenuOpen(false)
    setRecCustomOpen(false)
  }
  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/^#/, '')
    if (!t) return
    if (tags.includes(t)) { setTagInput(''); return }
    onSetTags([...tags, t])
    setTagInput('')
  }
  function removeTag(t: string) {
    onSetTags(tags.filter(x => x !== t))
  }

  return (
    <aside style={{ background: 'var(--navy-800)', borderLeft: '1px solid var(--navy-600)', overflowY: 'auto', padding: '20px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--navy-300)' }}>Task detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--navy-400)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <textarea value={title} onChange={e => setTitle(e.target.value)} onBlur={commitTitle}
        rows={2}
        style={{ width: '100%', padding: 10, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 6, color: 'var(--navy-50)', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', resize: 'vertical', outline: 'none', marginBottom: 14 }} />

      <Field label="Priority">
        <select value={task.priority} onChange={e => onPatch({ priority: parseInt(e.target.value, 10) as Priority })}
          style={selectStyle}>
          <option value={1}>P1 · Urgent</option>
          <option value={2}>P2 · High</option>
          <option value={3}>P3 · Medium</option>
          <option value={4}>P4 · None</option>
        </select>
      </Field>

      <Field label="Due date">
        <input type="date" value={task.due_date ?? ''} onChange={e => onPatch({ due_date: e.target.value || null })} style={inputStyle} />
      </Field>

      <Field label="Time">
        <input type="time" value={task.due_time?.slice(0, 5) ?? ''} onChange={e => onPatch({ due_time: e.target.value ? `${e.target.value}:00` : null })} style={inputStyle} />
      </Field>

      {/* Recurrence — trigger button opens a preset dropdown; Custom… reveals freeform input */}
      <div ref={recMenuRef} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--navy-700)', fontSize: 12, position: 'relative' }}>
        <span style={{ color: 'var(--navy-300)' }}>Recurrence</span>
        <button onClick={() => setRecMenuOpen(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 5,
            color: task.recurrence_rule ? 'var(--navy-50)' : 'var(--navy-400)',
            fontSize: 12, padding: '4px 8px', fontFamily: 'inherit', cursor: 'pointer',
          }}>
          {triggerLabel}
          <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>▾</span>
        </button>

        {recMenuOpen && (
          <div style={{
            position: 'absolute', right: 0, top: 'calc(100% - 4px)', zIndex: 20,
            width: 230, background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
            borderRadius: 6, padding: 4, boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}>
            {presets.map(p => {
              const isActive = activePresetId === p.id
              return (
                <button key={p.id} onClick={() => applyPreset(p)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    padding: '7px 10px', fontSize: 12, color: 'var(--navy-50)',
                    cursor: 'pointer', borderRadius: 4, fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                  <span>
                    {p.label}
                    {p.sublabel && <span style={{ color: 'var(--navy-400)', marginLeft: 4 }}>{p.sublabel}</span>}
                  </span>
                  {isActive && <span style={{ color: 'var(--accent)', fontSize: 11 }}>✓</span>}
                </button>
              )
            })}
            <div style={{ height: 1, background: 'var(--navy-700)', margin: '4px 6px' }} />
            <button onClick={() => { setRecCustomOpen(true); setRecMenuOpen(false); setRecurrenceInput(task.recurrence_text ?? '') }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
                padding: '7px 10px', fontSize: 12, color: 'var(--navy-50)', cursor: 'pointer',
                borderRadius: 4, fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
              Custom…
            </button>
            {task.recurrence_rule && (
              <button onClick={clearRecurrence}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
                  padding: '7px 10px', fontSize: 12, color: 'var(--navy-300)', cursor: 'pointer',
                  borderRadius: 4, fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-700)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}>
                Clear recurrence
              </button>
            )}
          </div>
        )}
      </div>

      {recCustomOpen && (
        <div style={{ marginTop: 6, marginBottom: 6 }}>
          <input
            autoFocus
            value={recurrenceInput}
            onChange={e => setRecurrenceInput(e.target.value)}
            onBlur={commitRecurrence}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
            placeholder="every monday, daily, every 2 weeks…"
            style={{ ...inputStyle, fontSize: 12, width: '100%' }} />
          <div style={{ fontSize: 10.5, color: 'var(--navy-400)', marginTop: 4, paddingLeft: 2 }}>Press Enter to apply</div>
        </div>
      )}
      {recurrenceError && (
        <div style={{ fontSize: 10.5, color: 'var(--red-text)', marginTop: -4, marginBottom: 8, paddingLeft: 2 }}>
          {recurrenceError}
        </div>
      )}

      <Field label={list ? 'List' : 'Space'}>
        <select value={containerValue} onChange={e => onChangeContainer(e.target.value)} style={selectStyle}>
          {spaces.length > 0 && (
            <optgroup label="Spaces">
              {spaces.map(s => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}
            </optgroup>
          )}
          {lists.length > 0 && (
            <optgroup label="Lists">
              {lists.map(l => <option key={l.id} value={`l:${l.id}`}>{l.name}</option>)}
            </optgroup>
          )}
        </select>
      </Field>

      {linkedKR && !list && (
        <Field label="Linked KR">
          <span style={{ fontSize: 12, color: 'var(--accent)' }}>{linkedKR.title}</span>
        </Field>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--navy-300)', marginBottom: 6 }}>Tags</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
          {tags.map(t => (
            <span key={t} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--indigo-bg)', color: 'var(--indigo-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              #{t}
              <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
        <input value={tagInput} onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          placeholder="Add tag…"
          style={{ ...inputStyle, fontSize: 11.5 }} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--navy-300)', marginBottom: 6 }}>Description</div>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={commitDesc}
          rows={4}
          style={{ width: '100%', padding: 8, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 5, color: 'var(--navy-100)', fontSize: 12, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
      </div>

      <button onClick={() => { if (confirm('Delete this task?')) onDelete() }}
        style={{ width: '100%', padding: '8px 12px', background: 'none', border: '1px solid var(--red-text)', borderRadius: 6, color: 'var(--red-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
        Delete task
      </button>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--navy-700)', fontSize: 12 }}>
      <span style={{ color: 'var(--navy-300)' }}>{label}</span>
      <span>{children}</span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 5,
  color: 'var(--navy-100)', fontSize: 12, padding: '4px 8px', fontFamily: 'inherit',
}

const selectStyle: React.CSSProperties = { ...inputStyle }

// ── Helpers ───────────────────────────────────────────────────────

function isoAddDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + n)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatDue(iso: string | null, time: string | null): string {
  if (!iso) return ''
  const today = todayISO()
  const tomorrow = isoAddDays(today, 1)
  const yesterday = isoAddDays(today, -1)
  let label: string
  if (iso === today) label = 'Today'
  else if (iso === tomorrow) label = 'Tomorrow'
  else if (iso === yesterday) label = 'Yesterday'
  else if (iso < today) {
    const days = Math.round((Date.parse(today) - Date.parse(iso)) / 86400000)
    label = `${days}d late`
  } else {
    const [y, m, d] = iso.split('-').map(Number)
    label = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  if (time) {
    const [h, mi] = time.split(':').map(Number)
    const ampm = h >= 12 ? 'pm' : 'am'
    const h12 = h % 12 || 12
    label += ` ${h12}${mi ? ':' + String(mi).padStart(2, '0') : ''}${ampm}`
  }
  return label
}

function dueColor(iso: string | null): string {
  if (!iso) return 'var(--navy-400)'
  const today = todayISO()
  if (iso < today) return 'var(--red-text)'
  if (iso === today) return 'var(--accent)'
  return 'var(--navy-300)'
}
