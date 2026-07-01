'use client'
/**
 * Tasks — mobile-first task list.
 * Scope chips: Today | Overdue | Inbox | All | per-space
 * Sections: Overdue · Today · Upcoming · Done (collapsed by default)
 * FAB (+ button) is page-level; this component exposes onCreateTask so
 * page.tsx can wire the FastCapture or a simple inline create.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task, Space, RoadmapItem, TaskTag } from '@/lib/types'
import * as tasksDb from '@/lib/db/tasks'

// ── helpers ──────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10)

function dueBucket(task: Task): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!task.due_date) return 'none'
  const t = today()
  if (task.due_date < t) return 'overdue'
  if (task.due_date === t) return 'today'
  return 'upcoming'
}

function relDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d ago`
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const PRIORITY_COLOR: Record<number, string> = {
  1: '#ff6452',
  2: '#f5b840',
  3: '#4d9fff',
  4: 'transparent',
}

type Scope =
  | { kind: 'today' }
  | { kind: 'overdue' }
  | { kind: 'inbox' }
  | { kind: 'all' }
  | { kind: 'space'; spaceId: string }

interface Props {
  spaces: Space[]
  activeSpaceId: string
  roadmapItems: RoadmapItem[]
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  tagsByTask: Record<string, string[]>
  toast: (m: string) => void
}

// ── inline create row ─────────────────────────────────────────────────────

function InlineCreate({ onSave, onCancel, spaceId }: {
  onSave: (title: string) => Promise<void>
  onCancel: () => void
  spaceId: string | null
}) {
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function submit() {
    const t = title.trim()
    if (!t) { onCancel(); return }
    await onSave(t)
    setTitle('')
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--navy-700)' }}>
      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: 'transparent', flexShrink: 0 }} />
      <div style={{ width: 20, height: 20, borderRadius: 5, border: '1.5px solid var(--navy-500)', flexShrink: 0 }} />
      <input
        ref={ref}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder="Task name…"
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontSize: 13, color: 'var(--navy-50)', fontFamily: 'inherit',
        }}
      />
      <button
        onClick={submit}
        style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
      >Add</button>
      <button
        onClick={onCancel}
        style={{ fontSize: 11, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer' }}
      >✕</button>
    </div>
  )
}

// ── task row ──────────────────────────────────────────────────────────────

function TaskRow({ task, tags, roadmapItems, onToggle, onDelete }: {
  task: Task
  tags: string[]
  roadmapItems: RoadmapItem[]
  onToggle: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const bucket = dueBucket(task)
  const kr = task.roadmap_item_id ? roadmapItems.find(r => r.id === task.roadmap_item_id) : null
  const isDone = !!task.completed_at

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--navy-700)', position: 'relative' }}>
      {/* priority bar */}
      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: PRIORITY_COLOR[task.priority] ?? 'transparent', flexShrink: 0, minHeight: 20 }} />

      {/* checkbox */}
      <button
        onClick={onToggle}
        style={{
          width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 2,
          border: isDone ? 'none' : '1.5px solid var(--navy-500)',
          background: isDone ? 'var(--navy-600)' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isDone && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--navy-300)" strokeWidth="2.5">
            <polyline points="2,6 5,9 10,3"/>
          </svg>
        )}
      </button>

      {/* body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: isDone ? 'var(--navy-500)' : 'var(--navy-100)',
          lineHeight: 1.35,
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{task.title}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          {task.due_date && (
            <span style={{
              fontSize: 10, fontFamily: 'monospace',
              color: bucket === 'overdue' ? '#ff6452' : bucket === 'today' ? '#f5b840' : 'var(--navy-400)',
            }}>
              {relDate(task.due_date)}
            </span>
          )}
          {kr && (
            <span style={{ fontSize: 9, color: 'var(--accent)', background: 'rgba(77,143,255,.12)', borderRadius: 3, padding: '1px 5px' }}>
              {kr.title.length > 20 ? kr.title.slice(0, 20) + '…' : kr.title}
            </span>
          )}
          {tags.map(tag => (
            <span key={tag} style={{ fontSize: 9, color: 'var(--navy-400)', background: 'var(--navy-700)', borderRadius: 3, padding: '1px 5px' }}>
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {/* overflow */}
      <button
        onClick={() => setMenuOpen(o => !o)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--navy-500)', padding: '2px 4px', marginTop: 1 }}
      >⋯</button>
      {menuOpen && (
        <div style={{
          position: 'absolute', right: 16, top: 32, zIndex: 10,
          background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
          borderRadius: 8, padding: 4, minWidth: 120,
          boxShadow: '0 4px 16px rgba(0,0,0,.4)',
        }}>
          <button
            onClick={() => { setMenuOpen(false); onDelete() }}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '7px 12px', fontSize: 12, color: '#ff6452' }}
          >Delete</button>
        </div>
      )}
    </div>
  )
}

// ── section header ────────────────────────────────────────────────────────

function SectionHeader({ label, count, collapsed, onToggle }: {
  label: string; count: number; collapsed?: boolean; onToggle?: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        padding: '10px 16px 6px',
        display: 'flex', alignItems: 'center', gap: 8,
        cursor: onToggle ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--nw-label)', letterSpacing: '.16em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 10, color: 'var(--navy-500)', fontFamily: 'monospace' }}>{count}</span>
      {onToggle && (
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--navy-500)', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      )}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────

export default function Tasks({ spaces, activeSpaceId, roadmapItems, tasks, setTasks, tagsByTask, toast }: Props) {
  const [scope, setScope] = useState<Scope>({ kind: 'today' })
  const [creating, setCreating] = useState(false)
  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const todayStr = today()

  // ── filter by scope ──
  const filtered = useMemo(() => {
    const open = tasks.filter(t => !t.completed_at)
    const done = tasks.filter(t => !!t.completed_at)

    if (scope.kind === 'today') {
      return {
        overdue: open.filter(t => t.due_date && t.due_date < todayStr),
        today:   open.filter(t => t.due_date === todayStr),
        upcoming: [],
        none: open.filter(t => !t.due_date),
        done: done.slice(0, 10),
      }
    }
    if (scope.kind === 'overdue') {
      return {
        overdue: open.filter(t => t.due_date && t.due_date < todayStr),
        today: [], upcoming: [], none: [], done: [],
      }
    }
    if (scope.kind === 'inbox') {
      const inbox = open.filter(t => !t.space_id && !t.list_id)
      return { overdue: [], today: [], upcoming: inbox, none: [], done: done.filter(t => !t.space_id && !t.list_id).slice(0, 5) }
    }
    if (scope.kind === 'space') {
      const sp = open.filter(t => t.space_id === scope.spaceId)
      return {
        overdue: sp.filter(t => t.due_date && t.due_date < todayStr),
        today:   sp.filter(t => t.due_date === todayStr),
        upcoming: sp.filter(t => t.due_date && t.due_date > todayStr),
        none:    sp.filter(t => !t.due_date),
        done:    done.filter(t => t.space_id === scope.spaceId).slice(0, 5),
      }
    }
    // all
    return {
      overdue: open.filter(t => t.due_date && t.due_date < todayStr),
      today:   open.filter(t => t.due_date === todayStr),
      upcoming: open.filter(t => t.due_date && t.due_date > todayStr),
      none:    open.filter(t => !t.due_date),
      done:    done.slice(0, 10),
    }
  }, [tasks, scope, todayStr])

  const overdueCount = tasks.filter(t => !t.completed_at && t.due_date && t.due_date < todayStr).length
  const todayCount   = tasks.filter(t => !t.completed_at && t.due_date === todayStr).length

  async function handleToggle(task: Task) {
    // Optimistic
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed_at: t.completed_at ? null : new Date().toISOString() } : t))
    try {
      const updated = await tasksDb.toggleComplete(task)
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    } catch {
      // revert
      setTasks(prev => prev.map(t => t.id === task.id ? task : t))
      toast('Failed to update task')
    }
  }

  async function handleCreate(title: string) {
    const spaceId = scope.kind === 'space' ? scope.spaceId : (scope.kind === 'inbox' ? null : activeSpaceId)
    try {
      const task = await tasksDb.create({ title, space_id: spaceId })
      setTasks(prev => [task, ...prev])
      setCreating(false)
    } catch {
      toast('Failed to create task')
    }
  }

  async function handleDelete(task: Task) {
    setTasks(prev => prev.filter(t => t.id !== task.id))
    try {
      await tasksDb.remove(task.id)
    } catch {
      setTasks(prev => [task, ...prev])
      toast('Failed to delete task')
    }
  }

  function renderTask(task: Task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        tags={tagsByTask[task.id] ?? []}
        roadmapItems={roadmapItems}
        onToggle={() => handleToggle(task)}
        onDelete={() => handleDelete(task)}
      />
    )
  }

  const allSections = [
    ...(filtered.overdue.length > 0 ? [
      <SectionHeader key="ov-h" label="Overdue" count={filtered.overdue.length} />,
      ...filtered.overdue.map(renderTask),
    ] : []),
    ...(filtered.today.length > 0 ? [
      <SectionHeader key="td-h" label="Today" count={filtered.today.length} />,
      ...filtered.today.map(renderTask),
    ] : []),
    ...(filtered.upcoming.length > 0 ? [
      <SectionHeader key="up-h" label={scope.kind === 'inbox' ? 'Tasks' : 'Upcoming'} count={filtered.upcoming.length} />,
      ...filtered.upcoming.map(renderTask),
    ] : []),
    ...(filtered.none.length > 0 ? [
      <SectionHeader key="no-h" label="No date" count={filtered.none.length} />,
      ...filtered.none.map(renderTask),
    ] : []),
  ]

  const isEmpty = allSections.length === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--navy-900)' }}>

      {/* top bar */}
      <div style={{
        padding: '12px 16px 10px',
        borderBottom: '1px solid var(--navy-700)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', letterSpacing: '-.025em' }}>Tasks</span>
        <button
          onClick={() => setCreating(true)}
          style={{
            fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'rgba(77,143,255,.1)',
            border: '1px solid rgba(77,143,255,.25)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
          }}
        >+ New</button>
      </div>

      {/* scope chips */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 16px',
        borderBottom: '1px solid var(--navy-700)', flexShrink: 0,
        scrollbarWidth: 'none',
      }}>
        {([
          { s: { kind: 'today' } as Scope,   label: `Today${todayCount ? ` · ${todayCount}` : ''}` },
          { s: { kind: 'overdue' } as Scope, label: `Overdue${overdueCount ? ` · ${overdueCount}` : ''}`, urgent: overdueCount > 0 },
          { s: { kind: 'inbox' } as Scope,   label: 'Inbox' },
          { s: { kind: 'all' } as Scope,     label: 'All' },
          ...spaces.map(sp => ({ s: { kind: 'space', spaceId: sp.id } as Scope, label: sp.name })),
        ]).map(({ s, label, urgent }) => {
          const isActive = JSON.stringify(scope) === JSON.stringify(s)
          return (
            <button
              key={label}
              onClick={() => setScope(s)}
              style={{
                flexShrink: 0, fontSize: 11, fontWeight: 500,
                padding: '4px 11px', borderRadius: 20, cursor: 'pointer', whiteSpace: 'nowrap',
                border: isActive
                  ? `1px solid ${urgent ? 'rgba(255,100,82,.4)' : 'rgba(77,143,255,.38)'}`
                  : '1px solid var(--navy-600)',
                background: isActive
                  ? `${urgent ? 'rgba(255,100,82,.14)' : 'rgba(77,143,255,.14)'}`
                  : 'transparent',
                color: isActive
                  ? (urgent ? '#ff6452' : 'var(--accent)')
                  : (urgent ? '#ff6452' : 'var(--navy-300)'),
              }}
            >{label}</button>
          )
        })}
      </div>

      {/* inline create */}
      {creating && (
        <InlineCreate
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
          spaceId={scope.kind === 'space' ? scope.spaceId : null}
        />
      )}

      {/* list */}
      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none', paddingBottom: 100 }}>

        {isEmpty && !creating && (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--navy-500)', fontSize: 13 }}>
            {scope.kind === 'overdue' ? 'No overdue tasks 🎉' :
             scope.kind === 'today'   ? 'Nothing due today' :
             scope.kind === 'inbox'   ? 'Inbox is clear' : 'No tasks'}
          </div>
        )}

        {allSections}

        {/* Done section */}
        {filtered.done.length > 0 && (
          <>
            <SectionHeader
              label="Done"
              count={filtered.done.length}
              collapsed={doneCollapsed}
              onToggle={() => setDoneCollapsed(o => !o)}
            />
            {!doneCollapsed && filtered.done.map(renderTask)}
          </>
        )}
      </div>
    </div>
  )
}
