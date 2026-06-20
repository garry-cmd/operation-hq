import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type VoiceStatus = 'idle' | 'listening' | 'thinking' | 'speaking'

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

/** Strip markdown / symbols so they aren't read aloud literally. */
function cleanForSpeech(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-—–]{2,}\s*$/gm, ' ')
    .replace(/[•▪#*_`>]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Pull leading complete sentences from a streaming buffer. A sentence is
 *  complete once its terminator is followed by more text (so mid-number "3.5"
 *  isn't split); a newline is always a hard boundary. Trailing partial stays. */
function takeSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let rest = buf
  const re = /[.!?…\n]/
  for (;;) {
    const m = re.exec(rest)
    if (!m) break
    const end = m.index + 1
    const piece = rest.slice(0, end)
    const after = rest.slice(end)
    const isNewline = piece[piece.length - 1] === '\n'
    if (!isNewline && after.length === 0) break // terminator at very end — might be incomplete; wait
    sentences.push(piece.trim())
    rest = after.replace(/^\s+/, '')
    if (!rest) break
  }
  return { sentences: sentences.filter(Boolean), rest }
}

export function useVoice(opts?: { onError?: (m: string) => void }) {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [supported, setSupported] = useState(true)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<string[]>([])       // sentences waiting to be spoken
  const playingRef = useRef(false)
  const ttsBufRef = useRef('')                // streamed text accumulator
  const sessionRef = useRef(false)            // a speak session is in progress

  const fail = useCallback((m: string) => opts?.onError?.(m), [opts])

  useEffect(() => {
    const ok = typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function'
      && 'MediaRecorder' in window
    if (!ok) setSupported(false)
    return () => { try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {} }
  }, [])

  // ── TTS playback queue ──
  const drainIdle = useCallback(() => {
    if (!sessionRef.current && !playingRef.current && queueRef.current.length === 0) setStatus('idle')
  }, [])

  const playNext = useCallback(async () => {
    if (playingRef.current) return
    const next = queueRef.current.shift()
    if (next == null) { drainIdle(); return }
    playingRef.current = true
    try {
      const r = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ text: next }),
      })
      if (!r.ok) throw new Error('tts')
      const buf = await r.arrayBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
      const audio = audioRef.current ?? new Audio()
      audioRef.current = audio
      audio.src = url
      setStatus('speaking')
      await new Promise<void>((resolve) => {
        audio.onended = () => { URL.revokeObjectURL(url); resolve() }
        audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
        audio.play().catch(() => resolve())
      })
    } catch {
      /* skip a failed sentence rather than stalling the queue */
    } finally {
      playingRef.current = false
      if (queueRef.current.length) playNext()
      else drainIdle()
    }
  }, [drainIdle])

  const enqueue = useCallback((raw: string) => {
    const clean = cleanForSpeech(raw)
    if (!clean) return
    queueRef.current.push(clean)
    if (!playingRef.current) playNext()
  }, [playNext])

  // ── Speak session (driven by the agent text stream) ──
  const beginSpeech = useCallback(() => { sessionRef.current = true; ttsBufRef.current = '' }, [])

  const pushSpeech = useCallback((chunk: string) => {
    if (!sessionRef.current) return
    ttsBufRef.current += chunk
    const { sentences, rest } = takeSentences(ttsBufRef.current)
    ttsBufRef.current = rest
    sentences.forEach(enqueue)
  }, [enqueue])

  const endSpeech = useCallback(() => {
    sessionRef.current = false
    const rest = ttsBufRef.current.trim()
    ttsBufRef.current = ''
    if (rest) enqueue(rest)
    else drainIdle()
  }, [enqueue, drainIdle])

  const stopSpeaking = useCallback(() => {
    sessionRef.current = false
    queueRef.current = []
    ttsBufRef.current = ''
    const a = audioRef.current
    if (a) { try { a.pause(); a.currentTime = 0 } catch {} }
    playingRef.current = false
    setStatus(s => (s === 'speaking' ? 'idle' : s))
  }, [])

  // ── Recording ──
  const startListening = useCallback(async () => {
    if (status !== 'idle') return
    stopSpeaking() // barge-in: silence any playback when the user starts talking
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      recRef.current = rec
      rec.start()
      setStatus('listening')
    } catch {
      fail('Microphone access denied')
      setStatus('idle')
    }
  }, [status, stopSpeaking, fail])

  /** Stop recording and transcribe. Returns the transcript ('' if nothing heard). */
  const stopListening = useCallback(async (): Promise<string> => {
    const rec = recRef.current
    if (!rec || status !== 'listening') return ''
    setStatus('thinking')
    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }))
      rec.stop()
    })
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    streamRef.current = null; recRef.current = null
    if (!blob.size) { setStatus('idle'); return '' }
    try {
      const r = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': blob.type, ...(await authHeader()) },
        body: blob,
      })
      if (!r.ok) { fail('Could not transcribe that'); setStatus('idle'); return '' }
      const { text } = await r.json()
      const t = String(text || '').trim()
      if (!t) setStatus('idle')
      return t
    } catch {
      fail('Transcription error'); setStatus('idle'); return ''
    }
  }, [status, fail])

  return {
    status, supported,
    startListening, stopListening,
    beginSpeech, pushSpeech, endSpeech, stopSpeaking,
  }
}
