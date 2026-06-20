'use client'
import { supabase } from '@/lib/supabase'

export type PushState = 'unsupported' | 'no-vapid' | 'default' | 'denied' | 'subscribed' | 'error'

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

async function token(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

/** Idempotent. If permission is already granted, (re)register the SW, ensure a
 *  push subscription, and sync it to the server — no user interaction. Safe to
 *  call on every app load; this is what makes briefings persist across restarts. */
export async function ensurePushSubscription(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapid) return 'no-vapid'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'default'
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) })
    const tk = await token()
    if (tk) {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ subscription: sub.toJSON(), userAgent: navigator.userAgent }),
      }).catch(() => {})
    }
    return 'subscribed'
  } catch {
    return 'error'
  }
}

/** One-time opt-in: prompt for permission, then subscribe. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return 'no-vapid'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default'
  }
  return ensurePushSubscription()
}

export async function disablePush(): Promise<void> {
  if (!supported()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe().catch(() => {})
    const tk = await token()
    if (tk) {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {})
    }
  } catch { /* ignore */ }
}

/** Current state without side effects (for rendering toggle UI). */
export async function currentPushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return 'no-vapid'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'default'
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    return sub ? 'subscribed' : 'default'
  } catch {
    return 'error'
  }
}
