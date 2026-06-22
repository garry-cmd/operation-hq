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
    // Match the DB's block_time_chk (0 ≤ start < end ≤ 1440) so a bad time fails
    // here, before any Google event is created.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(blockDate) || startMinute < 0 || endMinute <= startMinute || endMinute > 1440)
      return NextResponse.json({ error: 'invalid date or time range' }, { status: 400 })

    const admin = getSupabaseAdmin()

    // Idempotency guard. A committed free-form block with the same date, time,
    // and title already existing means this is a duplicate create — an agent
    // retry, a double-click, or a re-run of "set up my week". Return the existing
    // block instead of minting a second row + second Google event. (This is what
    // produced the 4× "Gym / Lunch" blocks on 2026-06-21: four create passes
    // ~2 min apart, none of which checked for an existing match.)
    const { data: dupe } = await admin
      .from('calendar_blocks')
      .select('*')
      .eq('status', 'committed')
      .eq('block_date', blockDate)
      .eq('start_minute', startMinute)
      .eq('end_minute', endMinute)
      .eq('title', title)
      .is('task_id', null)
      .is('weekly_action_id', null)
      .limit(1)
      .maybeSingle()
    if (dupe) return NextResponse.json({ block: dupe, deduped: true })

    let accessToken: string, calId: string | null
    try {
      const tok = await getValidAccessToken(userId)
      accessToken = tok.accessToken
      calId = tok.hqCalendarId ?? await ensureHqCalendar(accessToken)
    } catch {
      return NextResponse.json({ error: 'Google Calendar isn’t connected — connect it on the Calendar screen first.' }, { status: 409 })
    }

    // Insert the row FIRST so any constraint failure happens before we create a
    // Google event (otherwise a rejected insert orphans the event).
    const { data: block, error } = await admin
      .from('calendar_blocks')
      .insert({ title, block_date: blockDate, start_minute: startMinute, end_minute: endMinute, status: 'committed' })
      .select('*').single()
    if (error) return NextResponse.json({ error: error.message || 'could not save the event' }, { status: 500 })

    // Then create the Google event and record its ids. If Google fails, roll the
    // row back so we never leave an unsynced ghost block.
    let eventId: string
    try {
      eventId = await createEvent(accessToken, calId, { summary: title, date: blockDate, startMinute, endMinute })
    } catch (ev) {
      await admin.from('calendar_blocks').delete().eq('id', block.id)
      const m = ev instanceof Error ? ev.message : 'calendar event failed'
      return NextResponse.json({ error: m }, { status: 502 })
    }

    const { data: updated, error: upErr } = await admin
      .from('calendar_blocks')
      .update({ google_event_id: eventId, google_calendar_id: calId })
      .eq('id', block.id)
      .select('*').single()
    if (upErr) return NextResponse.json({ block }) // event created + row exists; ids best-effort
    return NextResponse.json({ block: updated })
  } catch (e) {
    const msg = (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : 'error'
    console.error('POST /api/google/block', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
