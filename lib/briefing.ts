import { buildAgentContext } from '@/lib/agentContext'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

const MODEL = 'claude-sonnet-4-6'

const BRIEF_SYSTEM = `You are the Chief of Staff for Operation HQ, writing a short proactive morning brief for the operator — a single founder running several spaces.

You are given a full snapshot of his operation below. Produce a TIGHT brief sized for a phone push notification.

Rules:
- Lead with what matters most TODAY: tasks due today/overdue, this week's KR actions, meetings on the calendar, and anything slipping (off-track or blocked KRs).
- Be specific and concrete. Name the actual items. Never write "you have some tasks" — say which ones.
- No greeting, no sign-off, no filler, no markdown, no emoji.
- Title: a 3-6 word headline.
- Body: 1-3 short sentences, under ~220 characters total — only the few things he should know before the day starts.
- If there is genuinely nothing notable, say that briefly rather than inventing work.

Return ONLY a JSON object, with no prose and no code fences:
{"title": "...", "body": "..."}`

export type Brief = { title: string; body: string }

export async function generateBrief(input: { today: string; weekStart: string }): Promise<Brief> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
  const context = await buildAgentContext(input)
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: `${BRIEF_SYSTEM}\n\n---\n\n${context}`,
      messages: [{ role: 'user', content: `Generate the brief for ${input.today}.` }],
    }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`anthropic ${r.status}: ${detail.slice(0, 200)}`)
  }
  const data = await r.json()
  const blocks: Array<{ type?: string; text?: string }> = data?.content ?? []
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
  return parseBrief(text)
}

function parseBrief(text: string): Brief {
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

/** Persist a generated brief (server-only, service-role). Callers wrap this so a
 *  logging failure can't block the push send. */
export async function saveBrief(userId: string, brief: Brief, opts: { forDate: string; source: 'manual' | 'cron' }): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('briefings').insert({
    user_id: userId,
    title: brief.title,
    body: brief.body,
    for_date: opts.forDate,
    source: opts.source,
  })
  if (error) throw error
}
