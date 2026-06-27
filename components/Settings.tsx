'use client'
import { PinIcon } from './Icons'
import { useCallback, useEffect, useState } from 'react'
import { getMonday } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { currentPushState, enablePush, disablePush, type PushState } from '@/lib/push/ensurePush'
import * as memoryDb from '@/lib/db/agentMemory'
import type { AgentMemory } from '@/lib/db/agentMemory'

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
const smallBtn: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 500, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--navy-600)', background: 'transparent', color: 'var(--navy-300)',
}
const memInput: React.CSSProperties = {
  width: '100%', fontSize: 13, lineHeight: 1.5, padding: '8px 10px', borderRadius: 8,
  border: '1px solid var(--navy-600)', background: 'var(--navy-900, var(--navy-800))',
  color: 'var(--nw-cream, var(--navy-100))', resize: 'vertical', fontFamily: 'inherit',
}

export default function Settings({ toast, googleConnected, driveGranted, onConnectGoogle }: {
  toast: (m: string) => void
  googleConnected: boolean
  driveGranted: boolean
  onConnectGoogle: () => void
}) {
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

  // ── Agent memory ──
  const [mems, setMems] = useState<AgentMemory[] | null>(null)
  const [adding, setAdding] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const unreviewedCount = (mems ?? []).filter(m => !m.reviewed_at && m.source).length

  const loadMems = useCallback(() => {
    memoryDb.listAll().then(setMems).catch(() => setMems([]))
  }, [])
  useEffect(() => { loadMems() }, [loadMems])

  const onAdd = async () => {
    const content = adding.trim()
    if (!content) return
    setAddBusy(true)
    try {
      await memoryDb.create(content)
      setAdding('')
      loadMems()
      toast('Saved to agent memory')
    } catch { toast('Could not save') } finally { setAddBusy(false) }
  }

  const startEdit = (m: AgentMemory) => { setEditId(m.id); setEditText(m.content) }
  const cancelEdit = () => { setEditId(null); setEditText('') }
  const saveEdit = async (id: string) => {
    const content = editText.trim()
    if (!content) return
    try {
      await memoryDb.updateContent(id, content)
      setMems(prev => (prev ?? []).map(m => (m.id === id ? { ...m, content } : m)))
      cancelEdit()
    } catch { toast('Could not update') }
  }

  const togglePin = async (m: AgentMemory) => {
    try {
      await memoryDb.setPinned(m.id, !m.pinned)
      loadMems()
    } catch { toast('Could not update') }
  }

  const onRemove = async (id: string) => {
    try {
      await memoryDb.remove(id)
      setMems(prev => (prev ?? []).filter(m => m.id !== id))
      toast('Forgotten')
    } catch { toast('Could not delete') }
  }

  const onConfirm = async (id: string) => {
    try {
      await memoryDb.confirm(id)
      setMems(prev => (prev ?? []).map(m => m.id === id ? { ...m, reviewed_at: new Date().toISOString() } : m))
    } catch { toast('Could not confirm') }
  }

  return (
    <main style={{ padding: '24px 28px', maxWidth: 800, width: '100%', margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--nw-cream, var(--navy-100))', margin: '0 0 4px', letterSpacing: '-.01em' }}>Settings</h1>
      <p style={{ fontSize: 13, color: 'var(--navy-400)', margin: '0 0 24px' }}>Preferences for this device.</p>

      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))', marginBottom: 4 }}>Google &amp; Drive</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy-300)', margin: '0 0 14px' }}>
          {!googleConnected
            ? 'Google isn’t connected. Connect to enable the calendar overlay and Drive-backed Files.'
            : driveGranted
              ? 'Connected, with Drive file access granted — Files can link and snapshot your client documents.'
              : 'Connected for Calendar. The Files module needs Drive access (drive.file — per-file only, not a broad read of your Drive). Re-grant to add it; your existing calendar connection is preserved.'}
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {!googleConnected ? (
            <button onClick={onConnectGoogle} style={btn('primary')}>Connect Google</button>
          ) : !driveGranted ? (
            <button onClick={onConnectGoogle} style={btn('primary')}>Grant Drive access</button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--ok, #7fe27a)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ok, #7fe27a)' }} />
              Drive access granted
            </span>
          )}
        </div>
        {googleConnected && !driveGranted && (
          <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--navy-500, var(--navy-400))', margin: '14px 0 0' }}>
            You’ll see Google’s consent screen asking for the new Drive permission. <strong>drive.file</strong> only grants access to files you explicitly pick (or that HQ creates) — never your whole Drive.
          </p>
        )}
      </div>

      <div style={{ ...card, marginTop: 18 }}>
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

      <div style={{ ...card, marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--nw-cream, var(--navy-100))' }}>Agent memory</div>
          {unreviewedCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', fontFamily: 'var(--font-mono)' }}>
              {unreviewedCount} new from Scout
            </span>
          )}
        </div>
        <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy-300)', margin: '0 0 14px' }}>
          Durable facts and preferences the Chief of Staff has learned about you. It saves these on its own as you chat, and reads them every conversation. Edit, pin, or delete anything here — pinned memories are kept first. You can also add one yourself.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 16 }}>
          <textarea
            value={adding}
            onChange={e => setAdding(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onAdd() } }}
            placeholder="Tell the agent something to remember…"
            rows={2}
            style={{ ...memInput, flex: 1 }}
          />
          <button onClick={onAdd} disabled={addBusy || !adding.trim()} style={{ ...btn('primary'), opacity: addBusy || !adding.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {addBusy ? 'Saving…' : 'Add'}
          </button>
        </div>

        {mems === null ? (
          <p style={{ fontSize: 12.5, color: 'var(--navy-400)', margin: 0 }}>Loading…</p>
        ) : mems.length === 0 ? (
          <p style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--navy-400)', margin: 0 }}>
            Nothing saved yet. As you talk with the Chief of Staff, it’ll remember durable facts — how you work, who people are, standing context about your spaces — and they’ll show up here.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {mems.map(m => (
              <li key={m.id} style={{
                border: '1px solid var(--navy-700, var(--navy-600))', borderRadius: 9, padding: '10px 12px',
                background: !m.reviewed_at && m.source ? 'var(--amber-bg)' : m.pinned ? 'var(--navy-700, var(--navy-800))' : 'transparent',
                borderColor: !m.reviewed_at && m.source ? 'var(--amber-text)' : undefined,
              }}>
                {editId === m.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2} style={memInput} autoFocus />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => saveEdit(m.id)} disabled={!editText.trim()} style={{ ...smallBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>Save</button>
                      <button onClick={cancelEdit} style={smallBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Kind badge + provenance row */}
                    {(m.kind || m.source) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {m.kind && (
                          <span style={{
                            fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 99,
                            fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.1em',
                            background: m.kind === 'preference' ? 'var(--accent-bg)' : m.kind === 'fact' ? 'var(--teal-bg)' : 'var(--slate-bg)',
                            color: m.kind === 'preference' ? 'var(--accent)' : m.kind === 'fact' ? 'var(--teal-text)' : 'var(--slate-text)',
                          }}>{m.kind}</span>
                        )}
                        {m.source && (
                          <span style={{ fontSize: 11, color: 'var(--navy-400)', fontFamily: 'var(--font-mono)' }}>{m.source}</span>
                        )}
                        {!m.reviewed_at && m.source && (
                          <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 99, background: 'var(--amber-text)', color: 'var(--navy-900)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>unreviewed</span>
                        )}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5, color: 'var(--nw-cream, var(--navy-100))' }}>
                        {m.pinned && <PinIcon size={11} color="var(--accent)" style={{ marginRight: 5, flexShrink: 0 }}/>}
                        {m.content}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {!m.reviewed_at && m.source && (
                          <button onClick={() => onConfirm(m.id)} style={{ ...smallBtn, color: 'var(--ok, #7fe27a)', borderColor: 'var(--ok, #7fe27a)' }}>Keep</button>
                        )}
                        <button onClick={() => togglePin(m)} style={smallBtn} title={m.pinned ? 'Unpin' : 'Pin (keep first)'}>{m.pinned ? 'Unpin' : 'Pin'}</button>
                        <button onClick={() => startEdit(m)} style={smallBtn}>Edit</button>
                        <button onClick={() => onRemove(m.id)} style={{ ...smallBtn, color: 'var(--nw-rose, #d66)', borderColor: 'var(--navy-600)' }}>Delete</button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
