import { NextResponse } from 'next/server'
import { userIdFromRequest, signState, buildConsentUrl } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Called via fetch with the user's Supabase Bearer token. Returns the Google
// consent URL (with user_id baked into a signed state); the client redirects.
export async function GET(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ url: buildConsentUrl(signState(userId)) })
  } catch {
    return NextResponse.json({ error: 'Google not configured' }, { status: 500 })
  }
}
