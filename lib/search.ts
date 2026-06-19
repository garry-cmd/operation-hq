// Client-side search ranker for the command palette. Pure functions, no React.
// Everything the app needs is already loaded into page.tsx state, so ranking
// happens in-memory — instant, no round-trip. Postgres FTS would only earn its
// complexity if the dataset outgrew memory, which it won't at solo-user scale.

export type SearchKind =
  | 'Objective' | 'Key Result' | 'Action' | 'Task' | 'Note' | 'Reflect' | 'Notebook' | 'Space'

// Opaque routing payload consumed by page.tsx's pick handler. Kept as a loose
// shape here so lib/search stays decoupled from the Screen union.
export interface SearchRoute {
  screen: string
  spaceId?: string | null
  weekStart?: string
  taskId?: string
  noteId?: string
  objectiveId?: string
  actionId?: string
}

export interface SearchEntry {
  id: string
  kind: SearchKind
  icon: string
  title: string
  body?: string
  tags?: string[]
  container?: string        // notebook name, etc.
  spaceName?: string
  spaceColor?: string
  hint?: string             // e.g. 'this week', 'done'
  done?: boolean
  rec?: number              // small recency boost (0–10ish)
  route: SearchRoute
}

export interface RankedHit {
  entry: SearchEntry
  score: number
  hitField: 'title' | 'tag' | 'container' | 'body'
  tokens: string[]
}

// Field weights — a title hit beats a tag hit beats a body hit.
const FIELD_WEIGHT: Record<string, number> = {
  title: 1.0,
  tag: 0.72,
  container: 0.6,
  body: 0.42,
}

// Type priority used only as a tiebreak when scores are equal.
const KIND_BOOST: Record<SearchKind, number> = {
  Objective: 30, 'Key Result': 26, Action: 22, Task: 18,
  Note: 16, Reflect: 14, Notebook: 10, Space: 10,
}
const KIND_ORDER: SearchKind[] = [
  'Objective', 'Key Result', 'Action', 'Task', 'Note', 'Reflect', 'Notebook', 'Space',
]

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Score one token against one field. Tiers: exact > prefix > word-boundary >
// substring. (Fuzzy/typo tolerance is a deliberate Tier-3 follow-up — kept out
// so a clean substring hit never loses to a fuzzy one.)
function tokenFieldScore(field: string | undefined, tok: string): number {
  if (!field) return 0
  const f = field.toLowerCase()
  if (f === tok) return 1000
  if (f.startsWith(tok)) return 620
  if (new RegExp('\\b' + escapeRe(tok)).test(f)) return 420
  if (f.includes(tok)) return 240
  return 0
}

function entryFields(e: SearchEntry): Record<string, string | undefined> {
  return {
    title: e.title,
    tag: e.tags && e.tags.length ? e.tags.join(' ') : undefined,
    container: e.container,
    body: e.body,
  }
}

export function tokenize(query: string): { tokens: string[]; tagOnly: boolean } {
  let q = query.trim()
  let tagOnly = false
  if (q.startsWith('#')) { tagOnly = true; q = q.slice(1).trim() }
  return { tokens: q.toLowerCase().split(/\s+/).filter(Boolean), tagOnly }
}

function scoreEntry(e: SearchEntry, tokens: string[]): RankedHit | null {
  const fields = entryFields(e)
  let total = 0
  let hitField: RankedHit['hitField'] = 'title'
  // Every token must match SOME field (AND semantics) — word-order independent.
  for (const tok of tokens) {
    let best = 0
    let bestField: string | null = null
    for (const [fname, fval] of Object.entries(fields)) {
      const s = tokenFieldScore(fval, tok) * (FIELD_WEIGHT[fname] ?? 0.4)
      if (s > best) { best = s; bestField = fname }
    }
    if (best === 0) return null
    total += best
    // Remember a non-title match so the row can show a body snippet / why it hit.
    if (bestField && bestField !== 'title') hitField = bestField as RankedHit['hitField']
  }
  total += (KIND_BOOST[e.kind] ?? 0) + (e.rec ?? 0)
  if (e.done) total -= 40
  return { entry: e, score: total, hitField, tokens }
}

export function rankEntries(
  entries: SearchEntry[],
  query: string,
  kindFilter?: SearchKind | 'All',
  limit = 12,
): RankedHit[] {
  const { tokens, tagOnly } = tokenize(query)
  if (!tokens.length) return []
  let hits: RankedHit[] = []
  for (const e of entries) {
    const h = scoreEntry(e, tokens)
    if (h) hits.push(h)
  }
  if (tagOnly) {
    hits = hits.filter(h => h.entry.tags && h.entry.tags.some(t => tokens.some(tok => t.toLowerCase().includes(tok))))
  }
  if (kindFilter && kindFilter !== 'All') hits = hits.filter(h => h.entry.kind === kindFilter)
  hits.sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.entry.kind) - KIND_ORDER.indexOf(b.entry.kind))
  return hits.slice(0, limit)
}

// Split text into segments for safe React rendering (no dangerouslySetInnerHTML).
// `hit` segments get wrapped in <mark> by the component.
export interface Segment { text: string; hit: boolean }

export function highlightSegments(text: string, tokens: string[]): Segment[] {
  if (!text) return []
  const toks = [...tokens].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe)
  if (!toks.length) return [{ text, hit: false }]
  const re = new RegExp('(' + toks.join('|') + ')', 'ig')
  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false })
    out.push({ text: m[0], hit: true })
    last = m.index + m[0].length
    if (m.index === re.lastIndex) re.lastIndex++ // guard against zero-width loops
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false })
  return out
}

// Build a ±window snippet around the first body match, highlighted.
export function makeSnippet(body: string, tokens: string[], pad = 36): Segment[] | null {
  const low = body.toLowerCase()
  let idx = -1
  for (const t of tokens) {
    const i = low.indexOf(t)
    if (i >= 0 && (idx < 0 || i < idx)) idx = i
  }
  if (idx < 0) return null
  const start = Math.max(0, idx - pad)
  const end = Math.min(body.length, idx + pad + 24)
  const slice = (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '')
  return highlightSegments(slice, tokens)
}
