import { NextResponse } from 'next/server'
import { userIdFromRequest, getValidAccessToken, getDriveFileMeta } from '@/lib/google'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST { fileId, spaceId? } → tracks a Picker-selected Drive file.
 *
 *  Fetches the file's metadata server-side first — which both confirms HQ
 *  actually has drive.file access to it (the Picker grant) and caches its name /
 *  mime / modifiedTime. Then upserts a tracked_files row. Idempotent: tracking
 *  an already-tracked file returns the existing row (existed:true) rather than
 *  erroring on the unique drive_file_id. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { fileId?: string; spaceId?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }
  const fileId = body.fileId
  if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 })

  try {
    const { accessToken } = await getValidAccessToken(userId)
    const meta = await getDriveFileMeta(accessToken, fileId)
    const admin = getSupabaseAdmin()

    const { data: existing } = await admin
      .from('tracked_files').select('*').eq('drive_file_id', meta.id).maybeSingle()
    if (existing) return NextResponse.json({ file: existing, existed: true })

    const { data, error } = await admin
      .from('tracked_files')
      .insert({
        space_id: body.spaceId ?? null,
        drive_file_id: meta.id,
        name: meta.name,
        mime_type: meta.mimeType,
        drive_modified_time: meta.modifiedTime,
        status: 'new_in',
      })
      .select()
      .single()
    if (error) {
      // Postgrest errors are plain objects, not Error instances (Convention 9).
      const msg = (error && typeof error === 'object' && 'message' in error) ? String(error.message) : 'insert failed'
      console.error('POST /api/google/drive/track insert', msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    return NextResponse.json({ file: data, existed: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    const status = msg === 'not connected' ? 409 : 500
    console.error('POST /api/google/drive/track', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
