import * as tasksDb from '@/lib/db/tasks'
import * as krsDb from '@/lib/db/krs'
import * as notesDb from '@/lib/db/notes'
import { createCalendarEvent } from '@/lib/db/googleApi'
import { markdownToTipTapDoc } from '@/lib/notes/markdownToDoc'
import type { ProposedAction } from '@/lib/agentTools'
import type { Task, RoadmapItem, Space, HealthStatus, CalendarBlock, Note, NoteBody } from '@/lib/types'

/**
 * Canonical executor for a propose-first agent action. Shared by the Chief of
 * Staff chat (components/Agent) and the actionable morning brief
 * (components/BriefingsFeed) so the mutation logic — and its staleness guards —
 * live in exactly one place. Each branch goes through the same db helpers the
 * rest of the app uses, then syncs the page-level state via the passed setters.
 */
export interface ActionContext {
  tasks: Task[]
  roadmapItems: RoadmapItem[]
  spaces: Space[]
  notes: Note[]
  setTasks: (fn: (p: Task[]) => Task[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setCalendarBlocks: (fn: (p: CalendarBlock[]) => CalendarBlock[]) => void
  setNotes?: (fn: (p: Note[]) => Note[]) => void
}

/** Top-level block list of a TipTap doc body (empty if null / malformed). */
function docBlocks(body: NoteBody | null | undefined): unknown[] {
  if (body && typeof body === 'object' && Array.isArray((body as { content?: unknown }).content)) {
    return (body as { content: unknown[] }).content
  }
  return []
}

function stripId(v: unknown, prefix: string): string {
  const s = String(v ?? '').trim()
  return s.startsWith(prefix + ':') ? s.slice(prefix.length + 1) : s
}

function hhmmToMin(v: unknown): number {
  const [h, m] = String(v ?? '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** Human-readable label for a proposed action's confirmation card. */
export function describeAction(
  a: ProposedAction,
  ctx: Pick<ActionContext, 'tasks' | 'roadmapItems' | 'spaces' | 'notes'>,
): string {
  const input = a.input
  if (a.tool === 'complete_task') {
    const id = stripId(input.task_id, 'task'); const t = ctx.tasks.find(x => x.id === id)
    if (t?.recurrence_rule && t.due_date) return `Complete \u201c${t.title}\u201d (recurring \u2014 rolls to next)`
    return `Mark \u201c${t?.title ?? id}\u201d done`
  }
  if (a.tool === 'reschedule_task') {
    const id = stripId(input.task_id, 'task'); const t = ctx.tasks.find(x => x.id === id)
    return `Move \u201c${t?.title ?? id}\u201d \u2192 ${String(input.due_date ?? '')}`
  }
  if (a.tool === 'add_task') {
    const sid = stripId(input.space_id, 'space')
    const sp = sid ? ctx.spaces.find(s => s.id === sid)?.name : null
    const due = input.due_date ? ` \u00b7 due ${String(input.due_date)}` : ''
    return `Add task \u201c${String(input.title ?? '')}\u201d${sp ? ` to ${sp}` : ''}${due}`
  }
  if (a.tool === 'set_kr_health') {
    const id = stripId(input.kr_id, 'kr'); const k = ctx.roadmapItems.find(x => x.id === id)
    return `Set \u201c${k?.title ?? id}\u201d \u2192 ${String(input.health ?? '').replace('_', ' ')}`
  }
  if (a.tool === 'create_calendar_event') {
    return `Add to calendar: \u201c${String(input.title ?? '')}\u201d \u00b7 ${String(input.date ?? '')} ${String(input.start_time ?? '')}\u2013${String(input.end_time ?? '')}`
  }
  if (a.tool === 'create_note') {
    const sid = stripId(input.space_id, 'space')
    const sp = sid ? ctx.spaces.find(s => s.id === sid)?.name : null
    return `Create note \u201c${String(input.title ?? 'Untitled')}\u201d${sp ? ` in ${sp}` : ''}`
  }
  if (a.tool === 'append_note') {
    const id = stripId(input.note_id, 'note'); const n = ctx.notes.find(x => x.id === id)
    return `Append to note \u201c${n?.title || 'Untitled'}\u201d`
  }
  if (a.tool === 'update_note') {
    const id = stripId(input.note_id, 'note'); const n = ctx.notes.find(x => x.id === id)
    const bits = [input.title != null ? 'title' : null, input.body != null ? 'body' : null].filter(Boolean).join(' + ')
    return `Edit note \u201c${n?.title || 'Untitled'}\u201d${bits ? ` (${bits})` : ''}`
  }
  if (a.tool === 'update_task') {
    const id = stripId(input.task_id, 'task'); const t = ctx.tasks.find(x => x.id === id)
    const changes: string[] = []
    if (input.title != null) changes.push(`title \u2192 \u201c${String(input.title)}\u201d`)
    if (input.due_date != null) changes.push(`due ${String(input.due_date)}`)
    if (input.priority != null) changes.push(`priority ${String(input.priority)}`)
    if (input.description != null) changes.push('description')
    return `Edit \u201c${t?.title ?? id}\u201d${changes.length ? `: ${changes.join(', ')}` : ''}`
  }
  return a.tool
}

/** Execute a proposed action (only after approval). Throws on bad input or a
 *  missing target so the caller can surface a failure + retry. */
export async function runProposedAction(a: ProposedAction, ctx: ActionContext): Promise<void> {
  const input = a.input
  if (a.tool === 'complete_task') {
    const id = stripId(input.task_id, 'task')
    const task = ctx.tasks.find(t => t.id === id)
    if (!task) throw new Error('Task not found')
    if (task.completed_at) return // already done — don't un-complete
    // Canonical completion: recurring tasks roll their due date forward.
    const updated = await tasksDb.toggleComplete(task)
    ctx.setTasks(prev => prev.map(t => t.id === id ? updated : t))
    return
  }
  if (a.tool === 'reschedule_task') {
    const id = stripId(input.task_id, 'task'); const due = String(input.due_date ?? '')
    if (!ctx.tasks.some(t => t.id === id)) throw new Error('Task not found')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Bad date')
    await tasksDb.update(id, { due_date: due })
    ctx.setTasks(prev => prev.map(t => t.id === id ? { ...t, due_date: due } : t))
    return
  }
  if (a.tool === 'add_task') {
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('No title')
    const sid = stripId(input.space_id, 'space') || null
    const due = input.due_date ? String(input.due_date) : null
    const created = await tasksDb.create({ title, space_id: sid, due_date: due })
    ctx.setTasks(prev => [...prev, created])
    return
  }
  if (a.tool === 'set_kr_health') {
    const id = stripId(input.kr_id, 'kr'); const health = String(input.health ?? '') as HealthStatus
    if (!ctx.roadmapItems.some(k => k.id === id)) throw new Error('KR not found')
    await krsDb.update(id, { health_status: health })
    ctx.setRoadmapItems(prev => prev.map(k => k.id === id ? { ...k, health_status: health } : k))
    return
  }
  if (a.tool === 'create_calendar_event') {
    const title = String(input.title ?? '').trim()
    const date = String(input.date ?? '')
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Bad event')
    const startMin = hhmmToMin(input.start_time); const endMin = hhmmToMin(input.end_time)
    if (endMin <= startMin) throw new Error('Bad time range')
    const block = await createCalendarEvent(title, date, startMin, endMin)
    ctx.setCalendarBlocks(prev => [...prev, block])
    return
  }
  if (a.tool === 'create_note') {
    const title = String(input.title ?? '').trim()
    const bodyText = String(input.body ?? '')
    if (!title && !bodyText) throw new Error('Empty note')
    const sid = stripId(input.space_id, 'space') || null
    const created = await notesDb.create({
      title: title || 'Untitled',
      body: bodyText ? markdownToTipTapDoc(bodyText) : null,
      space_id: sid,
      notebook_id: null,
    })
    ctx.setNotes?.(prev => [...prev, created])
    return
  }
  if (a.tool === 'append_note') {
    const id = stripId(input.note_id, 'note')
    const note = ctx.notes.find(n => n.id === id)
    if (!note) throw new Error('Note not found')
    const addText = String(input.body ?? '')
    if (!addText.trim()) throw new Error('Nothing to append')
    const merged = { type: 'doc', content: [...docBlocks(note.body), ...docBlocks(markdownToTipTapDoc(addText))] }
    const updated = await notesDb.saveBody(id, merged)
    ctx.setNotes?.(prev => prev.map(n => n.id === id ? updated : n))
    return
  }
  if (a.tool === 'update_note') {
    const id = stripId(input.note_id, 'note')
    if (!ctx.notes.some(n => n.id === id)) throw new Error('Note not found')
    const patch: { title?: string; body?: NoteBody } = {}
    if (input.title != null) patch.title = String(input.title)
    if (input.body != null) patch.body = markdownToTipTapDoc(String(input.body))
    if (!Object.keys(patch).length) throw new Error('Nothing to update')
    const updated = await notesDb.update(id, patch)
    ctx.setNotes?.(prev => prev.map(n => n.id === id ? updated : n))
    return
  }
  if (a.tool === 'update_task') {
    const id = stripId(input.task_id, 'task')
    if (!ctx.tasks.some(t => t.id === id)) throw new Error('Task not found')
    const patch: Partial<Task> = {}
    if (input.title != null) patch.title = String(input.title)
    if (input.due_date != null) {
      const due = String(input.due_date)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Bad date')
      patch.due_date = due
    }
    if (input.priority != null) {
      const p = Number(input.priority)
      if (![1, 2, 3, 4].includes(p)) throw new Error('Bad priority')
      patch.priority = p as Task['priority']
    }
    if (input.description != null) patch.description = String(input.description)
    if (!Object.keys(patch).length) throw new Error('Nothing to update')
    const updated = await tasksDb.update(id, patch)
    ctx.setTasks(prev => prev.map(t => t.id === id ? updated : t))
    return
  }
  throw new Error('Unknown action')
}
