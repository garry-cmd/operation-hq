import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'
import { generateBrief } from '@/lib/briefing'
import { listSubscriptions, deleteSubscription, markSent } from '@/lib/db/pushSubscriptions'
import { sendPush, isPushConfigured } from '@/lib/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errMsg(e: unknown): string {
  return (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : 'error'
}

/** POST { today, weekStart } — generate a brief from live state and push it to
 *  THIS user's subscriptions right now. On-demand trigger for the scheduled brief. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isPushConfigured()) return NextResponse.json({ error: 'push not configured (VAPID keys missing)' }, { status: 503 })

  let body: { today?: string; weekStart?: string }
  try { body = await req.json() } catch { body = {} }
  if (!body.today || !body.weekStart) return NextResponse.json({ error: 'today and weekStart required' }, { status: 400 })

  let brief
  try { brief = await generateBrief({ today: body.today, weekStart: body.weekStart }) }
  catch (e) { return NextResponse.json({ error: `brief failed: ${errMsg(e)}` }, { status: 502 }) }

  const subs = await listSubscriptions(userId)
  if (!subs.length) return NextResponse.json({ ok: false, error: 'no subscriptions for this user yet', brief })

  const payload = { title: brief.title, body: brief.body, url: '/hq' }
  let sent = 0
  const okEndpoints: string[] = []
  for (const { endpoint, sub } of subs) {
    const res = await sendPush(sub, payload)
    if (res === 'ok') { sent++; okEndpoints.push(endpoint) }
    else if (res === 'gone') await deleteSubscription(endpoint)
  }
  await markSent(okEndpoints)
  return NextResponse.json({ ok: true, sent, total: subs.length, brief })
}
