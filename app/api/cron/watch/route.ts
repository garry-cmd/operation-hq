import { NextResponse } from 'next/server'
import { generateWatch, saveWatchItem, wasRecentlySurfaced } from '@/lib/watch'
import { listAllSubscriptions, deleteSubscription, markSent } from '@/lib/db/pushSubscriptions'
import { sendPush, isPushConfigured } from '@/lib/push'
import { APP_TZ } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Single-user system — the background watch is always for the owner.
const OWNER_USER_ID = '91ae1704-b98d-4212-a096-bc8ccc5b5581'

function errMsg(e: unknown): string {
  return (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) : 'error'
}

function pacificToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay()
  dt.setUTCDate(dt.getUTCDate() - day + (day === 0 ? -6 : 1))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/**
 * GET — invoked by Vercel Cron a few times a day. Authed by CRON_SECRET (Bearer).
 *
 * Runs a Scout watch pass: builds the full HQ snapshot, asks the watcher whether
 * anything new is worth surfacing, and — only if so — writes a watch item into
 * the briefings feed and (only for high-priority items) sends a push. Biased to
 * SILENCE: most passes return { ok:true, surfaced:false } and do nothing visible.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const today = pacificToday()
  const weekStart = mondayOf(today)

  let watch
  try { watch = await generateWatch({ today, weekStart }) }
  catch (e) { return NextResponse.json({ error: `watch failed: ${errMsg(e)}` }, { status: 502 }) }

  // Nothing new worth raising — stay silent.
  if (!watch.surface) return NextResponse.json({ ok: true, surfaced: false })

  // Hard de-dup backstop: skip an exact concern already raised in the window.
  if (await wasRecentlySurfaced(watch.key)) {
    return NextResponse.json({ ok: true, surfaced: false, deduped: true, key: watch.key })
  }

  try { await saveWatchItem(OWNER_USER_ID, watch, { forDate: today }) }
  catch (e) { return NextResponse.json({ error: `save failed: ${errMsg(e)}` }, { status: 500 }) }

  // Push only for high-priority items, and only if push is configured.
  let sent = 0
  if (watch.priority === 'high' && isPushConfigured()) {
    const subs = await listAllSubscriptions()
    const payload = { title: watch.title, body: watch.body, url: '/hq?screen=agent' }
    const okEndpoints: string[] = []
    for (const { endpoint, sub } of subs) {
      const res = await sendPush(sub, payload)
      if (res === 'ok') { sent++; okEndpoints.push(endpoint) }
      else if (res === 'gone') await deleteSubscription(endpoint)
    }
    await markSent(okEndpoints)
  }

  return NextResponse.json({ ok: true, surfaced: true, priority: watch.priority, pushed: sent, key: watch.key })
}
