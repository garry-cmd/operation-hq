import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken, listCalendars, setReadCalendarIds } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET → { calendars: GoogleCalendarMeta[], selected: string[] }
 *  Lists every calendar the user can read plus their current read selection. */
export async function GET(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { accessToken, readCalendarIds } = await getValidAccessToken(userId)
    const calendars = await listCalendars(accessToken)
    return NextResponse.json({ calendars, selected: readCalendarIds })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const status = msg === 'not connected' ? 409 : 500
    console.error('GET /api/google/calendars', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}

/** POST { ids: string[] } → persists the read-source selection. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = await req.json().catch(() => ({}))
    const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
    await setReadCalendarIds(userId, ids)
    return NextResponse.json({ ok: true, selected: ids })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    console.error('POST /api/google/calendars', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
