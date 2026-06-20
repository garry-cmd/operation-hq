import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'
import { buildAgentContext } from '@/lib/agentContext'
import { TOOLS, READ_TOOLS, READ_TOOL_NAMES, WEB_SEARCH_TOOL, type ProposedAction } from '@/lib/agentTools'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { extractNoteText } from '@/lib/noteText'
import type { NoteBody } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent — the HQ chief-of-staff chat.
 *
 * Builds a fresh full-state snapshot of HQ server-side each turn (so the agent
 * always reasons over current data), injects it as the system prompt, appends
 * the conversation, and streams Claude's reply.
 *
 * Two classes of tools:
 *  - PROPOSE-FIRST mutations (TOOLS) + web_search are handled as before: text is
 *    streamed live; mutation tool calls are assembled and emitted as an `actions`
 *    frame for the client to surface as Approve cards (never auto-executed).
 *  - READ tools (READ_TOOLS, currently read_note) are OUR custom tools that we
 *    execute SERVER-SIDE mid-turn and feed back to the model as a tool_result, so
 *    the model can reason over the result in the same logical turn. This is a
 *    bounded loop: stream a pass → if the model called a read tool, run it, append
 *    the result, and call again → repeat until a pass has no read calls, then emit
 *    that pass's mutation proposals (if any) and close.
 *
 * Stateless (the client sends the running message history). Fails closed (503)
 * without ANTHROPIC_API_KEY.
 */

const MODEL = 'claude-sonnet-4-6'
const MAX_PASSES = 4 // 1 initial + up to 3 read-tool continuations (guards runaway loops)

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface AgentRequest { messages: ChatMessage[]; today: string; weekStart: string; mode?: 'text' | 'voice' }

// Anthropic content-block shapes we build for continuation turns.
type ApiBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
type ApiMessage = { role: 'user' | 'assistant'; content: string | ApiBlock[] }

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
- You can READ a note's full current contents with read_note (pass the id from [note:…]). The state below lists recent notes by title only, not their text — so when the operator asks what a note says, to summarize or extract from it, or before you append_note / update_note (so you extend or rewrite it accurately instead of blindly), call read_note first. Its result comes back to you in the same turn; read, then answer or propose.
- You can PROPOSE actions with your tools: complete a task, reschedule a task, add a task, edit a task (title/due/priority/description, link it to a KR, or move it to a space), add a calendar event, set a KR's health, log a metric reading, mark a habit done, create a weekly action under a KR, create a new KR under an objective, create a note, append to a note, and edit a note (rename / rewrite / link / move). Calling one of THESE tools does NOT execute it — it surfaces a confirmation card the operator approves with one tap. Propose freely when an action is clearly warranted and specific, but always say in plain text what you're proposing and why, and never claim something is done — say you've proposed it / queued it for approval. Use create_note for things worth recording or reading (meeting notes, summaries, ideas, reference) rather than things to do; its body is Markdown, so use real structure — headings, lists, checkboxes, and tables (GitHub pipe syntax) — when it helps. To add to an existing note use append_note (keeps its content); use update_note only to rename or fully rewrite. Log a metric only for a KR marked (metric) and a habit only for one marked (habit); create a KR under one of the objectives shown as [obj:…].
- You can SEARCH THE WEB. Use it whenever the answer depends on real, current, real-world facts you can't get from the state below — venues, hours, prices, addresses, news, people, products. Never invent specifics like business names, addresses, or hours; search and cite what you find, or say you couldn't confirm it.
- For anything you have no tool for (moving existing calendar blocks, unblocking a KR, planning the week), advise instead: tell the operator exactly what to do and where — e.g. "run Plan My Week on the Calendar".
- Don't over-propose. One clear ask beats five speculative ones. When unsure, ask or advise rather than firing a proposal.
- Be direct and concise. Skip preamble. Match the operator's energy and length. Use short paragraphs or simple dashed lists; no heavy formatting.
- Ground every claim in the state below. If something isn't in the state, say you don't see it rather than inventing it.
- A blocked or off-track KR is more important than a tidy task list. Protect the strategic big rocks.`

/** Normalize a [note:uuid] / note:uuid / uuid token to a bare id. */
function normalizeNoteId(v: unknown): string {
  return String(v ?? '').trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^note:/, '').trim()
}

/** Run a read_note tool call server-side; returns text to feed back as a tool_result. */
async function execReadNote(input: Record<string, unknown>): Promise<string> {
  const id = normalizeNoteId(input.note_id)
  if (!id) return 'No note_id was provided.'
  try {
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.from('notes').select('title,body').eq('id', id).maybeSingle()
    if (error || !data) return `No note found for id ${id}.`
    const title = (data.title as string) || 'Untitled'
    const text = extractNoteText((data.body as NoteBody | null) ?? null)
    let out = `Title: ${title}\n\n${text || '(this note has no text content)'}`
    if (out.length > 8000) out = out.slice(0, 8000) + '\n…(note truncated)'
    return out
  } catch {
    return `Could not read note ${id}.`
  }
}

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

  const system = `${PERSONA}\n\n---\n\n${context}${body.mode === 'voice' ? VOICE_STYLE : ''}`

  // Proxy Anthropic's SSE into a simple NDJSON stream the client can read:
  //   {"t":"text","d":"…"}     text chunks, forwarded live
  //   {"t":"actions","a":[…]}  proposed mutation tool calls, emitted once (terminal pass)
  //   {"t":"error","e":"…"}    mid-stream failure
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + '\n'))

      // Boundary-bridge state, persisted ACROSS passes so the space-bridge also
      // works at the seam between a streamed pass and its read-tool continuation.
      let emittedText = false
      let lastChar = ''

      // One streamed call to Anthropic. Forwards text deltas live; returns the
      // turn's content blocks in order (text accumulated, tool_use assembled).
      type Block =
        | { kind: 'text'; text: string }
        | { kind: 'tool_use'; id: string; name: string; json: string }
      async function streamPass(convo: ApiMessage[]): Promise<Block[]> {
        const upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey as string,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1500,
            system,
            tools: [...TOOLS, ...READ_TOOLS, WEB_SEARCH_TOOL],
            stream: true,
            messages: convo,
          }),
        })
        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => '')
          throw new Error(`agent upstream ${upstream.status}: ${detail.slice(0, 200)}`)
        }

        // Per-index block scratch. We only keep text + tool_use; server tool blocks
        // (server_tool_use / web_search_tool_result) are forwarded as live text but
        // intentionally NOT replayed into continuation turns (keeps the assistant
        // turn valid without fragile verbatim replay of server-tool results).
        const scratch = new Map<number, { type?: string; id?: string; name?: string; json: string; text: string }>()
        const order: number[] = []
        const reader = upstream.body.getReader()
        let buf = ''
        let pendingBoundary = false
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
            let p: { type?: string; index?: number; content_block?: { type?: string; id?: string; name?: string }; delta?: { type?: string; text?: string; partial_json?: string } }
            try { p = JSON.parse(raw) } catch { continue }
            if (p.type === 'content_block_start' && typeof p.index === 'number') {
              if (!scratch.has(p.index)) order.push(p.index)
              scratch.set(p.index, { type: p.content_block?.type, id: p.content_block?.id, name: p.content_block?.name, json: '', text: '' })
              // A text block opening after we've already sent text means the model
              // paused (web search, or a prior read-tool pass) and resumed. Decide
              // whether to bridge with a space once the next delta arrives.
              if (p.content_block?.type === 'text' && emittedText) pendingBoundary = true
            } else if (p.type === 'content_block_delta' && typeof p.index === 'number') {
              const b = scratch.get(p.index)
              if (p.delta?.type === 'text_delta' && p.delta.text) {
                let text = p.delta.text
                if (pendingBoundary) {
                  pendingBoundary = false
                  const prevWs = !lastChar || /\s/.test(lastChar)
                  // Bridge only a genuine word collision ("hours.Perfect"): prev has
                  // no trailing space and the next starts with a letter/digit. Never
                  // before punctuation (avoids "Townsend ,").
                  if (!prevWs && /^[\p{L}\p{N}]/u.test(text)) text = ' ' + text
                }
                if (b) b.text += text
                send({ t: 'text', d: text })
                emittedText = true; lastChar = text.slice(-1)
              } else if (p.delta?.type === 'input_json_delta') {
                if (b) b.json += p.delta.partial_json ?? ''
              }
            }
          }
        }

        const blocks: Block[] = []
        for (const idx of order) {
          const b = scratch.get(idx)
          if (!b) continue
          if (b.type === 'text') {
            if (b.text) blocks.push({ kind: 'text', text: b.text })
          } else if (b.type === 'tool_use' && b.name && b.id) {
            blocks.push({ kind: 'tool_use', id: b.id, name: b.name, json: b.json })
          }
          // server_tool_use / web_search_tool_result: ignored for replay (their
          // visible text already streamed to the client).
        }
        return blocks
      }

      function parseInput(json: string): Record<string, unknown> {
        try { return json ? (JSON.parse(json) as Record<string, unknown>) : {} } catch { return {} }
      }

      try {
        const convo: ApiMessage[] = messages.map(m => ({ role: m.role, content: m.content }))
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          const blocks = await streamPass(convo)
          const toolUses = blocks.filter((b): b is Extract<Block, { kind: 'tool_use' }> => b.kind === 'tool_use')
          const reads = toolUses.filter(t => READ_TOOL_NAMES.has(t.name))
          const mutations = toolUses.filter(t => !READ_TOOL_NAMES.has(t.name))

          // Continue the loop only if the model asked to READ and we have budget.
          if (reads.length && pass < MAX_PASSES - 1) {
            // Replay this turn (text + every tool_use) as the assistant message, then
            // answer EACH tool_use with a tool_result (Anthropic requires all be answered).
            const assistantContent: ApiBlock[] = blocks.map(b =>
              b.kind === 'text'
                ? { type: 'text', text: b.text }
                : { type: 'tool_use', id: b.id, name: b.name, input: parseInput(b.json) },
            )
            const results: ApiBlock[] = []
            for (const r of reads) {
              results.push({ type: 'tool_result', tool_use_id: r.id, content: await execReadNote(parseInput(r.json)) })
            }
            // Any mutation called in the SAME turn as a read is NOT executed here
            // (mutations only ever run via an Approve card). Tell the model so it can
            // re-propose on the next pass, where it becomes a real proposal card.
            for (const m of mutations) {
              results.push({ type: 'tool_result', tool_use_id: m.id, content: 'Not executed — this action needs the operator’s approval. If you still recommend it now that you have the information you read, call the tool again on your next turn and it will be surfaced as a confirmation card.' })
            }
            convo.push({ role: 'assistant', content: assistantContent })
            convo.push({ role: 'user', content: results })
            continue
          }

          // Terminal pass: surface mutation proposals (if any) and finish.
          if (mutations.length) {
            const actions: ProposedAction[] = mutations.map(m => ({ tool: m.name, input: parseInput(m.json) }))
            send({ t: 'actions', a: actions })
          }
          break
        }
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
}
