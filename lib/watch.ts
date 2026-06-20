import { buildAgentContext } from '@/lib/agentContext'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { TOOLS, type ProposedAction } from '@/lib/agentTools'

/**
 * Scout's WATCH pass — the background, unprompted counterpart to the chat agent.
 *
 * Where the morning brief (lib/briefing.ts) always speaks once a day, a watch
 * pass runs a few times a day and is biased to SILENCE: it only surfaces
 * something when there's a genuinely new or changed concern (a KR slipping,
 * overdue piling up, a deadline closing in, an overloaded day) that the operator
 * hasn't already been told about. Most passes produce nothing.
 *
 * When it does surface, it writes a `source='watch'` row into the SAME briefings
 * feed the morning brief uses — so it renders in BriefingsFeed with the same
 * one-tap Approve/Dismiss proposals, no new UI. A `dedupe_key` lets the cron
 * skip a concern it already raised recently, and the recent items are fed back
 * into the model so it self-dedupes semantically too.
 */

const MODEL = 'claude-sonnet-4-6'

const WATCH_SYSTEM = `You are Scout, the chief of staff for Operation HQ, doing a quiet BACKGROUND check-in between conversations. The operator did NOT ask for this — you are scanning their operation on your own to catch what's slipping before it becomes a fire.

You are given a full current snapshot of the operation, plus a list of what you ALREADY surfaced to them recently. Your default is SILENCE. Only speak up when there is something genuinely worth interrupting them for right now.

Surface something ONLY if it is:
- newly slipping or blocked (a KR off-track/blocked, a this-week action stalled),
- time-sensitive today (a task overdue or due today, a deadline closing in, a meeting that needs prep),
- or a real change since you last checked.

Do NOT surface:
- anything already in the "recently surfaced" list below, unless it has materially changed,
- routine standing state that isn't slipping,
- vague encouragement or filler. If nothing new is worth their attention, stay silent.

ALWAYS respond with a single JSON object FIRST as your text, before anything else, no prose, no code fences:
{"surface": true|false, "priority": "high"|"fyi", "key": "stable-slug", "title": "...", "body": "..."}

- surface: false when there is nothing new worth raising. When false, leave the other fields empty ("") and propose nothing.
- priority: "high" only when it needs attention TODAY (push-worthy). Otherwise "fyi".
- key: a short stable slug identifying THIS specific concern so you don't repeat it — e.g. "blocked-kr-stellar-onboarding", "overdue-cluster", "overloaded-thursday", "deadline-vidscrip-filing". Reuse the same slug if you'd raise the same concern again.
- title: a 3-6 word headline.
- body: 1-3 short sentences, under ~220 characters, naming the actual items. No greeting, no markdown, no emoji.

AFTER the JSON, when (and only when) surface is true, you MAY propose 0-4 concrete actions with the provided tools (reschedule a slipping task, set a KR's health, add a follow-up task, create a note, add a calendar event). These render as one-tap approvals on the feed item — propose only what is clearly warranted and specific, grounded in the snapshot. Quality over quantity; propose nothing if nothing is clearly actionable.`

export type WatchResult = {
  surface: boolean
  priority: 'high' | 'fyi'
  key: string
  title: string
  body: string
  proposals: ProposedAction[]
}

/** Recent watch items + today's brief, as a compact block the model dedupes against. */
async function recentlySurfaced(admin: ReturnType<typeof getSupabaseAdmin>): Promise<string> {
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('briefings')
    .select('title, body, source, dedupe_key, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(12)
  const rows = data ?? []
  if (!rows.length) return '(nothing surfaced to the operator in the last day)'
  return rows
    .map(r => {
      const k = r.dedupe_key ? ` [key:${r.dedupe_key}]` : ''
      const tag = r.source === 'watch' ? 'watch' : r.source === 'cron' ? 'morning brief' : String(r.source)
      return `- (${tag})${k} ${String(r.title)}: ${String(r.body)}`
    })
    .join('\n')
}

export async function generateWatch(input: { today: string; weekStart: string }): Promise<WatchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const admin = getSupabaseAdmin()
  const [context, surfaced] = await Promise.all([buildAgentContext(input), recentlySurfaced(admin)])

  const system = `${WATCH_SYSTEM}\n\n---\n\n## Recently surfaced (do not repeat these unless materially changed)\n${surfaced}\n\n---\n\n${context}`

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: TOOLS,
      system,
      messages: [{ role: 'user', content: `Run a background watch check for ${input.today}. Surface something only if it's genuinely new and worth interrupting for; otherwise return surface:false.` }],
    }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`anthropic ${r.status}: ${detail.slice(0, 200)}`)
  }
  const data = await r.json()
  const blocks: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }> = data?.content ?? []
  const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
  const proposals: ProposedAction[] = blocks
    .filter(b => b.type === 'tool_use' && typeof b.name === 'string')
    .map(b => ({ tool: b.name as string, input: (b.input ?? {}) as Record<string, unknown> }))

  return parseWatch(text, proposals)
}

function parseWatch(text: string, proposals: ProposedAction[]): WatchResult {
  const empty: WatchResult = { surface: false, priority: 'fyi', key: '', title: '', body: '', proposals: [] }
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end === -1) return empty
  t = t.slice(start, end + 1)
  try {
    const o = JSON.parse(t) as Record<string, unknown>
    const surface = o.surface === true
    if (!surface) return empty
    const title = String(o.title ?? '').slice(0, 80).trim()
    const body = String(o.body ?? '').slice(0, 300).trim()
    if (!title || !body) return empty // surfacing requires real content
    const priority = o.priority === 'high' ? 'high' : 'fyi'
    const key = String(o.key ?? '').slice(0, 120).trim()
    return { surface: true, priority, key, title, body, proposals }
  } catch {
    return empty
  }
}

/**
 * Persist a surfaced watch item as a `source='watch'` row in the briefings feed.
 * No note is filed (watch items are ephemeral feed entries, not archival daily
 * briefs). Proposals are frozen with stable ids + pending status, exactly like
 * saveBrief, so BriefingsFeed's Approve/Dismiss works unchanged.
 */
export async function saveWatchItem(userId: string, w: WatchResult, opts: { forDate: string }): Promise<void> {
  const admin = getSupabaseAdmin()
  const proposals = w.proposals?.length
    ? w.proposals.map((p, i) => ({ id: `p${i}`, tool: p.tool, input: p.input, status: 'pending' as const }))
    : null

  const { error } = await admin.from('briefings').insert({
    user_id: userId,
    title: w.title,
    body: w.body,
    for_date: opts.forDate,
    source: 'watch',
    note_id: null,
    proposals,
    dedupe_key: w.key || null,
  })
  if (error) throw error
}

/**
 * Hard de-dup backstop: has this exact concern (same dedupe_key) been surfaced
 * as a watch item within the lookback window? The model already self-dedupes
 * against recent items; this catches exact-key repeats deterministically.
 */
export async function wasRecentlySurfaced(key: string, lookbackHours = 18): Promise<boolean> {
  if (!key) return false
  const admin = getSupabaseAdmin()
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('briefings')
    .select('id')
    .eq('source', 'watch')
    .eq('dedupe_key', key)
    .gte('created_at', since)
    .limit(1)
  return (data?.length ?? 0) > 0
}
