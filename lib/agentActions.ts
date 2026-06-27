import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import * as notesDb from '@/lib/db/notes'
import * as checkinsDb from '@/lib/db/checkins'
import * as actionsDb from '@/lib/db/actions'
import { createCalendarEvent } from '@/lib/db/googleApi'
import { markdownToTipTapDoc } from '@/lib/notes/markdownToDoc'
import { getMonday } from '@/lib/utils'
import type { ProposedAction } from '@/lib/agentTools'
import type { RoadmapItem, Space, HealthStatus, Note, NoteBody, AnnualObjective } from '@/lib/types'

/**
 * Canonical executor for a propose-first agent action. Shared by the Chief of
 * Staff chat (components/Agent) and the actionable morning brief
 * (components/BriefingsFeed) so the mutation logic — and its staleness guards —
 * live in exactly one place. Each branch goes through the same db helpers the
 * rest of the app uses, then syncs the page-level state via the passed setters.
 */
export interface ActionContext {
  roadmapItems: RoadmapItem[]
  spaces: Space[]
  notes: Note[]
  objectives: AnnualObjective[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setNotes?: (fn: (p: Note[]) => Note[]) => void
  setObjectives?: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
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

/** Parse a clearable date field: "none"/""/"null" → null; a valid YYYY-MM-DD → itself; else throw. */
function dateOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (s === '' || s === 'none' || s === 'null') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Bad date')
  return s
}

function hhmmToMin(v: unknown): number {
  const [h, m] = String(v ?? '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** Today as a local YYYY-MM-DD (not UTC — habit logging is day-local). */
function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Human-readable label for a proposed action's confirmation card. */
export function describeAction(
  a: ProposedAction,
  ctx: Pick<ActionContext, 'roadmapItems' | 'spaces' | 'notes' | 'objectives'>,
): string {
  const input = a.input

  if (a.tool === 'set_kr_health') {
    const id = stripId(input.kr_id, 'kr'); const k = ctx.roadmapItems.find(x => x.id === id)
    return `Set \u201c${k?.title ?? id}\u201d \u2192 ${String(input.health ?? '').replace('_', ' ')}`
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
    const bits = [
      input.title != null ? 'title' : null,
      input.body != null ? 'body' : null,
      input.kr_id != null ? 'KR link' : null,
      input.space_id != null ? 'move' : null,
    ].filter(Boolean).join(' + ')
    return `Edit note \u201c${n?.title || 'Untitled'}\u201d${bits ? ` (${bits})` : ''}`
  }

  if (a.tool === 'log_metric') {
    const k = ctx.roadmapItems.find(x => x.id === stripId(input.kr_id, 'kr'))
    return `Log ${String(input.value ?? '')}${k?.metric_unit ? ` ${k.metric_unit}` : ''} \u2192 ${k?.title ?? 'metric'}`
  }
  if (a.tool === 'log_habit') {
    const k = ctx.roadmapItems.find(x => x.id === stripId(input.kr_id, 'kr'))
    return `Mark \u201c${k?.title ?? 'habit'}\u201d done${input.date ? ` (${String(input.date)})` : ''}`
  }
  if (a.tool === 'create_weekly_action') {
    const k = ctx.roadmapItems.find(x => x.id === stripId(input.kr_id, 'kr'))
    return `Add action \u201c${String(input.title ?? '')}\u201d under ${k?.title ?? 'KR'}`
  }
  if (a.tool === 'create_kr') {
    const o = ctx.objectives.find(x => x.id === stripId(input.objective_id, 'obj'))
    const flavor = input.is_habit ? 'habit ' : input.is_metric ? 'metric ' : ''
    return `Create ${flavor}KR \u201c${String(input.title ?? '')}\u201d under ${o?.name ?? 'objective'}`
  }
  if (a.tool === 'update_kr') {
    const id = stripId(input.kr_id, 'kr'); const k = ctx.roadmapItems.find(x => x.id === id)
    const changes: string[] = []
    if (input.title != null) changes.push(`title \u2192 \u201c${String(input.title)}\u201d`)
    if (input.start_date != null) changes.push(`start ${String(input.start_date)}`)
    if (input.end_date != null) changes.push(`end ${String(input.end_date)}`)
    if (input.metric_unit != null) changes.push(`unit ${String(input.metric_unit)}`)
    if (input.target_value != null) changes.push(`target ${String(input.target_value)}`)
    return `Edit KR \u201c${k?.title ?? id}\u201d${changes.length ? `: ${changes.join(', ')}` : ''}`
  }
  if (a.tool === 'update_objective') {
    const id = stripId(input.objective_id, 'obj'); const o = ctx.objectives.find(x => x.id === id)
    const changes: string[] = []
    if (input.name != null) changes.push(`name \u2192 \u201c${String(input.name)}\u201d`)
    if (input.start_date != null) changes.push(`start ${String(input.start_date)}`)
    if (input.end_date != null) changes.push(`end ${String(input.end_date)}`)
    return `Edit objective \u201c${o?.name ?? id}\u201d${changes.length ? `: ${changes.join(', ')}` : ''}`
  }
  return a.tool
}

/** Execute a proposed action (only after approval). Throws on bad input or a
 *  missing target so the caller can surface a failure + retry. */
export async function runProposedAction(a: ProposedAction, ctx: ActionContext): Promise<void> {
  const input = a.input
  if (a.tool === 'set_kr_health') {
    const id = stripId(input.kr_id, 'kr'); const health = String(input.health ?? '') as HealthStatus
    if (!ctx.roadmapItems.some(k => k.id === id)) throw new Error('KR not found')
    await krsDb.update(id, { health_status: health })
    ctx.setRoadmapItems(prev => prev.map(k => k.id === id ? { ...k, health_status: health } : k))
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
    const patch: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at'>> = {}
    if (input.title != null) patch.title = String(input.title)
    if (input.body != null) patch.body = markdownToTipTapDoc(String(input.body))
    if (input.kr_id != null) {
      const r = String(input.kr_id)
      patch.roadmap_item_id = (r === 'none' || r === 'null' || r === '') ? null : stripId(input.kr_id, 'kr')
    }
    if (input.space_id != null) {
      patch.space_id = stripId(input.space_id, 'space') || null
      patch.notebook_id = null // moving to a space lands the note at its root
    }
    if (!Object.keys(patch).length) throw new Error('Nothing to update')
    const updated = await notesDb.update(id, patch)
    ctx.setNotes?.(prev => prev.map(n => n.id === id ? updated : n))
    return
  }
  if (a.tool === 'log_metric') {
    const id = stripId(input.kr_id, 'kr')
    const kr = ctx.roadmapItems.find(k => k.id === id)
    if (!kr) throw new Error('KR not found')
    if (!kr.is_metric) throw new Error('Not a metric KR')
    const value = Number(input.value)
    if (!Number.isFinite(value)) throw new Error('Bad value')
    const week = getMonday(input.date ? new Date(String(input.date) + 'T00:00:00') : new Date())
    await checkinsDb.metric.upsertWeekValue(id, week, value)
    return
  }
  if (a.tool === 'log_habit') {
    const id = stripId(input.kr_id, 'kr')
    const kr = ctx.roadmapItems.find(k => k.id === id)
    if (!kr) throw new Error('KR not found')
    if (!kr.is_habit) throw new Error('Not a habit KR')
    const date = input.date ? String(input.date) : todayLocal()
    try {
      await checkinsDb.habit.create(id, date)
    } catch (e) {
      // Unique (kr, date) violation = already logged that day → treat as success.
      const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : ''
      if (!/duplicate|unique/i.test(msg)) throw e
    }
    return
  }
  if (a.tool === 'create_weekly_action') {
    const id = stripId(input.kr_id, 'kr')
    if (!ctx.roadmapItems.some(k => k.id === id)) throw new Error('KR not found')
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('No title')
    await actionsDb.create({ roadmap_item_id: id, title, week_start: getMonday() })
    return
  }
  if (a.tool === 'create_kr') {
    const objId = stripId(input.objective_id, 'obj')
    const obj = ctx.objectives.find(o => o.id === objId)
    if (!obj) throw new Error('Objective not found')
    const title = String(input.title ?? '').trim()
    if (!title) throw new Error('No title')
    const isHabit = input.is_habit === true
    const isMetric = input.is_metric === true && !isHabit
    const created = await krsDb.create({
      space_id: obj.space_id,
      annual_objective_id: objId,
      title,
      quarter: null,
      sort_order: 0,
      status: 'active',
      health_status: 'not_started',
      is_habit: isHabit,
      is_metric: isMetric,
      metric_unit: isMetric && input.metric_unit != null ? String(input.metric_unit) : null,
      target_value: isMetric && input.target_value != null ? Number(input.target_value) : null,
    })
    ctx.setRoadmapItems(prev => [...prev, created])
    return
  }
  if (a.tool === 'update_kr') {
    const id = stripId(input.kr_id, 'kr')
    if (!ctx.roadmapItems.some(k => k.id === id)) throw new Error('KR not found')
    const patch: Partial<RoadmapItem> = {}
    if (input.title != null) patch.title = String(input.title)
    if (input.start_date != null) patch.start_date = dateOrNull(input.start_date)
    if (input.end_date != null) patch.end_date = dateOrNull(input.end_date)
    if (input.metric_unit != null) patch.metric_unit = String(input.metric_unit)
    if (input.target_value != null) {
      const v = Number(input.target_value)
      if (!Number.isFinite(v)) throw new Error('Bad target')
      patch.target_value = v
    }
    if (!Object.keys(patch).length) throw new Error('Nothing to update')
    const updated = await krsDb.update(id, patch)
    ctx.setRoadmapItems(prev => prev.map(k => k.id === id ? updated : k))
    return
  }
  if (a.tool === 'update_objective') {
    const id = stripId(input.objective_id, 'obj')
    if (!ctx.objectives.some(o => o.id === id)) throw new Error('Objective not found')
    const patch: Partial<AnnualObjective> = {}
    if (input.name != null) patch.name = String(input.name)
    if (input.start_date != null) patch.start_date = dateOrNull(input.start_date)
    if (input.end_date != null) patch.end_date = dateOrNull(input.end_date)
    if (!Object.keys(patch).length) throw new Error('Nothing to update')
    const updated = await objectivesDb.update(id, patch)
    ctx.setObjectives?.(prev => prev.map(o => o.id === id ? updated : o))
    return
  }
  throw new Error('Unknown action')
}
