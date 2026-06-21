import { supabase } from '@/lib/supabase'
import type { CalendarBlock, TrackedFile } from '@/lib/types'
import { fromRow as trackedFileFromRow } from '@/lib/db/trackedFiles'

/**
 * Client-side wrappers for the /api/google/* routes. Each call attaches the
 * Supabase session as a Bearer token (the routes resolve the user from it).
 * Mirror types are declared here so the server-only lib/google.ts (crypto,
 * service-role client) never gets pulled into the browser bundle.
 */

export interface GoogleCalendarMeta { id: string; summary: string; primary: boolean; backgroundColor: string | null; accessRole: string }
export interface GoogleBusyEvent { id: string; calendarId: string; title: string; date: string; startMinute: number; endMinute: number }
export interface GoogleAllDayEvent { id: string; calendarId: string; title: string; date: string }

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
}

export async function listCalendars(): Promise<{ calendars: GoogleCalendarMeta[]; selected: string[] }> {
  const r = await authedFetch('/api/google/calendars')
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `calendars ${r.status}`)
  return r.json()
}

export async function saveReadCalendars(ids: string[]): Promise<string[]> {
  const r = await authedFetch('/api/google/calendars', { method: 'POST', body: JSON.stringify({ ids }) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `save ${r.status}`)
  return (await r.json()).selected as string[]
}

export async function fetchEvents(from: string, to: string): Promise<GoogleBusyEvent[]> {
  // exclude_hq=1: the Calendar week grid already renders committed HQ blocks
  // natively (as removable blocks), so the HQ calendar must NOT also come back
  // as read-only meeting overlays — that double-renders them and the overlay
  // copy has no remove control. The planner still sees HQ time as busy via the
  // committed blocks themselves, not this overlay.
  const r = await authedFetch(`/api/google/events?from=${from}&to=${to}&exclude_hq=1`)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `events ${r.status}`)
  return (await r.json()).events as GoogleBusyEvent[]
}

/** Both timed-busy and all-day events for a range, in one request. Used by the
 *  Home week ribbon (busy meetings + all-day/holiday markers). The Calendar
 *  overlay keeps using fetchEvents (busy only). */
export async function fetchCalendarEvents(from: string, to: string): Promise<{ events: GoogleBusyEvent[]; allDayEvents: GoogleAllDayEvent[] }> {
  const r = await authedFetch(`/api/google/events?from=${from}&to=${to}&exclude_hq=1`)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `events ${r.status}`)
  const j = await r.json()
  return { events: (j.events ?? []) as GoogleBusyEvent[], allDayEvents: (j.allDayEvents ?? []) as GoogleAllDayEvent[] }
}

export async function commitWeek(from: string, to: string): Promise<{ committed: CalendarBlock[]; failed: { id: string; error: string }[] }> {
  const r = await authedFetch('/api/google/commit', { method: 'POST', body: JSON.stringify({ from, to }) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `commit ${r.status}`)
  return r.json()
}

export async function deleteCommittedBlock(blockId: string): Promise<void> {
  const r = await authedFetch('/api/google/block', { method: 'DELETE', body: JSON.stringify({ blockId }) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `delete ${r.status}`)
}

export async function moveCommittedBlock(blockId: string, blockDate: string, startMinute: number): Promise<CalendarBlock> {
  const r = await authedFetch('/api/google/block', { method: 'PATCH', body: JSON.stringify({ blockId, blockDate, startMinute }) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `move ${r.status}`)
  return (await r.json()).block as CalendarBlock
}

/** Create a free-form calendar event (Google + a committed HQ block). Used by
 *  the agent's create_calendar_event tool on approval. Returns the new block. */
export async function createCalendarEvent(
  title: string, blockDate: string, startMinute: number, endMinute: number,
): Promise<CalendarBlock> {
  const r = await authedFetch('/api/google/block', {
    method: 'POST',
    body: JSON.stringify({ title, blockDate, startMinute, endMinute }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `create event ${r.status}`)
  return (await r.json()).block as CalendarBlock
}

// ── Drive / Files ──
/** Fresh Google access token for the browser Google Picker (calendar +
 *  drive.file scope only). The Picker needs an OAuth token client-side. */
export async function getDriveAccessToken(): Promise<string> {
  const r = await authedFetch('/api/google/drive/access-token')
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `drive token ${r.status}`)
  return (await r.json()).access_token as string
}

/** Track a Picker-selected Drive file. Server fetches its metadata (proving
 *  drive.file access) and upserts the tracked_files row. Idempotent. */
export async function trackDriveFile(
  fileId: string, spaceId?: string | null,
): Promise<{ file: TrackedFile; existed: boolean }> {
  const r = await authedFetch('/api/google/drive/track', {
    method: 'POST',
    body: JSON.stringify({ fileId, spaceId: spaceId ?? null }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `track ${r.status}`)
  const j = await r.json()
  return { file: trackedFileFromRow(j.file), existed: Boolean(j.existed) }
}
