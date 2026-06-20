import webpush from 'web-push'

let configured = false
function ensure(): void {
  if (configured) return
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:garry@keeply.boats'
  if (!pub || !priv) throw new Error('VAPID keys not configured')
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
}

export function isPushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export type WebPushSub = { endpoint: string; keys: { p256dh: string; auth: string } }

/** 'ok' | 'gone' (dead endpoint — prune it) | 'error'. */
export async function sendPush(sub: WebPushSub, payload: object): Promise<'ok' | 'gone' | 'error'> {
  ensure()
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload))
    return 'ok'
  } catch (e) {
    const code = (e && typeof e === 'object' && 'statusCode' in e) ? (e as { statusCode?: number }).statusCode : undefined
    if (code === 404 || code === 410) return 'gone'
    return 'error'
  }
}
