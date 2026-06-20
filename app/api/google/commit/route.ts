import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken, createEvent } from '@/lib/google'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST { from:YYYY-MM-DD, to:YYYY-MM-DD }
 *  For every proposed block in range, create an event on the HQ calendar and
 *  flip the row to committed (recording google_event_id/calendar_id).
 *  Returns { committed: <updated rows>, failed: [{id,error}] }. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const body = await req.json().catch(() => ({}))
    const { from, to } = body as { from?: string; to?: string }
    if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

    const { accessToken, hqCalendarId } = await getValidAccessToken(userId)
    if (!hqCalendarId) return NextResponse.json({ error: 'no HQ calendar' }, { status: 409 })

    const admin = getSupabaseAdmin()
    const { data: rows, error } = await admin
      .from('calendar_blocks')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'proposed')
      .gte('block_date', from)
      .lte('block_date', to)
    if (error) throw error

    const committed: Record<string, unknown>[] = []
    const failed: { id: string; error: string }[] = []

    for (const b of rows ?? []) {
      try {
        const eventId = await createEvent(accessToken, hqCalendarId, {
          summary: (b.title as string) || 'HQ block',
          date: b.block_date as string,
          startMinute: b.start_minute as number,
          endMinute: b.end_minute as number,
        })
        const { data: updated, error: upErr } = await admin
          .from('calendar_blocks')
          .update({ status: 'committed', google_event_id: eventId, google_calendar_id: hqCalendarId })
          .eq('id', b.id)
          .select('*')
          .single()
        if (upErr) throw upErr
        committed.push(updated)
      } catch (e) {
        failed.push({ id: b.id as string, error: e instanceof Error ? e.message : 'error' })
      }
    }

    return NextResponse.json({ committed, failed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const status = msg === 'not connected' ? 409 : 500
    console.error('POST /api/google/commit', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
