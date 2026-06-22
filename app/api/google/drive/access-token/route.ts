import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET → { access_token, app_id }
 *  A fresh Google OAuth access token for the browser-side Google Picker, plus
 *  the Cloud project number (app_id). The Picker MUST be given the app_id via
 *  setAppId or files selected under the drive.file scope come back 404 when the
 *  backend tries to read them — the picked-file grant only associates to the app
 *  when the project is identified. The project number is the leading segment of
 *  the OAuth client id (`PROJECTNUMBER-hash.apps.googleusercontent.com`), so we
 *  derive it here rather than carrying a separate env var. The token is the
 *  user's own (calendar + drive.file), gated by their Supabase session. */
export async function GET(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { accessToken } = await getValidAccessToken(userId)
    const appId = (process.env.GOOGLE_CLIENT_ID ?? '').split('-')[0]
    return NextResponse.json({ access_token: accessToken, app_id: appId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const status = msg === 'not connected' ? 409 : 500
    console.error('GET /api/google/drive/access-token', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
