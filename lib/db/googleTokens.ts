import { supabase } from '@/lib/supabase'

/**
 * Client-side read of the user's Google connection status. Selects only
 * non-sensitive columns (never the tokens) — RLS lets the user read their own
 * row. A missing row = not connected.
 */
export interface GoogleStatus {
  connected: boolean
  driveGranted: boolean
  hqCalendarId: string | null
  readCalendarIds: string[]
}

export async function getStatus(): Promise<GoogleStatus> {
  const { data, error } = await supabase
    .from('user_google_tokens')
    .select('hq_calendar_id, read_calendar_ids, scope')
    .maybeSingle()
  if (error || !data) return { connected: false, driveGranted: false, hqCalendarId: null, readCalendarIds: [] }
  const scopes = ((data.scope as string | null) ?? '').split(/\s+/)
  const driveGranted =
    scopes.includes('https://www.googleapis.com/auth/drive.file') ||
    scopes.includes('https://www.googleapis.com/auth/drive')
  return {
    connected: true,
    driveGranted,
    hqCalendarId: (data.hq_calendar_id as string | null) ?? null,
    readCalendarIds: (data.read_calendar_ids as string[] | null) ?? [],
  }
}
