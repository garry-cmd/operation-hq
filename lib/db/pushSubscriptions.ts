import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type { WebPushSub } from '@/lib/push'

type Row = { user_id?: string; endpoint: string; p256dh: string; auth: string }

function toSub(r: Row): { userId?: string; endpoint: string; sub: WebPushSub } {
  return { userId: r.user_id, endpoint: r.endpoint, sub: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } } }
}

export async function saveSubscription(userId: string, sub: WebPushSub, userAgent?: string): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent ?? null },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
}

export async function listSubscriptions(userId: string) {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((r) => toSub(r as Row))
}

export async function listAllSubscriptions() {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.from('push_subscriptions').select('user_id, endpoint, p256dh, auth')
  if (error) throw error
  return (data ?? []).map((r) => toSub(r as Row))
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const admin = getSupabaseAdmin()
  await admin.from('push_subscriptions').delete().eq('endpoint', endpoint)
}

export async function markSent(endpoints: string[]): Promise<void> {
  if (!endpoints.length) return
  const admin = getSupabaseAdmin()
  await admin.from('push_subscriptions').update({ last_sent_at: new Date().toISOString() }).in('endpoint', endpoints)
}
