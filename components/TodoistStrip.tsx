'use client'
/**
 * TodoistStrip — read-only display of today + overdue Todoist tasks on the
 * Focus tab. Fetches from the server-side proxy at /api/todoist/tasks.
 *
 * Degrades silently: if Todoist is unreachable, unconfigured, or returns
 * zero tasks, the strip renders nothing rather than breaking Focus.
 */
import { useEffect, useState, useCallback } from 'react'

interface TodoistTask {
  id: string
  content: string
  labels: string[]
  priority: number
  due: { date: string; string: string; is_recurring: boolean } | null
  url: string
}

export default function TodoistStrip() {
  const [tasks, setTasks] = useState<TodoistTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [syncTime, setSyncTime] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/todoist/tasks')
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then((data: TodoistTask[]) => {
        setTasks(data)
        const now = new Date()
        setSyncTime(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`)
      })
      .catch(() => { /* silent degrade */ })
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => { load() }, [load])

  // Nothing to show — hide entirely
  if (!loaded || tasks.length === 0) return null

  const today = new Date().toISOString().slice(0, 10)

  // Overdue first, then today; within each group sort alphabetically
  const overdue = tasks.filter(t => t.due && t.due.date < today)
  const todayTasks = tasks.filter(t => !t.due || t.due.date >= today)

  function daysOverdue(dateStr: string): string {
    const d = Math.floor((Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / 86400000)
    if (d <= 0) return 'today'
    if (d === 1) return '1d over'
    return `${d}d over`
  }

  return (
    <div style={{ marginTop: 20 }}>
      {/* Section label — matches Focus's night-watch pattern */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      }}>
        <h2 style={{
          fontSize: 10, fontWeight: 500, color: 'var(--nw-label)',
          textTransform: 'uppercase', letterSpacing: '.16em', margin: 0,
        }}>
          Today &amp; overdue
        </h2>
        {syncTime && (
          <span style={{ fontSize: 10, color: 'var(--teal-text)', fontWeight: 500 }}>
            ● {syncTime}
          </span>
        )}
        <span style={{
          marginLeft: 'auto', fontSize: 9, fontWeight: 700, letterSpacing: '.04em',
          color: 'var(--navy-400)', border: '1px solid var(--navy-600)',
          borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 3,
        }}>
          ↗ Todoist
        </span>
      </div>

      {/* Task card — matches Focus's habit/action card styling */}
      <div style={{
        background: 'var(--navy-800)', border: '1px solid var(--navy-600)',
        borderRadius: 14, padding: '10px 14px',
      }}>
        {[...overdue, ...todayTasks].map((task, i) => (
          <div key={task.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--navy-700)',
          }}>
            {/* Display-only checkbox */}
            <div
              title="Complete in Todoist"
              style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                border: `1.5px solid ${task.priority >= 3 ? 'var(--red-text)' : 'var(--navy-500)'}`,
                cursor: 'default',
              }}
            />

            {/* Title */}
            <span style={{
              flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--navy-50)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {task.content}
            </span>

            {/* Labels as space hint */}
            {task.labels.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: 'var(--navy-300)',
                background: 'var(--navy-700)', borderRadius: 6,
                padding: '1px 7px', flexShrink: 0,
              }}>
                {task.labels[0]}
              </span>
            )}

            {/* Due pill */}
            {task.due && (() => {
              const isOver = task.due!.date < today
              return (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 8px',
                  borderRadius: 99, flexShrink: 0,
                  background: isOver ? 'var(--red-bg)' : 'var(--amber-bg)',
                  color: isOver ? 'var(--red-text)' : 'var(--amber-text)',
                }}>
                  {isOver ? daysOverdue(task.due!.date) : 'today'}
                </span>
              )
            })()}

            {/* External link */}
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in Todoist"
              style={{
                color: 'var(--navy-400)', fontSize: 13, textDecoration: 'none',
                flexShrink: 0, lineHeight: 1,
              }}
            >↗</a>
          </div>
        ))}

      </div>

      {/* Refresh link */}
      <div style={{ textAlign: 'right', marginTop: 6 }}>
        <button
          onClick={load}
          style={{
            fontSize: 11, color: 'var(--navy-400)', background: 'none',
            border: 'none', cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          refresh
        </button>
      </div>
    </div>
  )
}
