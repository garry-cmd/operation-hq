import { buildAgentContext } from '@/lib/agentContext'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { TOOLS, type ProposedAction } from '@/lib/agentTools'
import { textToTipTapDoc } from '@/lib/notes/textToDoc'

const MODEL = 'claude-sonnet-4-6'

// Brief notes are filed in a "Briefings" notebook in the My OKRs (meta) space,
// so every brief is a first-class, searchable, editable note in the tree.
const OKRS_SPACE_ID = 'd759151f-8a6c-4c28-9fe1-db303f4ecf3a'
const BRIEFINGS_NOTEBOOK_NAME = 'Briefings'

const BRIEF_SYSTEM = `You are the Chief of Staff for Operation HQ, writing a short proactive morning brief for the operator — a single founder running several spaces.

You are given a full snapshot of his operation below. Produce a TIGHT brief sized for a phone push notification.

Rules:
- Lead with what matters most TODAY: tasks due today/overdue, this week's KR actions, meetings on the calendar, and anything slipping (off-track or blocked KRs).
- Be specific and concrete. Name the actual items. Never write "you have some tasks" — say which ones.
- No greeting, no sign-off, no filler, no markdown, no emoji.
- Title: a 3-6 word headline.
- Body: 1-3 short sentences, under ~220 characters total — only the few things he should know before the day starts.
- If there is genuinely nothing notable, say that briefly rather than inventing work.

ALWAYS write the JSON object FIRST as your text response, before anything else:
{"title": "...", "body": "..."}
Return ONLY that JSON for the text — no prose, no code fences.

AFTER the JSON, you MAY propose 0-4 concrete actions using the provided tools (reschedule a slipping task, complete something clearly done, add a follow-up task, set a KR's health, create a note, add a calendar event). Propose ONLY actions that are clearly warranted and specific, grounded in the snapshot — these surface as one-tap approvals on the brief, so quality over quantity. If nothing is clearly actionable, propose nothing.`

export type Brief = { title: string; body: string; proposals: ProposedAction[] }

export async function generateBrief(input: { today: string; weekStart: string }): Promise<Brief> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const context = await buildAgentContext(input)
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: TOOLS,
      system: `${BRIEF_SYSTEM}\n\n---\n\n${context}`,
      messages: [{ role: 'user', content: `Generate the brief for ${input.today}.` }],
    }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`anthropic ${r.status}: ${detail.slice(0, 200)}`)
  }
  const data = await r.json()
  const blocks: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> = data?.content ?? []
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
  const proposals: ProposedAction[] = blocks
    .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
    .map((b) => ({ tool: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }))
  const { title, body } = parseBrief(text)
  return { title, body, proposals }
}

function parseBrief(text: string): { title: string; body: string } {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1)
  try {
    const o = JSON.parse(t) as { title?: unknown; body?: unknown }
    const title = String(o.title ?? 'Operation HQ').slice(0, 80)
    const body = String(o.body ?? '').slice(0, 300)
    return { title, body: body || 'Open HQ for today\u2019s brief.' }
  } catch {
    return { title: 'Operation HQ \u2014 daily brief', body: (text.slice(0, 220) || 'Open HQ for today\u2019s brief.') }
  }
}

/** Find (or create) the Briefings notebook in the My OKRs space. */
async function ensureBriefingsNotebook(admin: ReturnType<typeof getSupabaseAdmin>): Promise<string> {
  const { data: existing } = await admin
    .from('notebooks').select('id').eq('space_id', OKRS_SPACE_ID).ilike('name', BRIEFINGS_NOTEBOOK_NAME).limit(1)
  if (existing && existing.length) return existing[0].id as string
  const { data: created, error } = await admin
    .from('notebooks').insert({ space_id: OKRS_SPACE_ID, name: BRIEFINGS_NOTEBOOK_NAME }).select('id').single()
  if (error) throw error
  return created.id as string
}

/**
 * Persist a generated brief (server-only, service-role). Writes the brief as a
 * note in the Briefings notebook (so it's searchable / editable / in the tree),
 * then inserts the slim `briefings` index row pointing at it and carrying the
 * frozen proposals. Note creation is best-effort — a failure there still saves
 * the briefings row (just without a note_id).
 */
export async function saveBrief(userId: string, brief: Brief, opts: { forDate: string; source: 'manual' | 'cron' }): Promise<void> {
  const admin = getSupabaseAdmin()

  let noteId: string | null = null
  try {
    const notebookId = await ensureBriefingsNotebook(admin)
    const { data: note, error: noteErr } = await admin.from('notes').insert({
      space_id: OKRS_SPACE_ID,
      notebook_id: notebookId,
      title: `${opts.forDate} \u2014 ${brief.title}`,
      body: textToTipTapDoc(brief.body),
      body_format: 'tiptap_v1',
    }).select('id').single()
    if (noteErr) throw noteErr
    noteId = note.id as string
  } catch (e) {
    console.error('brief note create failed', e)
  }

  // Freeze proposals with a stable per-brief id + pending status for the feed.
  const proposals = brief.proposals?.length
    ? brief.proposals.map((p, i) => ({ id: `p${i}`, tool: p.tool, input: p.input, status: 'pending' as const }))
    : null

  const { error } = await admin.from('briefings').insert({
    user_id: userId,
    title: brief.title,
    body: brief.body,
    for_date: opts.forDate,
    source: opts.source,
    note_id: noteId,
    proposals,
  })
  if (error) throw error
}
