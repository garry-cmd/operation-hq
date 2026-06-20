'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getMonday } from '@/lib/utils'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type State = 'unsupported' | 'idle' | 'subscribing' | 'subscribed' | 'denied' | 'error'

const btn: React.CSSProperties = { fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' }
const btnGhost: React.CSSProperties = { fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--navy-200)' }

export default function PushSetup() {
  const [state, setState] = useState<State>('idle')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    if (!ok) { setState('unsupported'); return }
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (!reg) return
      const sub = await reg.pushManager.getSubscription()
      if (sub) setState('subscribed')
    }).catch(() => {})
  }, [])

  const subscribe = useCallback(async () => {
    if (!vapid) { setState('error'); setMsg('VAPID public key missing (NEXT_PUBLIC_VAPID_PUBLIC_KEY)'); return }
    setState('subscribing'); setMsg('')
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState('denied'); setMsg('Notification permission denied'); return }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) })
      const r = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `save failed ${r.status}`) }
      setState('subscribed'); setMsg('')
    } catch (e) {
      setState('error'); setMsg(e instanceof Error ? e.message : 'subscribe failed')
    }
  }, [vapid])

  const sendTest = useCallback(async () => {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ today: todayStr(), weekStart: getMonday() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `test failed ${r.status}`)
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('hq:brief-saved'))
      setMsg(j.sent ? `Sent to ${j.sent} device${j.sent === 1 ? '' : 's'} — check your notifications.` : (j.error || 'No devices subscribed yet.'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'test failed')
    } finally { setBusy(false) }
  }, [])

  if (state === 'unsupported') return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, marginTop: 10 }}>
      {state !== 'subscribed' ? (
        <button onClick={subscribe} disabled={state === 'subscribing'} style={btn}>
          {state === 'subscribing' ? 'Enabling…' : 'Enable briefings'}
        </button>
      ) : (
        <>
          <span style={{ color: 'var(--nw-nominal-text)' }}>● Briefings on</span>
          <button onClick={sendTest} disabled={busy} style={btnGhost}>{busy ? 'Sending…' : 'Send test brief'}</button>
        </>
      )}
      {msg && <span style={{ color: 'var(--navy-300)' }}>{msg}</span>}
    </div>
  )
}
