import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'
import { buildAgentContext } from '@/lib/agentContext'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent — the HQ chief-of-staff chat.
 *
 * Builds a fresh full-state snapshot of HQ server-side each turn (so the agent
 * always reasons over current data), injects it as the system prompt, appends
 * the conversation, and returns Claude's reply. Read-only: the agent advises
 * and triages but does not mutate — when action is needed it tells the user
 * what to do. Stateless (the client sends the running message history).
 *
 * Fails closed (503) without ANTHROPIC_API_KEY.
 */

const MODEL = 'claude-sonnet-4-6'

const HEALTH_VALUES = ['not_started', 'backlog', 'on_track', 'off_track', 'waiting', 'blocked', 'done']

// Action tools. Calling one is a PROPOSAL, not an execution — the server never
// runs the mutation. It extracts the calls and returns them to the client,
// which renders a confirmation card and executes on the user's approval.
const TOOLS = [
  {
    name: 'complete_task',
    description: 'Propose marking a task as done. Use the task id shown in [task:…] in the state.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'The task id (the value after task: in the bracket, or the whole [task:…] token).' } },
      required: ['task_id'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Propose changing a task\u2019s due date.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id from [task:…].' },
        due_date: { type: 'string', description: 'New due date, YYYY-MM-DD.' },
      },
      required: ['task_id', 'due_date'],
    },
  },
  {
    name: 'add_task',
    description: 'Propose creating a new task. Optionally assign it to a space and a due date.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title.' },
        space_id: { type: 'string', description: 'Optional space id from [space:…]. Omit for an inbox task.' },
        due_date: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_kr_health',
    description: 'Propose changing a KR\u2019s health status (e.g. mark it on_track or blocked).',
    input_schema: {
      type: 'object',
      properties: {
        kr_id: { type: 'string', description: 'The KR id from [kr:…].' },
        health: { type: 'string', enum: HEALTH_VALUES, description: 'New health status.' },
      },
      required: ['kr_id', 'health'],
    },
  },
]

interface ProposedAction { tool: string; input: Record<string, unknown> }


interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface AgentRequest { messages: ChatMessage[]; today: string; weekStart: string }

const PERSONA = `You are the chief of staff for the operator of "Operation HQ", a solo founder's strategic operating system. You have their complete current state below (spaces = distinct ventures/areas, KRs = quarterly key results with a health status, weekly actions, tasks, calendar, reflections).

Your job is to be a sharp, trusted chief of staff: know the whole operation cold, surface what's slipping before it's a fire, prioritize ruthlessly, and answer with specifics — always reference real KRs, tasks, and spaces by name, never in the abstract. When the operator asks "what should I focus on" or "what's at risk", lead with the highest-leverage thing (off-track or blocked KRs, overdue commitments, an overloaded week), not a flat list.

Hard rules:
- You can PROPOSE actions with your tools: complete a task, reschedule a task, add a task, set a KR's health. Calling a tool does NOT execute it — it surfaces a confirmation card the operator approves with one tap. Propose freely when an action is clearly warranted and specific, but always say in plain text what you're proposing and why, and never claim something is done — say you've proposed it / queued it for approval.
- For anything you have no tool for (moving calendar blocks, unblocking a KR, planning the week), advise instead: tell the operator exactly what to do and where — e.g. "run Plan My Week on the Calendar", "this Stellar KR is blocked — decide the unblock".
- Don't over-propose. One clear ask beats five speculative ones. When unsure, ask or advise rather than firing a proposal.
- Be direct and concise. Skip preamble. Match the operator's energy and length. Use short paragraphs or simple dashed lists; no heavy formatting.
- Ground every claim in the state below. If something isn't in the state, say you don't see it rather than inventing it.
- A blocked or off-track KR is more important than a tidy task list. Protect the strategic big rocks.`

export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'The agent is not configured — set ANTHROPIC_API_KEY in the environment.' },
      { status: 503 },
    )
  }

  let body: AgentRequest
  try {
    body = (await req.json()) as AgentRequest
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }
  if (!body.today || !body.weekStart) {
    return NextResponse.json({ error: 'today and weekStart required' }, { status: 400 })
  }

  const messages = body.messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
  if (messages.length === 0) return NextResponse.json({ error: 'no valid messages' }, { status: 400 })

  let context: string
  try {
    context = await buildAgentContext({ today: body.today, weekStart: body.weekStart })
  } catch {
    return NextResponse.json({ error: 'could not load HQ state' }, { status: 500 })
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
        max_tokens: 1500,
        system: `${PERSONA}\n\n---\n\n${context}`,
        tools: TOOLS,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ error: `agent upstream ${res.status}`, detail: detail.slice(0, 400) }, { status: 502 })
    }

    const data = await res.json()
    const blocks: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> =
      Array.isArray(data?.content) ? data.content : []

    const reply = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n').trim()
    const actions: ProposedAction[] = blocks
      .filter(b => b.type === 'tool_use' && typeof b.name === 'string')
      .map(b => ({ tool: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }))

    if (!reply && actions.length === 0) return NextResponse.json({ error: 'empty agent response' }, { status: 502 })

    return NextResponse.json({
      reply: reply || (actions.length ? 'I’ve proposed the following — approve below.' : ''),
      actions,
    })
  } catch {
    return NextResponse.json({ error: 'agent request failed' }, { status: 502 })
  }
}
