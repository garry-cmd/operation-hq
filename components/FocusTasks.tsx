'use client'
/**
 * FocusTasks — the active space's native tasks that fall within the displayed
 * Focus week (Mon–Sun of `weekStart`). Focus is a weekly perspective, so this
 * tracks the week shown above it and follows week navigation.
 *
 * Scope: caller passes the active space's tasks; we surface the open ones whose
 * due_date lands inside [weekStart, weekStart+6]. Tasks due before this week
 * (stale overdue) are intentionally NOT shown here — they live on the Tasks
 * "Today" view. Recurring tasks roll due_date forward on complete
 * (toggleComplete), so checking one moves it out of the window.
 *
 * Renders nothing when no tasks fall in the week.
 */
import { useState } from 'react'
import * as tasksDb from '@/lib/db/tasks'
import { Task, RoadmapItem, Priority } from '@/lib/types'
import { parseDateLocal } from '@/lib/utils'

const PRIORITY_COLOR: Record<Priority, string> = {
  1: '#d12d2d',
  2: '#d4885a',
  3: '#5b8def',
  4: 'transparent',
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Props = {
  // Active space's tasks (already space-scoped by the caller).
  tasks: Task[]
  roadmapItems: RoadmapItem[]
  // Monday (YYYY-MM-DD) of the week currently shown on Focus.
  weekStart: string
  setTasks: (fn: (prev: Task[]) => Task[]) => void
  onOpenTask: (id: string) => void
  toast: (m: string) => void
}

export default function FocusTasks({ tasks, roadmapItems, weekStart, setTasks, onOpenTask, toast }: Props) {
  const [busy, setBusy] = useState<string | null>(null)

  const today = ymd(new Date())
  const weekEndDate = parseDateLocal(weekStart)
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  const weekEnd = ymd(weekEndDate)

  // Open, non-subtask tasks due within the displayed week, chronological then
  // by priority (1 = urgent).
  const inWeek = tasks
    .filter(t =>
      !t.completed_at && !t.parent_task_id &&
      t.due_date && t.due_date >= weekStart && t.due_date <= weekEnd
    )
    .sort((a, b) => {
      if (a.due_date !== b.due_date) return (a.due_date! < b.due_date!) ? -1 : 1
      return a.priority - b.priority
    })

  if (inWeek.length === 0) return null

  const krTitle = (id: string | null) =>
    id ? (roadmapItems.find(r => r.id === id)?.title ?? null) : null

  function daysOverdue(dateStr: string): string {
    const d = Math.floor((Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / 86400000)
    if (d === 1) return '1d over'
    return `${d}d over`
  }

  // Due pill: past-but-this-week → alarm; today → caution; later this week → neutral weekday.
  function duePill(dueDate: string) {
    if (dueDate < today) {
      return { bg: 'var(--red-bg)', color: 'var(--red-text)', text: daysOverdue(dueDate) }
    }
    if (dueDate === today) {
      return { bg: 'var(--amber-bg)', color: 'var(--amber-text)', text: 'today' }
    }
    const wd = new Date(dueDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
    return { bg: 'var(--navy-700)', color: 'var(--navy-300)', text: wd }
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
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--nw-label)',
          textTransform: 'uppercase', letterSpacing: '.18em', margin: 0,
        }}>
          This week&apos;s tasks
        </h2>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', fontVariantNumeric: 'tabular-nums' }}>
          {inWeek.length}
        </span>
      </div>

      {/* Task card — matches Focus's habit/action card styling */}
      <div style={{
        background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
        borderRadius: 14, padding: '6px 14px',
      }}>
        {inWeek.map((task, i) => {
          const kr = krTitle(task.roadmap_item_id)
          const pill = duePill(task.due_date!)
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
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, padding: '1px 8px',
                borderRadius: 99, flexShrink: 0, letterSpacing: '.02em',
                background: pill.bg, color: pill.color,
              }}>
                {pill.text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
