'use client'
/**
 * FocusTasks — today + overdue native tasks for the active space, shown on the
 * Focus tab below the strategic actions. Replaces the old read-only Todoist
 * strip (retired with the Todoist→HQ migration). These are real HQ tasks, so
 * the checkbox actually completes them.
 *
 * Scope: caller passes the active space's tasks. We surface the open ones whose
 * due_date is today or earlier (mirrors the NavRail "Today" badge filter).
 * Recurring tasks roll their due_date forward on complete (toggleComplete), so
 * checking one drops it out of the window rather than crossing it off.
 *
 * Renders nothing when the space has no due/overdue tasks.
 */
import { useState } from 'react'
import * as tasksDb from '@/lib/db/tasks'
import { Task, RoadmapItem, Priority } from '@/lib/types'

const PRIORITY_COLOR: Record<Priority, string> = {
  1: '#d12d2d',
  2: '#d4885a',
  3: '#5b8def',
  4: 'transparent',
}

type Props = {
  // Active space's tasks (already space-scoped by the caller).
  tasks: Task[]
  roadmapItems: RoadmapItem[]
  setTasks: (fn: (prev: Task[]) => Task[]) => void
  onOpenTask: (id: string) => void
  toast: (m: string) => void
}

export default function FocusTasks({ tasks, roadmapItems, setTasks, onOpenTask, toast }: Props) {
  const [busy, setBusy] = useState<string | null>(null)

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Open tasks due today or earlier. due_date is 'YYYY-MM-DD' so string compare
  // is chronological. Skip subtasks (they show under their parent on Tasks).
  const due = tasks
    .filter(t => !t.completed_at && !t.parent_task_id && t.due_date && t.due_date <= today)
    .sort((a, b) => {
      // overdue (older due_date) first; then by priority (1 = urgent) ascending
      if (a.due_date !== b.due_date) return (a.due_date! < b.due_date!) ? -1 : 1
      return a.priority - b.priority
    })

  if (due.length === 0) return null

  const krTitle = (id: string | null) =>
    id ? (roadmapItems.find(r => r.id === id)?.title ?? null) : null

  function daysOverdue(dateStr: string): string {
    const d = Math.floor((Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / 86400000)
    if (d <= 0) return 'today'
    if (d === 1) return '1d over'
    return `${d}d over`
  }

  async function complete(task: Task) {
    if (busy) return
    setBusy(task.id)
    try {
      const updated = await tasksDb.toggleComplete(task)
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    } catch {
      toast('Could not update task')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      {/* Section label — matches Focus's night-watch pattern */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{
          fontSize: 10, fontWeight: 500, color: 'var(--nw-label)',
          textTransform: 'uppercase', letterSpacing: '.16em', margin: 0,
        }}>
          Today &amp; overdue
        </h2>
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--navy-400)',
        }}>
          {due.length}
        </span>
      </div>

      {/* Task card — matches Focus's habit/action card styling */}
      <div style={{
        background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
        borderRadius: 14, padding: '6px 14px',
      }}>
        {due.map((task, i) => {
          const isOver = !!task.due_date && task.due_date < today
          const kr = krTitle(task.roadmap_item_id)
          return (
            <div key={task.id} style={{
              display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--navy-700)',
              opacity: busy === task.id ? 0.5 : 1, transition: 'opacity .15s',
            }}>
              {/* Functional completion checkbox */}
              <button
                onClick={() => complete(task)}
                title={task.recurrence_rule ? 'Complete (rolls forward)' : 'Complete'}
                style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0, padding: 0,
                  border: '2px solid var(--navy-400)', background: 'transparent',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              />

              {/* Priority dot */}
              <span style={{
                width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                background: task.priority < 4 ? PRIORITY_COLOR[task.priority] : 'var(--navy-600)',
              }} />

              {/* Title — click opens the task on the Tasks tab */}
              <span
                onClick={() => onOpenTask(task.id)}
                style={{
                  flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--navy-50)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  cursor: 'pointer',
                }}
              >
                {task.title}
                {task.recurrence_rule && (
                  <span title="Recurring" style={{ color: 'var(--navy-400)', marginLeft: 6, fontSize: 12 }}>↻</span>
                )}
              </span>

              {/* KR-link hint */}
              {kr && (
                <span title={`Linked to KR: ${kr}`} style={{
                  fontSize: 10, fontWeight: 600, color: 'var(--navy-300)',
                  background: 'var(--navy-700)', borderRadius: 6,
                  padding: '1px 7px', flexShrink: 0, maxWidth: 160,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  ◆ {kr}
                </span>
              )}

              {/* Due pill */}
              {task.due_date && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 8px',
                  borderRadius: 99, flexShrink: 0,
                  background: isOver ? 'var(--red-bg)' : 'var(--amber-bg)',
                  color: isOver ? 'var(--red-text)' : 'var(--amber-text)',
                }}>
                  {isOver ? daysOverdue(task.due_date) : 'today'}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
