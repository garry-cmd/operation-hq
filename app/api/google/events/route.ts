import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken, listEvents, type GoogleBusyEvent, type GoogleAllDayEvent } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *  → { events: GoogleBusyEvent[], allDayEvents: GoogleAllDayEvent[] } merged
 *  across all selected read calendars. Over-fetches ±1 day (tz slop) then
 *  filters precisely to [from,to]. */
export async function GET(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const excludeHq = url.searchParams.get('exclude_hq') === '1'
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  try {
    const { accessToken, readCalendarIds, hqCalendarId } = await getValidAccessToken(userId)
    if (readCalendarIds.length === 0) return NextResponse.json({ events: [], allDayEvents: [] })

    const min = new Date(`${from}T00:00:00Z`); min.setUTCDate(min.getUTCDate() - 1)
    const max = new Date(`${to}T00:00:00Z`); max.setUTCDate(max.getUTCDate() + 2)
    const timeMinISO = min.toISOString()
    const timeMaxISO = max.toISOString()

    // The "HQ" calendar holds HQ's own committed task/action blocks. Both the
    // Home ribbon and the Calendar overlay pass exclude_hq=1 so HQ time-blocks
    // aren't shown as meetings (the Calendar renders them natively as removable
    // blocks; the ribbon wants real meetings + all-day only).
    const keepCal = (id: string) => !(excludeHq && hqCalendarId && id === hqCalendarId)

    const batches = await Promise.all(
      readCalendarIds.map((id) => listEvents(accessToken, id, timeMinISO, timeMaxISO)),
    )
    const events: GoogleBusyEvent[] = batches.flatMap((b) => b.busy).filter((e) => keepCal(e.calendarId) && e.date >= from && e.date <= to)
    const allDayEvents: GoogleAllDayEvent[] = batches.flatMap((b) => b.allDay).filter((e) => keepCal(e.calendarId) && e.date >= from && e.date <= to)
    return NextResponse.json({ events, allDayEvents })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const status = msg === 'not connected' ? 409 : 500
    console.error('GET /api/google/events', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
