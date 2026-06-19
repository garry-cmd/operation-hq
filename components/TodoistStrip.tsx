'use client'
/**
 * TodoistStrip — read-only display of today + overdue Todoist tasks on the
 * Focus tab, scoped to the active space. Fetches from the server-side proxy at
 * /api/todoist/tasks (which returns only OKRs-project tasks — the KR mirror).
 *
 * Space scoping: OKRs-project tasks carry a per-space Todoist label. We show
 * only the tasks whose label matches the active space. "My OKRs" has no Todoist
 * label, so it shows the unlabeled OKRs-project tasks.
 *
 * Degrades silently: if Todoist is unreachable, unconfigured, or returns zero
 * tasks for this space, the strip renders nothing rather than breaking Focus.
 */
import { useEffect, useState, useCallback } from 'react'

interface TodoistTask {
  id: string
  content: string
  labels: string[]
  priority: number
  due: { date: string; string: string; is_recurring: boolean } | null
}

// Space name → Todoist label. Casing matches the labels in Todoist exactly
// (note "VidScrip" the space vs "Vidscrip" the label). Spaces not listed here
// (i.e. "My OKRs") have no label and match unlabeled OKRs-project tasks.
const SPACE_LABEL: Record<string, string> = {
  Stellar: 'Stellar',
  USPSA: 'USPSA',
  Keeply: 'Keeply',
  VidScrip: 'Vidscrip',
}
const KNOWN_LABELS_LC = Object.values(SPACE_LABEL).map(l => l.toLowerCase())

export default function TodoistStrip({ spaceName }: { spaceName: string }) {
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

  // Scope to the active space by label. Known space → match its label.
  // "My OKRs" (no mapped label) → tasks carrying none of the known space labels.
  const label = SPACE_LABEL[spaceName]
  const scoped = label
    ? tasks.filter(t => t.labels.some(l => l.toLowerCase() === label.toLowerCase()))
    : tasks.filter(t => !t.labels.some(l => KNOWN_LABELS_LC.includes(l.toLowerCase())))

  // Nothing to show for this space — hide entirely
  if (!loaded || scoped.length === 0) return null

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Overdue first, then today; normalize datetime strings to date-only for comparison
  const dateOf = (d: string) => d.includes('T') ? d.split('T')[0] : d
  const overdue = scoped.filter(t => t.due && dateOf(t.due.date) < today)
  const todayTasks = scoped.filter(t => !t.due || dateOf(t.due.date) >= today)

  function daysOverdue(dateStr: string): string {
    // due.date can be "2026-06-05" or "2026-06-05T09:00:00" — handle both
    const dateOnly = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr
    const d = Math.floor((Date.now() - new Date(dateOnly + 'T12:00:00').getTime()) / 86400000)
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

            {/* Due pill */}
            {task.due && (() => {
              const isOver = dateOf(task.due!.date) < today
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
              href={`https://app.todoist.com/app/task/${task.id}`}
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
