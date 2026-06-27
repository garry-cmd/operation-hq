import type React from 'react'
// Client-side search ranker for the command palette. Pure functions, no React.
// Everything the app needs is already loaded into page.tsx state, so ranking
// happens in-memory — instant, no round-trip. Postgres FTS would only earn its
// complexity if the dataset outgrew memory, which it won't at solo-user scale.

export type SearchKind =
  | 'Objective' | 'Key Result' | 'Action' | 'Note' | 'Reflect' | 'Notebook' | 'Space'

// Opaque routing payload consumed by page.tsx's pick handler. Kept as a loose
// shape here so lib/search stays decoupled from the Screen union.
export interface SearchRoute {
  screen: string
  spaceId?: string | null
  weekStart?: string
  noteId?: string
  objectiveId?: string
  actionId?: string
  krId?: string
}

export interface SearchEntry {
  id: string
  kind: SearchKind
  icon: React.ReactNode
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
  Objective: 30, 'Key Result': 26, Action: 22,
  Note: 16, Reflect: 14, Notebook: 10, Space: 10,
}
const KIND_ORDER: SearchKind[] = [
  'Objective', 'Key Result', 'Action', 'Note', 'Reflect', 'Notebook', 'Space',
]

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Bounded Levenshtein — returns true if a and b are within `max` edits.
// Early-exits once a row's best possible distance exceeds max, so it's cheap
// for the typo-tolerance check (only ever called when exact tiers miss).
function withinEdits(a: string, b: string, max: number): boolean {
  const al = a.length, bl = b.length
  if (Math.abs(al - bl) > max) return false
  let prev = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return false
    prev = cur
  }
  return prev[bl] <= max
}

// Score one token against one field. Tiers: exact > prefix > word-boundary >
// substring > fuzzy. Fuzzy is word-level edit-distance typo tolerance, gated to
// tokens of length ≥ 3 and scored well below a clean substring so a real hit
// never loses to a fuzzy one ("stellr" finds Stellar, but "stellar" still wins).
function tokenFieldScore(field: string | undefined, tok: string): number {
  if (!field) return 0
  const f = field.toLowerCase()
  if (f === tok) return 1000
  if (f.startsWith(tok)) return 620
  if (new RegExp('\\b' + escapeRe(tok)).test(f)) return 420
  if (f.includes(tok)) return 240
  if (tok.length >= 3) {
    const thr = tok.length <= 4 ? 1 : 2
    for (const w of f.split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && withinEdits(w, tok, thr)) return 90
    }
  }
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

// Map a `type:` operator keyword to a SearchKind.
const KIND_OPS: Record<string, SearchKind> = {
  note: 'Note', notes: 'Note',
  kr: 'Key Result', krs: 'Key Result', obj: 'Objective', objective: 'Objective',
  objectives: 'Objective', action: 'Action', actions: 'Action',
  reflect: 'Reflect', notebook: 'Notebook', space: 'Space',
}

export interface ParsedQuery {
  tokens: string[]
  tagOnly: boolean
  kind?: SearchKind
  inSpace?: string
}

// Parse scoping operators non-destructively (the raw text stays in the box):
//   #tag            → restrict to tagged items
//   in:<space>      → restrict to a space by name
//   note:/... → restrict to a kind  (e.g. "note: rick")
// Everything else is a content token used for matching.
export function parseQuery(query: string): ParsedQuery {
  let tagOnly = false
  let kind: SearchKind | undefined
  let inSpace: string | undefined
  const tokens: string[] = []
  for (const w of query.trim().split(/\s+/).filter(Boolean)) {
    const lw = w.toLowerCase()
    if (lw.startsWith('#')) { tagOnly = true; const rest = lw.slice(1); if (rest) tokens.push(rest); continue }
    const colon = lw.indexOf(':')
    if (colon > 0) {
      const key = lw.slice(0, colon)
      const val = lw.slice(colon + 1)
      if (key === 'in') { if (val) inSpace = val; continue }
      if (KIND_OPS[key]) { kind = KIND_OPS[key]; if (val) tokens.push(val); continue }
    }
    tokens.push(lw)
  }
  return { tokens, tagOnly, kind, inSpace }
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
  const { tokens, tagOnly, kind, inSpace } = parseQuery(query)
  const effKind = kind ?? (kindFilter && kindFilter !== 'All' ? kindFilter : undefined)

  // Nothing typed and no scope → no results (the palette shows recents instead).
  if (!tokens.length && !tagOnly && !inSpace && !effKind) return []

  const inScope = (e: SearchEntry) => {
    if (effKind && e.kind !== effKind) return false
    if (inSpace && !(e.spaceName ?? '').toLowerCase().includes(inSpace)) return false
    if (tagOnly) {
      if (!e.tags || !e.tags.length) return false
      if (tokens.length && !e.tags.some(t => tokens.some(tok => t.toLowerCase().includes(tok)))) return false
    }
    return true
  }

  let hits: RankedHit[] = []
  if (!tokens.length) {
    // Scope-only query (e.g. "in:stellar", "task:", "#"): list everything in
    // scope, ranked by kind + recency.
    for (const e of entries) {
      if (!inScope(e)) continue
      hits.push({ entry: e, score: (KIND_BOOST[e.kind] ?? 0) + (e.rec ?? 0) - (e.done ? 40 : 0), hitField: 'title', tokens: [] })
    }
  } else {
    for (const e of entries) {
      if (!inScope(e)) continue
      const h = scoreEntry(e, tokens)
      if (h) hits.push(h)
    }
  }

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
