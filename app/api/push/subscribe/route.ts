import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'
import { saveSubscription, deleteSubscription } from '@/lib/db/pushSubscriptions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errMsg(e: unknown): string {
  return (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : 'error'
}

/** POST { subscription, userAgent } — store this browser's push subscription. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; userAgent?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }) }
  const sub = body.subscription
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: 'invalid subscription' }, { status: 400 })
  }
  try {
    await saveSubscription(userId, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, body.userAgent)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 })
  }
}

/** DELETE { endpoint } — remove a subscription (unsubscribe). */
export async function DELETE(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  let body: { endpoint?: string }
  try { body = await req.json() } catch { body = {} }
  if (!body.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  try { await deleteSubscription(body.endpoint); return NextResponse.json({ ok: true }) }
  catch (e) { return NextResponse.json({ error: errMsg(e) }, { status: 500 }) }
}
