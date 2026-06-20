import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

/**
 * agentContext — the agent's "knows everything" layer. One server-side call
 * assembles a full, current snapshot of HQ (spaces, KRs + health, this week's
 * actions, open/overdue tasks, capacity, this week's calendar, recent
 * reflections, recent notes) and serializes it into a compact text block for
 * the model's system prompt.
 *
 * Read-only and reusable: today it feeds the chief-of-staff chat; later the
 * same snapshot backs tool-calling and the voice front-end. The caller passes
 * `today` + `weekStart` (the client's local week) so the snapshot lines up with
 * what the user sees, rather than the server's UTC clock.
 */

const HEALTH_LABEL: Record<string, string> = {
  not_started: 'not started', backlog: 'backlog', on_track: 'on track',
  off_track: 'OFF TRACK', waiting: 'waiting', blocked: 'BLOCKED', done: 'done',
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60), m = min % 60
  const ampm = h24 < 12 ? 'am' : 'pm'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Row { [k: string]: unknown }
const str = (v: unknown): string => (v == null ? '' : String(v))
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

export async function buildAgentContext(input: { today: string; weekStart: string }): Promise<string> {
  const admin = getSupabaseAdmin()
  const { today, weekStart } = input
  const weekEnd = addDays(weekStart, 6)
  const horizon = addDays(today, 21)

  const [spacesR, krsR, actionsR, tasksR, capR, blocksR, reviewsR, notesR, metricR, objsR] = await Promise.all([
    admin.from('spaces').select('id,name,sort_order').order('sort_order'),
    admin.from('roadmap_items')
      .select('id,space_id,title,quarter,health_status,progress,is_parked,is_habit,is_metric,metric_unit,metric_direction,start_value,target_value,start_date,end_date')
      .eq('is_parked', false),
    admin.from('weekly_actions').select('id,roadmap_item_id,title,completed,week_start').eq('week_start', weekStart),
    admin.from('tasks')
      .select('id,space_id,title,priority,due_date,deadline_date,completed_at,parent_task_id,roadmap_item_id')
      .is('completed_at', null).is('parent_task_id', null),
    admin.from('calendar_capacity_blocks').select('space_id,kind,label,day_of_week,start_minute,end_minute').order('day_of_week'),
    admin.from('calendar_blocks').select('title,block_date,start_minute,end_minute,status,space_id').gte('block_date', weekStart).lte('block_date', weekEnd),
    admin.from('weekly_reviews').select('space_id,week_start,rating,win,slipped,adjust_notes,krs_hit,krs_total,closed_at')
      .not('closed_at', 'is', null).order('week_start', { ascending: false }).limit(6),
    admin.from('notes').select('id,title,space_id,updated_at,roadmap_item_id').order('updated_at', { ascending: false }).limit(15),
    admin.from('metric_checkins').select('roadmap_item_id,value,week_start').order('week_start', { ascending: false }),
    admin.from('annual_objectives').select('id,name,space_id,status').eq('status', 'active'),
  ])

  const spaces = (spacesR.data ?? []) as Row[]
  const krs = (krsR.data ?? []) as Row[]
  const actions = (actionsR.data ?? []) as Row[]
  const tasks = (tasksR.data ?? []) as Row[]
  const caps = (capR.data ?? []) as Row[]
  const blocks = (blocksR.data ?? []) as Row[]
  const reviews = (reviewsR.data ?? []) as Row[]
  const notes = (notesR.data ?? []) as Row[]
  const metrics = (metricR.data ?? []) as Row[]
  const objs = (objsR.data ?? []) as Row[]
  const objsBySpace = new Map<string, Row[]>()
  for (const o of objs) {
    const sid = str(o.space_id)
    if (!objsBySpace.has(sid)) objsBySpace.set(sid, [])
    objsBySpace.get(sid)!.push(o)
  }

  const spaceName = new Map(spaces.map(s => [str(s.id), str(s.name)]))
  const krById = new Map(krs.map(k => [str(k.id), k]))

  // latest metric reading per KR
  const latestMetric = new Map<string, number>()
  for (const m of metrics) {
    const id = str(m.roadmap_item_id)
    if (!latestMetric.has(id)) { const v = num(m.value); if (v != null) latestMetric.set(id, v) }
  }

  // actions grouped by KR
  const actionsByKr = new Map<string, Row[]>()
  for (const a of actions) {
    const id = str(a.roadmap_item_id)
    const arr = actionsByKr.get(id) ?? []; arr.push(a); actionsByKr.set(id, arr)
  }

  // open tasks within the horizon (overdue + next 3 weeks + undated), grouped by space
  const relevantTasks = tasks.filter(t => {
    const due = str(t.due_date)
    return !due || due <= horizon
  })
  const tasksBySpace = new Map<string, Row[]>()
  for (const t of relevantTasks) {
    const sid = str(t.space_id) || '∅'
    const arr = tasksBySpace.get(sid) ?? []; arr.push(t); tasksBySpace.set(sid, arr)
  }

  const lines: string[] = []
  const todayDow = DOW[(new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7]
  lines.push(`# HQ STATE — ${todayDow} ${today} (current week ${weekStart} → ${weekEnd})`)
  lines.push('')

  // ── per space: KRs, their actions this week, then the space's open tasks ──
  for (const s of spaces) {
    const sid = str(s.id)
    const spaceKrs = krs.filter(k => str(k.space_id) === sid && str(k.health_status) !== 'done')
    const spaceTasks = (tasksBySpace.get(sid) ?? [])
    if (spaceKrs.length === 0 && spaceTasks.length === 0) continue

    lines.push(`## ${str(s.name)} [space:${sid}]`)

    for (const o of objsBySpace.get(sid) ?? []) lines.push(`- Objective [obj:${str(o.id)}]: ${str(o.name)}`)

    for (const k of spaceKrs) {
      const flavor = k.is_habit ? 'habit' : k.is_metric ? 'metric' : 'outcome'
      const health = HEALTH_LABEL[str(k.health_status)] ?? str(k.health_status)
      let metricBit = ''
      if (k.is_metric) {
        const cur = latestMetric.get(str(k.id))
        const tgt = num(k.target_value)
        const unit = str(k.metric_unit)
        metricBit = ` [${cur ?? '—'}${tgt != null ? ` / ${tgt}` : ''}${unit ? ` ${unit}` : ''}]`
      } else {
        const p = num(k.progress)
        metricBit = p != null ? ` [${Math.round(p)}%]` : ''
      }
      const q = str(k.quarter) ? ` · ${str(k.quarter)}` : ''
      const window = str(k.end_date) ? ` · ends ${str(k.end_date)}${str(k.end_date) < today ? ' (OVERDUE)' : ''}` : ''
      lines.push(`- KR [kr:${str(k.id)}] (${flavor}, ${health})${metricBit}: ${str(k.title)}${q}${window}`)

      const acts = actionsByKr.get(str(k.id)) ?? []
      for (const a of acts) {
        lines.push(`    · action [${a.completed ? 'done' : 'open'}]: ${str(a.title)}`)
      }
    }

    if (spaceTasks.length) {
      const sorted = spaceTasks.sort((a, b) => (str(a.due_date) || '9999') < (str(b.due_date) || '9999') ? -1 : 1)
      lines.push(`  open tasks (${spaceTasks.length}):`)
      for (const t of sorted.slice(0, 20)) {
        const due = str(t.due_date)
        const overdue = due && due < today ? ' ⚠OVERDUE' : ''
        const dl = str(t.deadline_date) ? ` ⚑deadline ${str(t.deadline_date)}` : ''
        const pr = num(t.priority)
        const prBit = pr != null && pr <= 2 ? ` P${pr}` : ''
        lines.push(`    · [task:${str(t.id)}] ${str(t.title)}${due ? ` (due ${due}${overdue})` : ''}${dl}${prBit}`)
      }
      if (spaceTasks.length > 20) lines.push(`    · …and ${spaceTasks.length - 20} more`)
    }
    lines.push('')
  }

  // ── tasks with no space ──
  const noSpace = tasksBySpace.get('∅') ?? []
  if (noSpace.length) {
    lines.push(`## (no space) — inbox tasks`)
    for (const t of noSpace.slice(0, 15)) {
      const due = str(t.due_date)
      const overdue = due && due < today ? ' ⚠OVERDUE' : ''
      lines.push(`    · [task:${str(t.id)}] ${str(t.title)}${due ? ` (due ${due}${overdue})` : ''}`)
    }
    lines.push('')
  }

  // ── this week's calendar ──
  if (blocks.length) {
    lines.push(`## This week's calendar (${blocks.length} blocks)`)
    const byDate = new Map<string, Row[]>()
    for (const b of blocks) { const d = str(b.block_date); const arr = byDate.get(d) ?? []; arr.push(b); byDate.set(d, arr) }
    for (const d of [...byDate.keys()].sort()) {
      const dow = DOW[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]
      const items = (byDate.get(d) ?? []).sort((a, b) => num(a.start_minute)! - num(b.start_minute)!)
      const parts = items.map(b => `${minutesToLabel(num(b.start_minute)!)} ${str(b.title)}${str(b.status) === 'proposed' ? ' (proposed)' : ''}`)
      lines.push(`- ${dow} ${d}: ${parts.join(' · ')}`)
    }
    lines.push('')
  }

  // ── capacity windows (the reserved template) ──
  if (caps.length) {
    lines.push('## Capacity template (reserved working windows)')
    for (const c of caps) {
      const sp = str(c.space_id) ? (spaceName.get(str(c.space_id)) ?? 'space') : 'Any'
      const kind = str(c.kind) === 'both' ? 'KR or task' : str(c.kind) === 'kr_action' ? 'KR work' : 'tasks'
      lines.push(`- ${DOW[num(c.day_of_week) ?? 0]} ${minutesToLabel(num(c.start_minute)!)}–${minutesToLabel(num(c.end_minute)!)} · ${kind} · ${sp}`)
    }
    lines.push('')
  }

  // ── recent reflections ──
  if (reviews.length) {
    lines.push('## Recent weekly reflections')
    for (const r of reviews.slice(0, 5)) {
      const sp = spaceName.get(str(r.space_id)) ?? 'space'
      const bits = [`${sp} · week ${str(r.week_start)} · rating ${str(r.rating)} · ${str(r.krs_hit)}/${str(r.krs_total)} KRs`]
      if (str(r.win)) bits.push(`win: ${str(r.win)}`)
      if (str(r.slipped)) bits.push(`slipped: ${str(r.slipped)}`)
      lines.push(`- ${bits.join(' — ')}`)
    }
    lines.push('')
  }

  // ── recent notes ──
  if (notes.length) {
    lines.push('## Recently touched notes')
    for (const n of notes) {
      const sp = str(n.space_id) ? (spaceName.get(str(n.space_id)) ?? '') : 'Inbox'
      const linked = str(n.roadmap_item_id) ? ` → linked to KR "${str(krById.get(str(n.roadmap_item_id))?.title ?? '')}"` : ''
      lines.push(`- [note:${str(n.id)}] "${str(n.title) || 'Untitled'}"${sp ? ` (${sp})` : ''}${linked}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
