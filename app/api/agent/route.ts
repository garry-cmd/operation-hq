import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'
import { buildAgentContext } from '@/lib/agentContext'
import { TOOLS, WEB_SEARCH_TOOL, type ProposedAction } from '@/lib/agentTools'

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
interface AgentRequest { messages: ChatMessage[]; today: string; weekStart: string; mode?: 'text' | 'voice' }

const VOICE_STYLE = `

---

You are replying through a VOICE interface — your words will be spoken aloud, not read.
- Talk the way you'd speak: short natural sentences. No markdown, no bullet points, no headings, no emoji, no URLs, no tables.
- Lead with the answer in the first sentence. Keep it to 1–4 sentences unless asked for detail.
- If you propose an action, say what it is and ask for a yes in one sentence (e.g. "I can add dinner with Melissa Sunday at six — want me to?"). The operator can't see a screen, so the spoken proposal must stand on its own.
- After you propose, the operator may answer by voice — "yes" / "do it" runs it, "no" / "skip" drops it. Phrase the proposal as one clear yes/no question so a one-word spoken answer is unambiguous. If you propose several actions at once, note they'll all run on a "yes".`

const PERSONA = `You are the chief of staff for the operator of "Operation HQ", a solo founder's strategic operating system. You have their complete current state below (spaces = distinct ventures/areas, KRs = quarterly key results with a health status, weekly actions, tasks, calendar, reflections).

Your job is to be a sharp, trusted chief of staff: know the whole operation cold, surface what's slipping before it's a fire, prioritize ruthlessly, and answer with specifics — always reference real KRs, tasks, and spaces by name, never in the abstract. When the operator asks "what should I focus on" or "what's at risk", lead with the highest-leverage thing (off-track or blocked KRs, overdue commitments, an overloaded week), not a flat list.

Hard rules:
- You can PROPOSE actions with your tools: complete a task, reschedule a task, add a task, edit a task (title/due/priority/description), add a calendar event, set a KR's health, create a note, append to a note, and edit a note (rename / rewrite). Calling a tool does NOT execute it — it surfaces a confirmation card the operator approves with one tap. Propose freely when an action is clearly warranted and specific, but always say in plain text what you're proposing and why, and never claim something is done — say you've proposed it / queued it for approval. Use create_note for things worth recording or reading (meeting notes, summaries, ideas, reference) rather than things to do; its body is Markdown, so use real structure — headings, lists, checkboxes, and tables (GitHub pipe syntax) — when it helps. To add to an existing note use append_note (keeps its content); use update_note only to rename or fully rewrite.
- You can SEARCH THE WEB. Use it whenever the answer depends on real, current, real-world facts you can't get from the state below — venues, hours, prices, addresses, news, people, products. Never invent specifics like business names, addresses, or hours; search and cite what you find, or say you couldn't confirm it.
- For anything you have no tool for (moving existing calendar blocks, unblocking a KR, planning the week), advise instead: tell the operator exactly what to do and where — e.g. "run Plan My Week on the Calendar".
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
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: `${PERSONA}\n\n---\n\n${context}${body.mode === 'voice' ? VOICE_STYLE : ''}`,
        tools: [...TOOLS, WEB_SEARCH_TOOL],
        stream: true,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '')
      return NextResponse.json({ error: `agent upstream ${upstream.status}`, detail: detail.slice(0, 400) }, { status: 502 })
    }

    // Proxy Anthropic's SSE into a simple NDJSON stream the client can read:
    //   {"t":"text","d":"…"}  text chunks, forwarded live
    //   {"t":"actions","a":[…]} proposed tool calls, emitted once assembled
    //   {"t":"error","e":"…"}  mid-stream failure
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader()
        const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'))
        const blocks = new Map<number, { type?: string; name?: string; json: string }>()
        let buf = ''
        let emittedText = false   // have we forwarded any reply text yet?
        let lastChar = ''         // last char forwarded
        let pendingBoundary = false // a text block reopened after prior text (maybe needs a space bridge), to avoid double spaces
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const events = buf.split('\n\n')
            buf = events.pop() ?? ''
            for (const evt of events) {
              const dataLine = evt.split('\n').find(l => l.startsWith('data:'))
              if (!dataLine) continue
              const raw = dataLine.slice(5).trim()
              if (!raw) continue
              let p: { type?: string; index?: number; content_block?: { type?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string } }
              try { p = JSON.parse(raw) } catch { continue }
              if (p.type === 'content_block_start' && typeof p.index === 'number') {
                blocks.set(p.index, { type: p.content_block?.type, name: p.content_block?.name, json: '' })
                // A text block opening after we've already sent text means the model
                // paused (e.g. for a web search) and resumed. Decide whether to bridge
                // with a space once we see the next delta — so we never double-space.
                if (p.content_block?.type === 'text' && emittedText) pendingBoundary = true
              } else if (p.type === 'content_block_delta' && typeof p.index === 'number') {
                if (p.delta?.type === 'text_delta' && p.delta.text) {
                  let text = p.delta.text
                  if (pendingBoundary) {
                    pendingBoundary = false
                    const prevWs = !lastChar || /\s/.test(lastChar)
                    // Bridge only a genuine word collision ("hours.Perfect"): prev
                    // has no trailing space and the next block starts with a letter
                    // or digit. Never before punctuation (avoids "Townsend ,").
                    if (!prevWs && /^[\p{L}\p{N}]/u.test(text)) text = ' ' + text
                  }
                  send({ t: 'text', d: text })
                  emittedText = true; lastChar = text.slice(-1)
                } else if (p.delta?.type === 'input_json_delta') {
                  const b = blocks.get(p.index); if (b) b.json += p.delta.partial_json ?? ''
                }
              }
            }
          }
          const actions: ProposedAction[] = []
          for (const b of blocks.values()) {
            if (b.type === 'tool_use' && b.name) {
              let input: Record<string, unknown> = {}
              try { input = b.json ? JSON.parse(b.json) : {} } catch { input = {} }
              actions.push({ tool: b.name, input })
            }
          }
          if (actions.length) send({ t: 'actions', a: actions })
          controller.close()
        } catch {
          try { send({ t: 'error', e: 'stream interrupted' }) } catch { /* controller may be closed */ }
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
    })
  } catch {
    return NextResponse.json({ error: 'agent request failed' }, { status: 502 })
  }
}
