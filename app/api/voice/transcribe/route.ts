import { NextResponse } from 'next/server'
import { userIdFromRequest } from '@/lib/google'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST: raw audio bytes (audio/webm from the mic) → Deepgram Nova-3 → { text }. */
export async function POST(req: Request) {
  const userId = await userIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) return NextResponse.json({ error: 'speech-to-text is not configured' }, { status: 503 })
  try {
    const contentType = req.headers.get('content-type') || 'audio/webm'
    const audio = await req.arrayBuffer()
    if (!audio || audio.byteLength === 0) return NextResponse.json({ error: 'no audio' }, { status: 400 })

    const r = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': contentType },
      body: audio,
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return NextResponse.json({ error: `transcribe failed ${r.status}`, detail: detail.slice(0, 300) }, { status: 502 })
    }
    const data = await r.json()
    const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ''
    return NextResponse.json({ text: String(text).trim() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    console.error('POST /api/voice/transcribe', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
