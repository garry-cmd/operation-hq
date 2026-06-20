import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from './supabaseAdmin'

/**
 * Google OAuth + Calendar REST helpers. Hand-rolled fetch (no googleapis dep),
 * matching how the app handled other integrations. All env access is lazy so a
 * missing var surfaces at request time, not build time.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CAL_API = 'https://www.googleapis.com/calendar/v3'
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar'

function env(k: string): string {
  const v = process.env[k]
  if (!v) throw new Error(`Missing env ${k}`)
  return v
}

/** Where to send the user back after the OAuth dance — derived from the
 *  registered redirect URI so it's always the real app origin (not Vercel's
 *  internal request host). */
export function appOrigin(): string {
  return new URL(env('GOOGLE_REDIRECT_URI')).origin
}

// ── consent + token exchange ────────────────────────────────────────
export function buildConsentUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: env('GOOGLE_REDIRECT_URI'),
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',   // request a refresh token
    prompt: 'consent',        // force refresh_token issuance every time
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${p.toString()}`
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; scope: string }

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    redirect_uri: env('GOOGLE_REDIRECT_URI'),
    grant_type: 'authorization_code',
  })
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`)
  return r.json()
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env('GOOGLE_CLIENT_ID'),
    client_secret: env('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  })
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  if (!r.ok) throw new Error(`token refresh failed: ${r.status} ${await r.text()}`)
  return r.json() // note: refresh responses omit refresh_token
}

// ── signed state (HMAC w/ client secret) carries user_id through OAuth ──
function b64url(s: string) { return Buffer.from(s).toString('base64url') }

export function signState(userId: string): string {
  const payload = `${userId}|${crypto.randomBytes(8).toString('hex')}|${Date.now()}`
  const body = b64url(payload)
  const sig = crypto.createHmac('sha256', env('GOOGLE_CLIENT_SECRET')).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(state: string): string | null {
  const [body, sig] = state.split('.')
  if (!body || !sig) return null
  const expect = crypto.createHmac('sha256', env('GOOGLE_CLIENT_SECRET')).update(body).digest('base64url')
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
  const [userId, , ts] = Buffer.from(body, 'base64url').toString().split('|')
  if (!userId || !ts) return null
  if (Date.now() - Number(ts) > 10 * 60 * 1000) return null // 10-minute validity
  return userId
}

// ── identify the calling user from a Bearer token (fetch routes) ──────
export async function userIdFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const sb = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data } = await sb.auth.getUser()
  return data.user?.id ?? null
}

// ── token persistence + valid-token accessor ─────────────────────────
export async function saveTokens(userId: string, t: TokenResponse, hqCalendarId: string | null): Promise<void> {
  const admin = getSupabaseAdmin()
  const row: Record<string, unknown> = {
    user_id: userId,
    access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    scope: t.scope,
  }
  if (t.refresh_token) row.refresh_token = t.refresh_token
  if (hqCalendarId) row.hq_calendar_id = hqCalendarId
  const { error } = await admin.from('user_google_tokens').upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

export async function getValidAccessToken(userId: string): Promise<{ accessToken: string; hqCalendarId: string | null; readCalendarIds: string[] }> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('user_google_tokens').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('not connected')
  let accessToken = data.access_token as string
  if (new Date(data.expires_at).getTime() < Date.now() + 30000) {
    const refreshed = await refreshAccessToken(data.refresh_token as string)
    accessToken = refreshed.access_token
    await admin.from('user_google_tokens').update({
      access_token: accessToken,
      expires_at: new Date(Date.now() + (refreshed.expires_in - 60) * 1000).toISOString(),
    }).eq('user_id', userId)
  }
  return {
    accessToken,
    hqCalendarId: (data.hq_calendar_id as string | null) ?? null,
    readCalendarIds: (data.read_calendar_ids as string[] | null) ?? [],
  }
}

// ── calendar helpers ─────────────────────────────────────────────────
/** Find or create the dedicated "HQ" calendar we write committed blocks to. */
export async function ensureHqCalendar(accessToken: string): Promise<string> {
  const listR = await fetch(`${CAL_API}/users/me/calendarList`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (listR.ok) {
    const j = await listR.json()
    const found = (j.items ?? []).find((c: { summary?: string }) => c.summary === 'HQ')
    if (found) return found.id
  }
  const createR = await fetch(`${CAL_API}/calendars`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: 'HQ', description: 'Time blocks from Operation HQ', timeZone: 'America/Los_Angeles' }),
  })
  if (!createR.ok) throw new Error(`create HQ calendar failed: ${createR.status} ${await createR.text()}`)
  const cal = await createR.json()
  return cal.id
}

// ════════════════════════════════════════════════════════════════════
// STAGE 2 — calendar list, events read, event write/patch/delete,
//           read-calendar selection, local⇄RFC3339 conversion.
// ════════════════════════════════════════════════════════════════════

/** App working timezone. Blocks + capacity are stored as wall-clock minutes
 *  and interpreted here. Garry splits PNW/Mexico — Pacific is the safe default
 *  for now; make this per-user configurable later if it matters. */
export const APP_TZ = 'America/Los_Angeles'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** RFC3339 local-datetime string (no offset) for a wall-clock date+minute.
 *  Paired with `timeZone: APP_TZ` so Google interprets it in our tz. */
export function localDateTime(date: string, minute: number): string {
  return `${date}T${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:00`
}

/** Convert any instant (RFC3339 w/ offset, or 'Z') to APP_TZ wall-clock
 *  { date:'YYYY-MM-DD', minute:0..1439 }. */
export function toLocalParts(iso: string, tz: string = APP_TZ): { date: string; minute: number } {
  const d = new Date(iso)
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(d)) p[part.type] = part.value
  let hour = parseInt(p.hour, 10)
  if (hour === 24) hour = 0 // some engines emit 24 for midnight
  return { date: `${p.year}-${p.month}-${p.day}`, minute: hour * 60 + parseInt(p.minute, 10) }
}

export interface GoogleCalendarMeta { id: string; summary: string; primary: boolean; backgroundColor: string | null; accessRole: string }

/** All calendars on the user's list (for the read-source selector). */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarMeta[]> {
  const r = await fetch(`${CAL_API}/users/me/calendarList?minAccessRole=reader&maxResults=250`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error(`calendarList failed: ${r.status} ${await r.text()}`)
  const j = await r.json()
  return (j.items ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    summary: (c.summaryOverride as string) || (c.summary as string) || (c.id as string),
    primary: Boolean(c.primary),
    backgroundColor: (c.backgroundColor as string) ?? null,
    accessRole: (c.accessRole as string) ?? 'reader',
  }))
}

export interface GoogleBusyEvent { id: string; calendarId: string; title: string; date: string; startMinute: number; endMinute: number }
export interface GoogleAllDayEvent { id: string; calendarId: string; title: string; date: string }

/** Add n days to a 'YYYY-MM-DD' string via UTC, avoiding local-tz drift. */
function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Events from one calendar within [timeMinISO, timeMaxISO], split into timed
 *  "busy" events (grid + planner) and all-day events (week ribbon). Timed
 *  transparency:'transparent' (free) events are dropped from busy. All-day
 *  events are kept regardless of transparency — holiday calendars mark their
 *  entries free, and the ribbon wants holidays. Multi-day all-day spans expand
 *  to one entry per covered day, clamped to the fetch window. */
export async function listEvents(accessToken: string, calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<{ busy: GoogleBusyEvent[]; allDay: GoogleAllDayEvent[] }> {
  const p = new URLSearchParams({
    timeMin: timeMinISO, timeMax: timeMaxISO,
    singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  })
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${p.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) {
    // A single unreadable calendar shouldn't kill the whole overlay.
    console.error(`events fetch failed for ${calendarId}: ${r.status} ${await r.text()}`)
    return { busy: [], allDay: [] }
  }
  const j = await r.json()
  const busy: GoogleBusyEvent[] = []
  const allDay: GoogleAllDayEvent[] = []
  // Window bounds (date strings) to clamp multi-day all-day expansion.
  const winStart = timeMinISO.slice(0, 10)
  const winEndExcl = addDaysStr(timeMaxISO.slice(0, 10), 1)
  for (const ev of (j.items ?? []) as Record<string, any>[]) {
    if (ev.status === 'cancelled') continue
    const start = ev.start?.dateTime
    const end = ev.end?.dateTime
    if (!start || !end) {
      // All-day: start.date inclusive, end.date exclusive (may be absent → 1 day).
      const sd = ev.start?.date as string | undefined
      if (!sd) continue
      const endExcl = (ev.end?.date as string | undefined) || addDaysStr(sd, 1)
      const title = ev.summary || '(all-day)'
      const from = sd < winStart ? winStart : sd
      const toExcl = endExcl > winEndExcl ? winEndExcl : endExcl
      for (let d = from; d < toExcl; d = addDaysStr(d, 1)) {
        allDay.push({ id: `${ev.id}:${d}`, calendarId, title, date: d })
      }
      continue
    }
    if (ev.transparency === 'transparent') continue // timed + Free → not busy
    const s = toLocalParts(start)
    const e = toLocalParts(end)
    const endMinute = e.date === s.date ? e.minute : 22 * 60 // clamp overnight to grid end
    if (endMinute <= s.minute) continue
    busy.push({
      id: ev.id, calendarId, title: ev.summary || '(busy)',
      date: s.date, startMinute: s.minute, endMinute,
    })
  }
  return { busy, allDay }
}

/** Create a timed event; returns the new event id. */
export async function createEvent(accessToken: string, calendarId: string, e: { summary: string; date: string; startMinute: number; endMinute: number }): Promise<string> {
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: e.summary,
      start: { dateTime: localDateTime(e.date, e.startMinute), timeZone: APP_TZ },
      end: { dateTime: localDateTime(e.date, e.endMinute), timeZone: APP_TZ },
    }),
  })
  if (!r.ok) throw new Error(`create event failed: ${r.status} ${await r.text()}`)
  return (await r.json()).id
}

export async function patchEvent(accessToken: string, calendarId: string, eventId: string, e: { date: string; startMinute: number; endMinute: number }): Promise<void> {
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: { dateTime: localDateTime(e.date, e.startMinute), timeZone: APP_TZ },
      end: { dateTime: localDateTime(e.date, e.endMinute), timeZone: APP_TZ },
    }),
  })
  if (!r.ok) throw new Error(`patch event failed: ${r.status} ${await r.text()}`)
}

export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const r = await fetch(`${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // 404/410 = already gone; treat as success (idempotent delete).
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`delete event failed: ${r.status} ${await r.text()}`)
}

/** Persist the user's chosen read-source calendars. */
export async function setReadCalendarIds(userId: string, ids: string[]): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('user_google_tokens').update({ read_calendar_ids: ids }).eq('user_id', userId)
  if (error) throw error
}
