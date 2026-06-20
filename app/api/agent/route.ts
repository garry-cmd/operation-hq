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

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface AgentRequest { messages: ChatMessage[]; today: string; weekStart: string }

const PERSONA = `You are the chief of staff for the operator of "Operation HQ", a solo founder's strategic operating system. You have their complete current state below (spaces = distinct ventures/areas, KRs = quarterly key results with a health status, weekly actions, tasks, calendar, reflections).

Your job is to be a sharp, trusted chief of staff: know the whole operation cold, surface what's slipping before it's a fire, prioritize ruthlessly, and answer with specifics — always reference real KRs, tasks, and spaces by name, never in the abstract. When the operator asks "what should I focus on" or "what's at risk", lead with the highest-leverage thing (off-track or blocked KRs, overdue commitments, an overloaded week), not a flat list.

Hard rules:
- You ADVISE and TRIAGE; you do NOT change anything in the system. You cannot mark tasks done, move blocks, or edit KRs. When action is needed, tell the operator exactly what to do and where — e.g. "run Plan My Week on the Calendar", "this Stellar KR is blocked — decide the unblock", "mark these three done if they're actually finished". Never claim or imply you made a change.
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
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return NextResponse.json({ error: `agent upstream ${res.status}`, detail: detail.slice(0, 400) }, { status: 502 })
    }

    const data = await res.json()
    const reply: string = Array.isArray(data?.content)
      ? data.content.filter((b: { type?: string }) => b?.type === 'text').map((b: { text?: string }) => b.text ?? '').join('\n').trim()
      : ''
    if (!reply) return NextResponse.json({ error: 'empty agent response' }, { status: 502 })

    return NextResponse.json({ reply })
  } catch {
    return NextResponse.json({ error: 'agent request failed' }, { status: 502 })
  }
}
