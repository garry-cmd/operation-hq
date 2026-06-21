import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET → { access_token }
 *  A fresh Google OAuth access token for the browser-side Google Picker. The
 *  token carries only calendar + drive.file scope, and it's the user's own
 *  token — gated by their Supabase session. Short-lived (~1h); the Picker uses
 *  it immediately. */
export async function GET(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { accessToken } = await getValidAccessToken(userId)
    return NextResponse.json({ access_token: accessToken })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const status = msg === 'not connected' ? 409 : 500
    console.error('GET /api/google/drive/access-token', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
