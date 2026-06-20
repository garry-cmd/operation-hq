import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/plan-week — the AI planner's *judgment* half.
 *
 * The client sends a resolved, human-readable snapshot of the week (capacity
 * windows, schedulable items, busy time). Claude returns which day each item
 * should be worked, in scheduling order, with a short rationale and a skipped
 * list. It does NOT compute exact minutes — that deterministic math runs
 * client-side in calendarPlan.planFromAssignments around real busy time.
 *
 * Fails closed (503) without ANTHROPIC_API_KEY so the UI can say so plainly.
 */

interface PlanDay { date: string; name: string }
interface PlanCapacity { date: string; day: string; start: string; end: string; kind: string; space: string }
interface PlanItem { key: string; title: string; space: string; kind: string; minutes: number; due: string | null; health: string | null }
interface PlanBusy { date: string; day: string; start: string; end: string; title: string }

interface PlanRequest {
  weekStart: string
  days: PlanDay[]
  capacity: PlanCapacity[]
  items: PlanItem[]
  busy: PlanBusy[]
}

interface PlanResponse {
  rationale: string
  plan: { key: string; day: string; reason?: string }[]
  skipped: { key: string; reason?: string }[]
}

const MODEL = 'claude-sonnet-4-6'

function buildPrompt(body: PlanRequest): string {
  const days = body.days.map(d => `${d.name} = ${d.date}`).join(', ')

  const capacity = body.capacity.length
    ? body.capacity
        .map(c => `- ${c.day} ${c.start}–${c.end} · accepts ${c.kind === 'both' ? 'KR work or tasks' : c.kind === 'kr_action' ? 'KR work only' : 'tasks only'} · space: ${c.space}`)
        .join('\n')
    : '(none defined)'

  const items = body.items.length
    ? body.items
        .map(i => {
          const bits = [
            `[${i.key}]`,
            `"${i.title}"`,
            `${i.minutes}m`,
            i.kind === 'kr_action' ? 'KR work' : 'task',
            `space: ${i.space}`,
          ]
          if (i.due) bits.push(`due ${i.due}`)
          if (i.health) bits.push(`KR health: ${i.health}`)
          return `- ${bits.join(' · ')}`
        })
        .join('\n')
    : '(none)'

  const busy = body.busy.length
    ? body.busy.map(b => `- ${b.day} ${b.start}–${b.end} · ${b.title}`).join('\n')
    : '(nothing on the calendar yet)'

  return `You are the weekly planner for a solo founder's strategic operating system. You assign each piece of work to the day it should be done. You DO NOT pick exact start times — a deterministic scheduler places the minutes after you choose the day. Your job is judgment: priority, sequencing, and which day.

THE WEEK (Mon–Sun): ${days}

CAPACITY WINDOWS (the only times work can be scheduled — an item can only land in a window whose kind and space match it):
${capacity}

BUSY (real meetings + already-committed blocks — these days/times are partly taken):
${busy}

ITEMS TO SCHEDULE THIS WEEK:
${items}

RULES
- Off-track or blocked KR work comes first — protect the strategic big rocks before routine tasks.
- An item can only go on a day that has a capacity window matching its kind (KR work vs task) AND its space (or an "Any" window). If no matching window exists on any day, skip it with a reason.
- Respect due dates: don't schedule a task after it's due.
- Use judgment a good chief of staff would: batch same-space work, protect a block of deep work rather than fragmenting it, and don't cram a day that's already heavy with meetings — spread load across the week.
- It's fine to skip items if the week is genuinely full. Be honest in the rationale about what didn't fit and why.

OUTPUT — return ONLY valid JSON, no markdown, no prose outside the JSON:
{
  "rationale": "2–4 plain sentences on how you shaped the week",
  "plan": [ { "key": "<item key exactly as given>", "day": "YYYY-MM-DD", "reason": "<short>" } ],
  "skipped": [ { "key": "<item key>", "reason": "<why it didn't fit>" } ]
}
The "plan" array order IS the scheduling priority order (earlier = placed first). Every item must appear in either "plan" or "skipped".`
}

function parsePlan(text: string): PlanResponse {
  let t = text.trim()
  // strip ```json fences if present
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  // tolerate leading/trailing prose by grabbing the outermost object
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first > 0 || last < t.length - 1) t = t.slice(first, last + 1)
  const parsed = JSON.parse(t)
  return {
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    plan: Array.isArray(parsed.plan) ? parsed.plan : [],
    skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
  }
}

export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI planning is not configured — set ANTHROPIC_API_KEY in the environment.' },
      { status: 503 },
    )
  }

  let body: PlanRequest
  try {
    body = (await req.json()) as PlanRequest
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!body.weekStart || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'weekStart and items required' }, { status: 400 })
  }
  if (body.items.length === 0) {
    return NextResponse.json({ rationale: 'Nothing to schedule this week.', plan: [], skipped: [] })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: buildPrompt(body) }],
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json(
        { error: `planner upstream ${res.status}`, detail: detail.slice(0, 500) },
        { status: 502 },
      )
    }

    const data = await res.json()
    const text: string = Array.isArray(data?.content)
      ? data.content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text ?? '').join('\n')
      : ''
    if (!text.trim()) return NextResponse.json({ error: 'empty planner response' }, { status: 502 })

    let plan: PlanResponse
    try {
      plan = parsePlan(text)
    } catch {
      return NextResponse.json({ error: 'planner returned unparseable output' }, { status: 502 })
    }
    return NextResponse.json(plan)
  } catch {
    return NextResponse.json({ error: 'planner request failed' }, { status: 502 })
  }
}
