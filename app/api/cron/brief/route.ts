import { NextResponse } from 'next/server'
import { generateBrief, saveBrief } from '@/lib/briefing'
import { listAllSubscriptions, deleteSubscription, markSent } from '@/lib/db/pushSubscriptions'
import { sendPush, isPushConfigured } from '@/lib/push'
import { APP_TZ } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Single-user system — the scheduled brief is always for the owner.
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

/** GET — invoked by Vercel Cron on a schedule. Authed by CRON_SECRET (Vercel
 *  sends it as a Bearer token). Builds today's brief and pushes to everyone. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isPushConfigured()) return NextResponse.json({ error: 'push not configured' }, { status: 503 })

  const today = pacificToday()
  const weekStart = mondayOf(today)

  let brief
  try { brief = await generateBrief({ today, weekStart }) }
  catch (e) { return NextResponse.json({ error: `brief failed: ${errMsg(e)}` }, { status: 502 }) }
  try { await saveBrief(OWNER_USER_ID, brief, { forDate: today, source: 'cron' }) } catch (e) { console.error('saveBrief (cron)', errMsg(e)) }

  const subs = await listAllSubscriptions()
  const payload = { title: brief.title, body: brief.body, url: '/hq?screen=agent' }
  let sent = 0
  const okEndpoints: string[] = []
  for (const { endpoint, sub } of subs) {
    const res = await sendPush(sub, payload)
    if (res === 'ok') { sent++; okEndpoints.push(endpoint) }
    else if (res === 'gone') await deleteSubscription(endpoint)
  }
  await markSent(okEndpoints)
  return NextResponse.json({ ok: true, sent, total: subs.length })
}
