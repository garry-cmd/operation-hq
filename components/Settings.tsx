'use client'
import { useCallback, useEffect, useState } from 'react'
import { getMonday } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { currentPushState, enablePush, disablePush, type PushState } from '@/lib/push/ensurePush'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const card: React.CSSProperties = {
  border: '1px solid var(--navy-600)', borderRadius: 12, padding: 18,
  background: 'var(--navy-800)', maxWidth: 560,
}
const btn = (variant: 'primary' | 'ghost'): React.CSSProperties => ({
  fontSize: 13, fontWeight: 500, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
  border: variant === 'primary' ? 'none' : '1px solid var(--navy-600)',
  background: variant === 'primary' ? 'var(--accent)' : 'transparent',
  color: variant === 'primary' ? '#fff' : 'var(--navy-200)',
})

export default function Settings({ toast }: { toast: (m: string) => void }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const refresh = useCallback(() => { currentPushState().then(setState) }, [])
  useEffect(() => { refresh() }, [refresh])

  const onEnable = async () => {
    setBusy(true)
    const s = await enablePush()
    setState(s)
    setBusy(false)
    if (s === 'subscribed') toast('Briefings enabled')
    else if (s === 'denied') toast('Notifications blocked — allow them in your browser settings')
    else if (s === 'default') toast('Permission not granted')
  }

  const onDisable = async () => {
    setBusy(true)
    await disablePush()
    setBusy(false)
    refresh()
    toast('Briefings disabled on this device')
  }

  const onTest = async () => {
    setTesting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const tk = session?.access_token
      if (!tk) { toast('Not signed in'); return }
      const r = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ today: todayStr(), weekStart: getMonday() }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast(j.error || `Test failed (${r.status})`); return }
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('hq:brief-saved'))
      toast(j.sent ? `Sent to ${j.sent} device${j.sent === 1 ? '' : 's'}` : (j.error || 'No devices subscribed'))
    } catch {
      toast('Test failed')
    } finally {
      setTesting(false)
    }
  }

  const enabled = state === 'subscribed'
  const statusText =
    state === 'subscribed' ? 'On — this device will receive the daily 7am brief and any test sends.'
    : state === 'denied' ? 'Blocked. Notifications are turned off for this site in your browser. Re-enable them in the browser site settings, then reload.'
    : state === 'unsupported' ? 'This browser doesn’t support web push notifications.'
    : state === 'no-vapid' ? 'Push isn’t configured on the server (missing VAPID key).'
    : 'Off on this device.'

  return (
    <main style={{ padding: '24px 28px', maxWidth: 800, width: '100%', margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--nw-cream, var(--navy-100))', margin: '0 0 4px', letterSpacing: '-.01em' }}>Settings</h1>
      <p style={{ fontSize: 13, color: 'var(--navy-400)', margin: '0 0 24px' }}>Preferences for this device.</p>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))', marginBottom: 4 }}>Daily briefings</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy-300)', margin: '0 0 14px' }}>{statusText}</p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {enabled ? (
            <button onClick={onDisable} disabled={busy} style={btn('ghost')}>{busy ? 'Working…' : 'Turn off'}</button>
          ) : (
            <button onClick={onEnable} disabled={busy || state === 'denied' || state === 'unsupported' || state === 'no-vapid'} style={btn('primary')}>
              {busy ? 'Enabling…' : 'Turn on'}
            </button>
          )}
          {enabled && (
            <button onClick={onTest} disabled={testing} style={btn('ghost')}>{testing ? 'Sending…' : 'Send test brief'}</button>
          )}
        </div>

        <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--navy-500, var(--navy-400))', margin: '14px 0 0' }}>
          Once on, briefings stay on — HQ re-establishes the subscription automatically each time you open it. You only turn it on once per device.
        </p>
      </div>
    </main>
  )
}
