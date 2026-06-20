import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Default voice = ElevenLabs "Rachel"; override with ELEVENLABS_VOICE_ID.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'

/** POST { text } → ElevenLabs Flash v2.5 → streamed audio/mpeg. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return NextResponse.json({ error: 'text-to-speech is not configured' }, { status: 503 })
  try {
    const { text } = (await req.json().catch(() => ({}))) as { text?: string }
    const clean = (text ?? '').trim()
    if (!clean) return NextResponse.json({ error: 'no text' }, { status: 400 })

    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clean,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    )
    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => '')
      return NextResponse.json({ error: `tts failed ${r.status}`, detail: detail.slice(0, 300) }, { status: 502 })
    }
    return new Response(r.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    console.error('POST /api/voice/speak', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
