import { NextResponse } from 'next/server'
import { verifyState, exchangeCode, ensureHqCalendar, saveTokens, appOrigin } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Google redirects the browser here after consent. No app session is present —
// we recover the user from the signed state, exchange the code, ensure the HQ
// calendar exists, persist tokens (service role), then bounce back to /hq.
export async function GET(req: Request) {
  let origin = ''
  try { origin = appOrigin() } catch { return NextResponse.json({ error: 'Google not configured' }, { status: 500 }) }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) return NextResponse.redirect(`${origin}/hq?google=denied`)
  if (!code || !state) return NextResponse.redirect(`${origin}/hq?google=error`)

  const userId = verifyState(state)
  if (!userId) return NextResponse.redirect(`${origin}/hq?google=error`)

  try {
    const tokens = await exchangeCode(code)
    const hqCalendarId = await ensureHqCalendar(tokens.access_token)
    await saveTokens(userId, tokens, hqCalendarId)
    return NextResponse.redirect(`${origin}/hq?google=connected`)
  } catch {
    return NextResponse.redirect(`${origin}/hq?google=error`)
  }
}
