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
import { Space, AnnualObjective, RoadmapItem, Task, TaskTag, TaskList, TaskSection, Priority } from '@/lib/types'
import * as tasksDb from '@/lib/db/tasks'
import * as taskListsDb from '@/lib/db/taskLists'
import * as taskSectionsDb from '@/lib/db/taskSections'
import { getActiveKRs } from '@/lib/krFilters'
import { formatMinutes } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
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
  // Tasks state lifted to page.tsx (May 18) so the NavRail badge and global
  // search can read it. This component owns the editing UI but not the data.
  tasks: Task[]
  setTasks: (fn: (prev: Task[]) => Task[]) => void
  lists: TaskList[]
  setLists: (fn: (prev: TaskList[]) => TaskList[]) => void
  sections: TaskSection[]
  setSections: (fn: (prev: TaskSection[]) => TaskSection[]) => void
  tagsByTask: Map<string, string[]>
  setTagsByTask: (fn: (prev: Map<string, string[]>) => Map<string, string[]>) => void
  /** Task to focus when entering — set by cross-app jump from Tags page. */
  initialTaskId?: string | null
  /** Called once the initial selection has been consumed. */
  onConsumeInitialTaskId?: () => void
  /** Called when the user clicks a tag chip on a row — jumps to Tags page. */
  onJumpToTag?: (tag: string) => void
  toast: (msg: string) => void
}

type SmartView = 'today' | 'upcoming' | 'inbox' | 'recurring' | 'all'
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
function RecurringIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 7a5.5 5.5 0 0 0-10.4-1.5M2.5 9a5.5 5.5 0 0 0 10.4 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M11.5 2.5v3h3M4.5 13.5v-3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
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

export default function Tasks({ spaces, activeSpaceId, objectives, roadmapItems, tasks, setTasks, lists, setLists, sections, setSections, tagsByTask, setTagsByTask, initialTaskId, onConsumeInitialTaskId, onJumpToTag, toast }: Props) {
  // Data lifecycle (load + tags) is owned by page.tsx as of May 18. This
  // component receives tasks/lists/tagsByTask via props and pushes mutations
  // through the corresponding setters. Eliminating the local load avoids a
  // double-fetch and keeps the NavRail badge consistent with what's rendered.
  const [scope, setScope] = useState<ScopeFilter>({ kind: 'smart', view: 'today' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [quickAdd, setQuickAdd] = useState('')
  // Mobile fallback (May 17): below 900px the sub-sidebar is replaced by a
  // dropdown opener button. mobileSubOpen toggles a slide-down panel that
  // reuses the same sub-sidebar markup. Detail panel switches from a side
  // pane to a full-screen overlay so the main list can take full width.
  const isMobile = useIsMobile(900)
  const [mobileSubOpen, setMobileSubOpen] = useState(false)

  // Done-section reveal toggle (May 18). In space/list/tag scopes, completed
  // tasks pile up in a "Done" section and add visual noise. Default to
  // hidden, persist the preference across sessions via localStorage so the
  // user gets the same silence each time they reopen Tasks. Smart views
  // already filter completed out upstream, so this toggle is only meaningful
  // in non-smart scopes.
  const [showDone, setShowDone] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem('tasks-show-done')
      if (saved === '1') setShowDone(true)
    } catch { /* noop */ }
  }, [])
  const toggleShowDone = useCallback(() => {
    setShowDone(prev => {
      const next = !prev
      try { localStorage.setItem('tasks-show-done', next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }, [])
  const quickAddRef = useRef<HTMLInputElement>(null)
  // List sidebar UI state — kebab menu open for which list, inline rename, new-list input
  const [listMenuOpenId, setListMenuOpenId] = useState<string | null>(null)
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [renamingDraft, setRenamingDraft] = useState('')
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListDraft, setNewListDraft] = useState('')
  // Section UI state (list scope only)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [newSectionOpen, setNewSectionOpen] = useState(false)
  const [newSectionDraft, setNewSectionDraft] = useState('')
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null)
  const [sectionRenameDraft, setSectionRenameDraft] = useState('')
  const [sectionMenuOpenId, setSectionMenuOpenId] = useState<string | null>(null)

  // Cross-app jump: when Tags hands us an initialTaskId, find the task,
  // switch scope to its natural container, and select it. Then tell the
  // parent to clear the prop so toggling away/back doesn't re-fire.
  // (Loading guard removed May 18: page.tsx blocks render until data is
  // loaded, so when this component mounts `tasks` is always populated.)
  useEffect(() => {
    if (!initialTaskId) return
    const target = tasks.find(t => t.id === initialTaskId)
    if (target) {
      if (target.list_id) setScope({ kind: 'list', listId: target.list_id })
      else if (target.space_id) setScope({ kind: 'space', spaceId: target.space_id })
      else setScope({ kind: 'smart', view: 'all' })
      setSelectedId(target.id)
    }
    onConsumeInitialTaskId?.()
  }, [initialTaskId, tasks, onConsumeInitialTaskId])

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
    // Top-level only — subtasks render beneath their parent, not as their own
    // rows, so they shouldn't inflate any sidebar count.
    const open = tasks.filter(t => !t.completed_at && !t.parent_task_id)
    return {
      today: open.filter(t => t.due_date && t.due_date <= today).length,
      upcoming: open.filter(t => t.due_date && t.due_date > today).length,
      inbox: open.filter(t => !t.space_id && !t.list_id).length,
      recurring: open.filter(t => t.recurrence_rule != null).length,
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
    // Subtasks never appear as top-level rows — they're rendered beneath their
    // parent (see childrenByParent + the section map). Drop them from the pool.
    let pool = tasks.filter(t => !t.parent_task_id)
    if (scope.kind === 'smart') {
      pool = pool.filter(t => !t.completed_at)
      if (scope.view === 'today')    pool = pool.filter(t => t.due_date && t.due_date <= today)
      if (scope.view === 'upcoming') pool = pool.filter(t => t.due_date && t.due_date > today)
      if (scope.view === 'inbox')    pool = pool.filter(t => !t.space_id && !t.list_id)
      if (scope.view === 'recurring') pool = pool.filter(t => t.recurrence_rule != null)
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
  const dueBuckets = useMemo(() => {
    const thisWeek: Task[] = []
    const nextWeek: Task[] = []
    const later: Task[] = []
    const done: Task[] = []
    // Week boundaries: "This week" = today through Sunday of current calendar
    // week. "Next week" = Mon-Sun of next calendar week. Overdue rolls into
    // This Week (rows still get row-level rust coloring on the date pill).
    // Undated open tasks roll into Later.
    const [ty, tm, td] = today.split('-').map(Number)
    const todayDow = new Date(ty, tm - 1, td).getDay()  // 0=Sun, 1=Mon, ... 6=Sat
    const daysUntilSunday = (7 - todayDow) % 7
    const sundayOfThisWeek = isoAddDays(today, daysUntilSunday)
    const sundayOfNextWeek = isoAddDays(sundayOfThisWeek, 7)

    for (const t of filtered) {
      if (t.completed_at) { done.push(t); continue }
      if (!t.due_date)    { later.push(t); continue }
      if (t.due_date <= sundayOfThisWeek)       thisWeek.push(t)
      else if (t.due_date <= sundayOfNextWeek)  nextWeek.push(t)
      else                                       later.push(t)
    }
    return [
      { name: 'This week', tasks: thisWeek, accent: undefined },
      { name: 'Next week', tasks: nextWeek, accent: undefined },
      { name: 'Later',     tasks: later,    accent: undefined },
      { name: 'Done',      tasks: done,     accent: 'var(--navy-400)' },
    ].filter(s => s.tasks.length > 0)
  }, [filtered, today])

  // The container (List or Space) the current scope represents, if any.
  const scopeContainer = useMemo<{ kind: 'list' | 'space'; id: string } | null>(() => {
    if (scope.kind === 'list') return { kind: 'list', id: scope.listId }
    if (scope.kind === 'space') return { kind: 'space', id: scope.spaceId }
    return null
  }, [scope])

  // Sections belonging to the current scope's container, in order.
  const scopeSections = useMemo(() => {
    if (!scopeContainer) return [] as TaskSection[]
    return sections
      .filter(s => scopeContainer.kind === 'list' ? s.list_id === scopeContainer.id : s.space_id === scopeContainer.id)
      .sort((a, b) => a.sort_order - b.sort_order || (a.created_at < b.created_at ? -1 : 1))
  }, [sections, scopeContainer])

  // When to group by section instead of due bucket: always for a List; for a
  // Space only once it has at least one section (so OKR spaces keep their
  // Today/This week view until you opt in by adding a section).
  const useSectionView = scope.kind === 'list' || (scope.kind === 'space' && scopeSections.length > 0)

  // Group filtered tasks by section. Ungrouped first (headerless unless real
  // sections exist), then sections in order. Orphaned section_ids fall to
  // ungrouped.
  const containerSectionGroups = useMemo(() => {
    if (!useSectionView) return [] as { section: TaskSection | null; tasks: Task[] }[]
    const validIds = new Set(scopeSections.map(s => s.id))
    const byId = new Map<string, Task[]>()
    const ungrouped: Task[] = []
    for (const t of filtered) {
      if (t.section_id && validIds.has(t.section_id)) {
        const arr = byId.get(t.section_id) ?? []
        arr.push(t)
        byId.set(t.section_id, arr)
      } else {
        ungrouped.push(t)
      }
    }
    const groups: { section: TaskSection | null; tasks: Task[] }[] = [{ section: null, tasks: ungrouped }]
    for (const s of scopeSections) groups.push({ section: s, tasks: byId.get(s.id) ?? [] })
    return groups
  }, [useSectionView, scopeSections, filtered])

  const selected = useMemo(
    () => selectedId ? tasks.find(t => t.id === selectedId) ?? null : null,
    [tasks, selectedId]
  )

  // Subtasks grouped by parent id, ordered (open first, then by sort/created).
  // Used both for the inline child rows under each parent and the detail-panel
  // subtask block.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.parent_task_id) continue
      const arr = map.get(t.parent_task_id) ?? []
      arr.push(t)
      map.set(t.parent_task_id, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (!!a.completed_at !== !!b.completed_at) return a.completed_at ? 1 : -1
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
        return a.created_at < b.created_at ? -1 : 1
      })
    }
    return map
  }, [tasks])

  // Fast KR lookup for the row chip + detail picker.
  const krById = useMemo(() => {
    const map = new Map<string, RoadmapItem>()
    for (const r of roadmapItems) map.set(r.id, r)
    return map
  }, [roadmapItems])

  // ── Mutations ────────────────────────────────────────────────────

  const onQuickAdd = useCallback(async () => {
    const raw = quickAdd.trim()
    if (!raw) return
    const parsed = parseQuickAdd(raw)
    if (!parsed.title) { toast('Need a title'); return }
    // Pick the target container: if scope is a list, target that list;
    // if scope is a specific space, target that space; if scope is the
    // Inbox smart view, leave both null (Inbox = no space and no list);
    // otherwise fall back to activeSpaceId (the rail's selected space).
    let targetSpaceId: string | null = null
    let targetListId: string | null = null
    const isInboxScope = scope.kind === 'smart' && scope.view === 'inbox'
    if (scope.kind === 'list') {
      targetListId = scope.listId
    } else if (scope.kind === 'space') {
      targetSpaceId = scope.spaceId
    } else if (!isInboxScope) {
      targetSpaceId = activeSpaceId
    }
    if (!targetSpaceId && !targetListId && !isInboxScope) { toast('Pick a space or list first'); return }
    // A recurring task needs a due_date (DB CHECK). If the quick-add gave a
    // recurrence but no explicit due, snap to the rule's anchor — so "every
    // feb 6" lands on the next Feb 6, not today.
    let dueForCreate = parsed.due_date
    if (parsed.recurrence_rule) {
      dueForCreate = snapDueDateToRule(parsed.due_date ?? null, parsed.recurrence_rule, today)
    }
    try {
      const created = await tasksDb.create({
        space_id: targetSpaceId,
        list_id: targetListId,
        title: parsed.title,
        priority: parsed.priority,
        due_date: dueForCreate,
        due_time: parsed.due_time,
        deadline_date: parsed.deadline_date,
        estimated_minutes: parsed.estimated_minutes,
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
    } catch (e) {
      console.error('quick add failed', e)
      toast('Could not create task')
    }
  }, [quickAdd, scope, activeSpaceId, today, toast])

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

  // Create a subtask under `parent`. Inherits the parent's container so the
  // tasks_one_container CHECK holds; never carries a KR link (the parent owns
  // the alignment). Single level only — we don't offer subtasks-of-subtasks.
  const onAddSubtask = useCallback(async (parent: Task, title: string) => {
    const clean = title.trim()
    if (!clean) return
    try {
      const created = await tasksDb.create({
        title: clean,
        space_id: parent.space_id,
        list_id: parent.list_id,
        parent_task_id: parent.id,
        priority: 4,
      })
      setTasks(prev => [...prev, created])
    } catch (e) {
      console.error('add subtask failed', e)
      toast('Could not add subtask')
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

  const onAddSection = useCallback(async (name: string) => {
    if (!scopeContainer) return
    const clean = name.trim()
    if (!clean) return
    try {
      const count = scopeSections.length
      const created = await taskSectionsDb.create(
        scopeContainer.kind === 'list'
          ? { list_id: scopeContainer.id, name: clean, sort_order: count }
          : { space_id: scopeContainer.id, name: clean, sort_order: count }
      )
      setSections(prev => [...prev, created])
      setNewSectionDraft('')
      setNewSectionOpen(false)
    } catch (e) {
      console.error('create section failed', e)
      toast('Could not create section')
    }
  }, [scopeContainer, scopeSections, setSections, toast])

  const onRenameSection = useCallback(async (id: string, name: string) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const updated = await taskSectionsDb.rename(id, clean)
      setSections(prev => prev.map(s => s.id === id ? updated : s))
    } catch (e) {
      console.error('rename section failed', e)
      toast('Could not rename section')
    }
  }, [setSections, toast])

  const onDeleteSection = useCallback(async (id: string) => {
    try {
      await taskSectionsDb.remove(id)
      // ON DELETE SET NULL orphans tasks to "no section"; mirror locally.
      setSections(prev => prev.filter(s => s.id !== id))
      setTasks(prev => prev.map(t => t.section_id === id ? { ...t, section_id: null } : t))
    } catch (e) {
      console.error('delete section failed', e)
      toast('Could not delete section')
    }
  }, [setSections, setTasks, toast])

  const onMoveSection = useCallback(async (id: string, dir: -1 | 1) => {
    const ordered = scopeSections
    const idx = ordered.findIndex(s => s.id === id)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return
    const a = ordered[idx], b = ordered[swapIdx]
    try {
      const [ua, ub] = await Promise.all([
        taskSectionsDb.setSortOrder(a.id, b.sort_order),
        taskSectionsDb.setSortOrder(b.id, a.sort_order),
      ])
      setSections(prev => prev.map(s => s.id === ua.id ? ua : s.id === ub.id ? ub : s))
    } catch (e) {
      console.error('reorder section failed', e)
      toast('Could not reorder section')
    }
  }, [scopeSections, setSections, toast])

  const toggleSectionCollapse = (id: string) => setCollapsedSections(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  // ── Rendering ────────────────────────────────────────────────────

  const heading = useMemo(() => {
    if (scope.kind === 'smart') {
      return { title: scope.view === 'today' ? 'Today'
                    : scope.view === 'upcoming' ? 'Upcoming'
                    : scope.view === 'inbox' ? 'Inbox'
                    : scope.view === 'recurring' ? 'Recurring'
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

  // Shared row renderer — a parent TaskRow plus its inline subtask children.
  // Used by both the due-bucket view and the list-section view.
  const renderTaskWithKids = (task: Task) => {
    const kids = childrenByParent.get(task.id) ?? []
    const kr = task.roadmap_item_id ? krById.get(task.roadmap_item_id) : undefined
    const doneKids = kids.filter(k => k.completed_at).length
    return (
      <div key={task.id}>
        <TaskRow task={task}
          tags={tagsByTask.get(task.id) ?? []}
          space={spaces.find(s => s.id === task.space_id)}
          list={lists.find(l => l.id === task.list_id)}
          krTitle={kr?.title}
          subtaskProgress={kids.length > 0 ? { done: doneKids, total: kids.length } : undefined}
          selected={selectedId === task.id}
          onToggle={() => onToggle(task)}
          onClick={() => setSelectedId(task.id)}
          onTagClick={onJumpToTag} />
        {kids.map(kid => (
          <SubtaskRow key={kid.id} task={kid}
            selected={selectedId === kid.id}
            onToggle={() => onToggle(kid)}
            onClick={() => setSelectedId(kid.id)} />
        ))}
      </div>
    )
  }

  // "+ Add section" control — shown in the section view and as an opt-in footer
  // in the space due-bucket view. Targets the current scope's container.
  const addSectionControl = (
    <div style={{ marginTop: 16 }}>
      {newSectionOpen ? (
        <input autoFocus value={newSectionDraft}
          onChange={e => setNewSectionDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onAddSection(newSectionDraft)
            if (e.key === 'Escape') { setNewSectionOpen(false); setNewSectionDraft('') }
          }}
          onBlur={() => { if (newSectionDraft.trim()) onAddSection(newSectionDraft); else setNewSectionOpen(false) }}
          placeholder="Section name…"
          style={{ width: '100%', padding: '8px 12px', background: 'var(--navy-800)', border: '1px solid var(--accent)', borderRadius: 8, color: 'var(--navy-100)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
      ) : (
        <button onClick={() => { setNewSectionOpen(true); setNewSectionDraft('') }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'none', border: '1px dashed var(--navy-600)', borderRadius: 8, color: 'var(--navy-400)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', width: '100%', textAlign: 'left' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--navy-100)'; e.currentTarget.style.borderColor = 'var(--navy-500)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--navy-400)'; e.currentTarget.style.borderColor = 'var(--navy-600)' }}>
          <span style={{ color: 'var(--accent)', fontWeight: 700 }}>+</span> Add section
        </button>
      )}
    </div>
  )

  return (
    <div style={{
      display: 'grid',
      // Mobile: single column. Sub-sidebar collapses to a dropdown above the
      // task list; detail panel becomes a full-screen overlay.
      // Desktop: original three-column grid.
      gridTemplateColumns: isMobile
        ? '1fr'
        : `220px 1fr ${selected ? '340px' : '0'}`,
      height: 'calc(100vh - 0px)',
    }}>
      {/* Mobile-only opener — shows current scope, taps to expand the
          sub-sidebar (rendered below as a dropdown). */}
      {isMobile && (
        <button onClick={() => setMobileSubOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', background: 'var(--navy-800)',
            borderBottom: '1px solid var(--navy-600)',
            fontSize: 13, fontWeight: 600, color: 'var(--navy-50)',
            border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
          }}>
          <span>{heading.title}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: mobileSubOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .15s' }}>
            <path d="M3 5l3 3 3-3" stroke="var(--navy-300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      {/* ── Sub-sidebar ── desktop: always visible left rail. mobile:
          collapsed dropdown beneath the opener; hidden until expanded. */}
      <aside style={{
        background: 'var(--navy-800)',
        borderRight: isMobile ? 'none' : '1px solid var(--navy-600)',
        borderBottom: isMobile ? '1px solid var(--navy-600)' : 'none',
        overflowY: 'auto',
        ...(isMobile ? {
          display: mobileSubOpen ? 'block' : 'none',
          maxHeight: '60vh',
        } : {}),
      }}
      // Mobile: close the dropdown after any nav click. Inline rename inputs
      // and the "new list" form stop propagation themselves to avoid being
      // dismissed mid-edit (the SidebarRenamableRow / lists section handle
      // their own stopPropagation).
      onClick={isMobile ? () => setMobileSubOpen(false) : undefined}>
        <SidebarSection label="Smart views">
          <SidebarRow icon={<TodayIcon />}    label="Today"    count={counts.today}    active={scope.kind === 'smart' && scope.view === 'today'}    onClick={() => { setScope({ kind: 'smart', view: 'today' });    setSelectedId(null) }} />
          <SidebarRow icon={<UpcomingIcon />} label="Upcoming" count={counts.upcoming} active={scope.kind === 'smart' && scope.view === 'upcoming'} onClick={() => { setScope({ kind: 'smart', view: 'upcoming' }); setSelectedId(null) }} />
          <SidebarRow icon={<InboxIcon />}    label="Inbox"    count={counts.inbox}    active={scope.kind === 'smart' && scope.view === 'inbox'}    onClick={() => { setScope({ kind: 'smart', view: 'inbox' });    setSelectedId(null) }} />
          <SidebarRow icon={<RecurringIcon />} label="Recurring" count={counts.recurring} active={scope.kind === 'smart' && scope.view === 'recurring'} onClick={() => { setScope({ kind: 'smart', view: 'recurring' }); setSelectedId(null) }} />
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
      <main style={{ overflowY: 'auto', padding: isMobile ? '14px 14px 80px' : '20px 24px 60px' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', marginBottom: 5 }}>Daily · Tasks</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--navy-50)', letterSpacing: '-.02em' }}>{heading.title}</h1>
          {heading.subtitle && <div style={{ fontSize: 13, color: 'var(--navy-300)', marginTop: 2 }}>{heading.subtitle}</div>}
        </header>

        {useSectionView ? (
          // ── Section view (List always; Space once it has sections) ──
          <>
            {filtered.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--navy-300)', fontSize: 13 }}>
                Nothing here yet. Add a task below, or a section to organize this {scope.kind === 'space' ? 'space' : 'list'}.
              </div>
            )}
            {containerSectionGroups.map((group, gi) => {
              const s = group.section
              const hasRealSections = containerSectionGroups.length > 1
              // Ungrouped group: render rows headerless unless real sections coexist.
              if (s === null) {
                if (group.tasks.length === 0) return null
                return (
                  <section key="__ungrouped" style={{ marginTop: hasRealSections ? 20 : 8 }}>
                    {hasRealSections && (
                      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--nw-label-dim)', letterSpacing: '.18em', textTransform: 'uppercase', margin: '0 0 8px', padding: '0 12px' }}>
                        No section · {group.tasks.length}
                      </h2>
                    )}
                    {group.tasks.map(renderTaskWithKids)}
                  </section>
                )
              }
              const collapsed = collapsedSections.has(s.id)
              const isFirst = gi === 1
              const isLast = gi === containerSectionGroups.length - 1
              const renaming = renamingSectionId === s.id
              return (
                <section key={s.id} style={{ marginTop: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', position: 'relative' }}>
                    <button onClick={() => toggleSectionCollapse(s.id)} title={collapsed ? 'Expand' : 'Collapse'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-400)', padding: 0, display: 'inline-flex' }}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform .15s' }}>
                        <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    {renaming ? (
                      <input autoFocus value={sectionRenameDraft}
                        onChange={e => setSectionRenameDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { onRenameSection(s.id, sectionRenameDraft); setRenamingSectionId(null) }
                          if (e.key === 'Escape') setRenamingSectionId(null)
                        }}
                        onBlur={() => { if (sectionRenameDraft.trim() && sectionRenameDraft.trim() !== s.name) onRenameSection(s.id, sectionRenameDraft); setRenamingSectionId(null) }}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--nw-cream)', background: 'var(--navy-700)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', outline: 'none' }} />
                    ) : (
                      <h2 onClick={() => toggleSectionCollapse(s.id)}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--nw-cream)', letterSpacing: '.12em', textTransform: 'uppercase', margin: 0, cursor: 'pointer' }}>
                        {s.name}
                      </h2>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>· {group.tasks.length}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button onClick={() => onMoveSection(s.id, -1)} disabled={isFirst} title="Move up"
                        style={{ background: 'none', border: 'none', cursor: isFirst ? 'default' : 'pointer', color: isFirst ? 'var(--navy-600)' : 'var(--navy-400)', fontSize: 11, padding: 0, lineHeight: 1 }}>▲</button>
                      <button onClick={() => onMoveSection(s.id, 1)} disabled={isLast} title="Move down"
                        style={{ background: 'none', border: 'none', cursor: isLast ? 'default' : 'pointer', color: isLast ? 'var(--navy-600)' : 'var(--navy-400)', fontSize: 11, padding: 0, lineHeight: 1 }}>▼</button>
                      <button onClick={() => setSectionMenuOpenId(sectionMenuOpenId === s.id ? null : s.id)} title="Section options"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-400)', fontSize: 13, padding: 0, lineHeight: 1 }}>⋯</button>
                    </div>
                    {sectionMenuOpenId === s.id && (
                      <div style={{ position: 'absolute', right: 8, top: 28, zIndex: 20, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 7, padding: 4, minWidth: 130, boxShadow: '0 6px 20px rgba(0,0,0,.35)' }}>
                        <button onClick={() => { setRenamingSectionId(s.id); setSectionRenameDraft(s.name); setSectionMenuOpenId(null) }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-100)', fontSize: 12, padding: '7px 10px', borderRadius: 4, fontFamily: 'inherit' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--navy-600)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Rename</button>
                        <button onClick={() => { onDeleteSection(s.id); setSectionMenuOpenId(null) }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red-text)', fontSize: 12, padding: '7px 10px', borderRadius: 4, fontFamily: 'inherit' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--navy-600)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Delete section</button>
                      </div>
                    )}
                  </div>
                  {!collapsed && group.tasks.length === 0 && (
                    <div style={{ padding: '8px 12px 4px 30px', fontSize: 11.5, color: 'var(--navy-400)', fontStyle: 'italic' }}>No tasks in this section</div>
                  )}
                  {!collapsed && group.tasks.map(renderTaskWithKids)}
                </section>
              )
            })}
            {/* + Add section */}
            {addSectionControl}
          </>
        ) : (
          // ── Smart / Space / Tag scope: group by due bucket ──
          <>
            {dueBuckets.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--navy-300)', fontSize: 13 }}>
                Nothing here. {scope.kind === 'smart' && scope.view === 'today' && 'Enjoy your day.'}
              </div>
            )}
            {dueBuckets.map(section => {
              const isDone = section.name === 'Done'
              const collapsed = isDone && !showDone
              return (
              <section key={section.name} style={{ marginTop: 22 }}>
                {isDone ? (
                  <button onClick={toggleShowDone}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--nw-label-dim)',
                      letterSpacing: '.18em', textTransform: 'uppercase',
                      margin: '0 0 8px', padding: '0 12px',
                      background: 'none', border: 'none', cursor: 'pointer',
                    }}>
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none"
                      style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform .15s' }}>
                      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    {section.name} · {section.tasks.length}
                  </button>
                ) : (
                  <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--nw-label)', letterSpacing: '.18em', textTransform: 'uppercase', margin: '0 0 8px', padding: '0 12px' }}>
                    {section.name} · {section.tasks.length}
                  </h2>
                )}
                {!collapsed && section.tasks.map(renderTaskWithKids)}
              </section>
              )
            })}
            {/* Space can opt into section grouping by adding its first section */}
            {scope.kind === 'space' && addSectionControl}
          </>
        )}

        {/* Quick-add — sits at the bottom of the list, after all sections */}
        <form onSubmit={e => { e.preventDefault(); onQuickAdd() }} style={{ marginTop: 18 }}>
          <input ref={quickAddRef}
            value={quickAdd}
            onChange={e => setQuickAdd(e.target.value)}
            placeholder='+ Add task… try "close month tomorrow 2h by jun 30 #finance p1"'
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

      {/* ── Detail panel ── On desktop, occupies the right grid column (340px).
          On mobile, becomes a fullscreen overlay positioned over everything
          so the main list isn't squeezed off-screen. */}
      {selected && (
        <div style={isMobile ? {
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'var(--navy-800)', overflowY: 'auto',
        } : undefined}>
          <DetailPanel task={selected}
            tags={tagsByTask.get(selected.id) ?? []}
            spaces={spaces}
            lists={lists}
            sections={sections}
            objectives={objectives}
            roadmapItems={roadmapItems}
            subtasks={childrenByParent.get(selected.id) ?? []}
            onPatch={patch => onPatch(selected.id, patch)}
            onSetTags={tags => onSetTags(selected.id, tags)}
            onAddSubtask={title => onAddSubtask(selected, title)}
            onToggleSubtask={onToggle}
            onSelectTask={setSelectedId}
            onDelete={() => onDelete(selected.id)}
            onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: '14px 18px 4px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>{label}</div>
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

function TaskRow({ task, tags, space, list, krTitle, subtaskProgress, selected, onToggle, onClick, onTagClick }: {
  task: Task; tags: string[]; space?: Space; list?: TaskList; krTitle?: string;
  subtaskProgress?: { done: number; total: number };
  selected: boolean; onToggle: () => void; onClick: () => void; onTagClick?: (tag: string) => void
}) {
  const done = !!task.completed_at
  const durLabel = formatMinutes(task.estimated_minutes)
  // Deadline chip shows only when there's a hard deadline distinct from the
  // scheduled due date — otherwise it'd just duplicate the due pill.
  const showDeadline = !!task.deadline_date && task.deadline_date !== task.due_date
  const hasMeta = space || tags.length > 0 || task.recurrence_text || krTitle || durLabel || subtaskProgress || showDeadline
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
        {hasMeta && (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {space && <span title={space.name} style={{ width: 6, height: 6, borderRadius: '50%', background: space.color, flexShrink: 0 }} />}
            {krTitle && (
              <span title={`Advances KR: ${krTitle}`} style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--accent-dim)', color: 'var(--accent)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>◆ {krTitle}</span>
            )}
            {subtaskProgress && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--navy-700)', color: 'var(--navy-300)' }}>◷ {subtaskProgress.done}/{subtaskProgress.total}</span>
            )}
            {durLabel && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--navy-700)', color: 'var(--navy-100)' }}>⏱ {durLabel}</span>
            )}
            {tags.map(tag => (
              <span key={tag}
                onClick={e => { if (onTagClick) { e.stopPropagation(); onTagClick(tag) } }}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                  background: 'var(--indigo-bg)', color: 'var(--indigo-text)',
                  cursor: onTagClick ? 'pointer' : 'default',
                }}>
                #{tag}
              </span>
            ))}
            {task.recurrence_text && <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--slate-bg)', color: 'var(--slate-text)' }}>↻ {task.recurrence_text}</span>}
            {showDeadline && <span title="Hard deadline" style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99, background: 'var(--red-bg)', color: 'var(--red-text)' }}>⚑ {formatShortDate(task.deadline_date!)}</span>}
          </span>
        )}
      </div>
      <span style={{ fontSize: 11, color: dueColor(task.due_date), fontWeight: 500 }}>
        {formatDue(task.due_date, task.due_time)}
      </span>
    </button>
  )
}

/** Lightweight subtask row, rendered indented beneath its parent. Toggle +
 *  title only; clicking the title selects it into the detail panel. */
function SubtaskRow({ task, selected, onToggle, onClick }: {
  task: Task; selected: boolean; onToggle: () => void; onClick: () => void
}) {
  const done = !!task.completed_at
  return (
    <button onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 9,
        padding: '5px 12px 5px 44px', border: 'none', borderRadius: 6, cursor: 'pointer',
        background: selected ? 'var(--accent-dim)' : 'none', textAlign: 'left', fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--navy-800)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'none' }}>
      <span onClick={e => { e.stopPropagation(); onToggle() }}
        style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          border: `1.4px solid ${done ? 'var(--teal-text)' : 'var(--navy-500)'}`,
          background: done ? 'var(--teal-text)' : 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 8,
        }}>{done && '✓'}</span>
      <span style={{ fontSize: 12.5, color: done ? 'var(--navy-400)' : 'var(--navy-300)', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {task.title}
      </span>
    </button>
  )
}

function DetailPanel({ task, tags, spaces, lists, sections, objectives, roadmapItems, subtasks, onPatch, onSetTags, onAddSubtask, onToggleSubtask, onSelectTask, onDelete, onClose }: {
  task: Task; tags: string[]; spaces: Space[]; lists: TaskList[]; sections: TaskSection[]; objectives: AnnualObjective[]; roadmapItems: RoadmapItem[];
  subtasks: Task[];
  onPatch: (patch: Partial<Task>) => void;
  onSetTags: (tags: string[]) => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (t: Task) => void;
  onSelectTask: (id: string) => void;
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
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [krPickerOpen, setKrPickerOpen] = useState(false)
  const recMenuRef = useRef<HTMLDivElement | null>(null)
  // Keep local state in sync when the selected task changes
  useEffect(() => {
    setTitle(task.title)
    setDesc(task.description ?? '')
    setRecurrenceInput(task.recurrence_text ?? '')
    setRecurrenceError(null)
    setRecMenuOpen(false)
    setRecCustomOpen(false)
    setSubtaskDraft('')
    setKrPickerOpen(false)
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
  // Sections belonging to this task's container (List or Space), in order.
  const containerSections = sections
    .filter(s => task.list_id ? s.list_id === task.list_id : task.space_id ? s.space_id === task.space_id : false)
    .sort((a, b) => a.sort_order - b.sort_order || (a.created_at < b.created_at ? -1 : 1))
  const linkedKR = task.roadmap_item_id ? roadmapItems.find(r => r.id === task.roadmap_item_id) : null
  const isSubtask = !!task.parent_task_id
  // KR link is only valid on space-scoped tasks (tasks_list_no_kr_link CHECK).
  // Candidates = active KRs in this task's space, across quarters.
  const krCandidates = task.space_id ? getActiveKRs(roadmapItems).filter(r => r.space_id === task.space_id) : []
  const linkedObjective = linkedKR?.annual_objective_id ? objectives.find(o => o.id === linkedKR.annual_objective_id) : null
  const containerValue = task.space_id ? `s:${task.space_id}` : (task.list_id ? `l:${task.list_id}` : '')

  function onChangeContainer(value: string) {
    const [kind, id] = value.split(':')
    if (kind === 's') {
      // Spaces have no sections; clear it.
      onPatch({ space_id: id, list_id: null, section_id: null })
    } else if (kind === 'l') {
      // List-tasks can't link to a KR (DB CHECK constraint), so clear it on move.
      // Sections belong to the old list, so clear section_id too.
      onPatch({ space_id: null, list_id: id, roadmap_item_id: null, section_id: null })
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
    const patch: Partial<Task> = {
      recurrence_text: parsed.text,
      recurrence_rule: parsed.rule,
    }
    // Snap the due date to the rule's anchor (matches applyPreset). For a
    // date-anchored rule ("every Feb 6") this lands the due on the next Feb 6
    // so completion-advance follows the anchor; otherwise the DB CHECK that a
    // recurring task has a due_date would be satisfied by the wrong date.
    const newDue = snapDueDateToRule(task.due_date, parsed.rule, todayAnchor)
    if (newDue !== task.due_date) patch.due_date = newDue
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
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Task detail</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--navy-400)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <textarea value={title} onChange={e => setTitle(e.target.value)} onBlur={commitTitle}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur()
          }
        }}
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

      <Field label="Deadline">
        <input type="date" value={task.deadline_date ?? ''} onChange={e => onPatch({ deadline_date: e.target.value || null })} style={inputStyle} />
      </Field>
      {task.deadline_date && (
        <div style={{ fontSize: 10.5, color: 'var(--navy-400)', margin: '-4px 0 8px', paddingLeft: 2 }}>
          ⚑ Hard date — won&apos;t move. Separate from the due date you scheduled.
        </div>
      )}

      {/* Duration — preset minute buckets; click the active one to clear. Drives
          the calendar time-block length downstream (same model as weekly actions). */}
      <div style={{ padding: '9px 0', borderTop: '1px solid var(--navy-700)' }}>
        <div style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 7 }}>Duration</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[15, 30, 45, 60, 90, 120].map(mins => {
            const on = task.estimated_minutes === mins
            return (
              <button key={mins}
                onClick={() => onPatch({ estimated_minutes: on ? null : mins })}
                style={{
                  fontSize: 11.5, padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--navy-600)'}`,
                  background: on ? 'var(--accent)' : 'var(--navy-700)',
                  color: on ? '#fff' : 'var(--navy-300)', fontWeight: on ? 600 : 400,
                }}>{formatMinutes(mins)}</button>
            )
          })}
          {/* Non-preset value (e.g. migrated 2h15m) shows as its own active pill. */}
          {task.estimated_minutes != null && ![15, 30, 45, 60, 90, 120].includes(task.estimated_minutes) && (
            <button onClick={() => onPatch({ estimated_minutes: null })}
              style={{
                fontSize: 11.5, padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit',
                border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontWeight: 600,
              }}>{formatMinutes(task.estimated_minutes)} ×</button>
          )}
        </div>
      </div>

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

      {(containerSections.length > 0 || task.section_id) && (
        <Field label="Section">
          <select value={task.section_id ?? ''}
            onChange={e => onPatch({ section_id: e.target.value || null })}
            style={selectStyle}>
            <option value="">— No section —</option>
            {containerSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}

      {!list && task.space_id && (
        <div style={{ padding: '9px 0', borderTop: '1px solid var(--navy-700)' }}>
          <div style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 7 }}>Linked KR</div>
          {linkedKR && !krPickerOpen ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 11px', background: 'var(--accent-dim)', border: '1px solid var(--accent)', borderRadius: 7 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--accent)', fontWeight: 500, lineHeight: 1.3 }}>◆ {linkedKR.title}</div>
                {linkedObjective && <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 2 }}>{linkedObjective.name}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                <button onClick={() => setKrPickerOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--navy-300)', fontSize: 10, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', padding: 0 }}>change</button>
                <button onClick={() => onPatch({ roadmap_item_id: null })} style={{ background: 'none', border: 'none', color: 'var(--navy-400)', fontSize: 10, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', padding: 0 }}>unlink</button>
              </div>
            </div>
          ) : krCandidates.length > 0 ? (
            <select value={task.roadmap_item_id ?? ''}
              onChange={e => { onPatch({ roadmap_item_id: e.target.value || null }); setKrPickerOpen(false) }}
              style={{ ...selectStyle, width: '100%' }}>
              <option value="">— Link a KR… —</option>
              {krCandidates.map(kr => <option key={kr.id} value={kr.id}>{kr.title}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>No active KRs in this space yet.</div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--navy-400)', marginTop: 6, paddingLeft: 2 }}>
            Surfaces this task as advancing the KR — the alignment Todoist can&apos;t do.
          </div>
        </div>
      )}

      {/* Subtasks — single level. Hidden on subtasks themselves (no grandchildren). */}
      {!isSubtask && (
        <div style={{ padding: '9px 0', borderTop: '1px solid var(--navy-700)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 12, color: 'var(--navy-300)' }}>Subtasks</span>
            {subtasks.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>{subtasks.filter(s => s.completed_at).length} / {subtasks.length} done</span>
            )}
          </div>
          {subtasks.map(st => {
            const done = !!st.completed_at
            return (
              <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', borderTop: '1px solid var(--navy-700)' }}>
                <span onClick={() => onToggleSubtask(st)}
                  style={{
                    width: 15, height: 15, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                    border: `1.5px solid ${done ? 'var(--teal-text)' : 'var(--navy-500)'}`,
                    background: done ? 'var(--teal-text)' : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9,
                  }}>{done && '✓'}</span>
                <span onClick={() => onSelectTask(st.id)}
                  style={{ flex: 1, fontSize: 12.5, color: done ? 'var(--navy-400)' : 'var(--navy-100)', textDecoration: done ? 'line-through' : 'none', cursor: 'pointer' }}>
                  {st.title}
                </span>
              </div>
            )
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0 0' }}>
            <span style={{ color: 'var(--accent)', fontSize: 14, lineHeight: 1 }}>+</span>
            <input value={subtaskDraft} onChange={e => setSubtaskDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (subtaskDraft.trim()) { onAddSubtask(subtaskDraft); setSubtaskDraft('') } } }}
              placeholder="Add subtask…"
              style={{ flex: 1, background: 'none', border: 'none', color: 'var(--navy-300)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
          </div>
        </div>
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

/** Compact "Mon D" for the deadline chip (no year). */
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
