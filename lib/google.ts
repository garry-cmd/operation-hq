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
