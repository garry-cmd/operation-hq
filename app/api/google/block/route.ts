import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken, deleteEvent, patchEvent, createEvent, ensureHqCalendar } from '@/lib/google'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** DELETE { blockId } — remove a committed block: delete its Google event,
 *  then delete the row. (Proposed blocks are removed client-side; this route
 *  is only invoked for committed ones, but it tolerates either.) */
export async function DELETE(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const blockId = body.blockId as string | undefined
    if (!blockId) return NextResponse.json({ error: 'blockId required' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const { data: row, error } = await admin
      .from('calendar_blocks').select('*').eq('id', blockId).maybeSingle()
    if (error) throw error
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

    if (row.google_event_id && row.google_calendar_id) {
      const { accessToken } = await getValidAccessToken(userId)
      await deleteEvent(accessToken, row.google_calendar_id as string, row.google_event_id as string)
    }
    const { error: delErr } = await admin.from('calendar_blocks').delete().eq('id', blockId)
    if (delErr) throw delErr
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    console.error('DELETE /api/google/block', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** PATCH { blockId, blockDate, startMinute } — move a committed block.
 *  Duration is preserved; the row and the Google event are both updated. */
export async function PATCH(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const { blockId, blockDate, startMinute } = body as { blockId?: string; blockDate?: string; startMinute?: number }
    if (!blockId || !blockDate || typeof startMinute !== 'number')
      return NextResponse.json({ error: 'blockId, blockDate, startMinute required' }, { status: 400 })

    const admin = getSupabaseAdmin()
    const { data: row, error } = await admin
      .from('calendar_blocks').select('*').eq('id', blockId).maybeSingle()
    if (error) throw error
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const duration = (row.end_minute as number) - (row.start_minute as number)
    const endMinute = startMinute + duration

    const { data: updated, error: upErr } = await admin
      .from('calendar_blocks')
      .update({ block_date: blockDate, start_minute: startMinute, end_minute: endMinute })
      .eq('id', blockId)
      .select('*').single()
    if (upErr) throw upErr

    if (row.google_event_id && row.google_calendar_id) {
      const { accessToken } = await getValidAccessToken(userId)
      await patchEvent(accessToken, row.google_calendar_id as string, row.google_event_id as string, {
        date: blockDate, startMinute, endMinute,
      })
    }
    return NextResponse.json({ block: updated })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    console.error('PATCH /api/google/block', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** POST { title, blockDate, startMinute, endMinute } — create a free-form
 *  calendar event (not tied to a task/KR): write it to the HQ Google calendar
 *  and mirror it as a committed calendar_block. Used by the agent's
 *  create_calendar_event tool after the user approves the proposal. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const { title, blockDate, startMinute, endMinute } = body as {
      title?: string; blockDate?: string; startMinute?: number; endMinute?: number
    }
    if (!title || !blockDate || typeof startMinute !== 'number' || typeof endMinute !== 'number')
      return NextResponse.json({ error: 'title, blockDate, startMinute, endMinute required' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(blockDate) || endMinute <= startMinute)
      return NextResponse.json({ error: 'invalid date or time range' }, { status: 400 })

    let accessToken: string, calId: string | null
    try {
      const tok = await getValidAccessToken(userId)
      accessToken = tok.accessToken
      calId = tok.hqCalendarId ?? await ensureHqCalendar(accessToken)
    } catch {
      return NextResponse.json({ error: 'Google Calendar isn’t connected — connect it on the Calendar screen first.' }, { status: 409 })
    }

    const eventId = await createEvent(accessToken, calId, { summary: title, date: blockDate, startMinute, endMinute })

    const admin = getSupabaseAdmin()
    const { data: block, error } = await admin
      .from('calendar_blocks')
      .insert({
        title, block_date: blockDate, start_minute: startMinute, end_minute: endMinute,
        status: 'committed', google_event_id: eventId, google_calendar_id: calId,
      })
      .select('*').single()
    if (error) throw error
    return NextResponse.json({ block })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    console.error('POST /api/google/block', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
