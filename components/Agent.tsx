'use client'
/**
 * Agent — the HQ chief-of-staff chat with propose-first actions. Each message
 * ships the running history to /api/agent, which rebuilds a fresh HQ snapshot
 * server-side and returns Claude's reply plus any PROPOSED actions (tool calls).
 * Proposals are NOT executed by the model — they render as confirmation cards;
 * the operator approves, and only then does the client run the mutation through
 * the same db helpers the rest of the app uses (so state stays consistent).
 * History is in-session only.
 */
import { useState, useRef, useEffect } from 'react'
import { getMonday } from '@/lib/utils'
import { sendAgentMessage, type AgentMessage, type ProposedAction } from '@/lib/db/agentApi'
import * as tasksDb from '@/lib/db/tasks'
import * as krsDb from '@/lib/db/krs'
import type { Task, RoadmapItem, Space, HealthStatus } from '@/lib/types'

const STARTERS = [
  "What's slipping right now?",
  'What should I focus on today?',
  'Is my week realistic?',
  "What have I been dropping?",
]

type ActionStatus = 'pending' | 'approved' | 'dismissed' | 'failed'
interface UIAction extends ProposedAction { id: string; status: ActionStatus }
interface ChatMsg { role: 'user' | 'assistant'; content: string; actions?: UIAction[] }

const nwLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase',
  color: 'var(--nw-label)', margin: 0,
}

function stripId(v: unknown, prefix: string): string {
  const s = String(v ?? '').trim()
  return s.startsWith(prefix + ':') ? s.slice(prefix.length + 1) : s
}

// Minimal inline render: **bold** + preserved line breaks, leading "- " → "• ".
function renderContent(text: string): React.ReactNode {
  return text.split('\n').map((line, li) => {
    const bulleted = /^\s*[-*]\s+/.test(line)
    const body = bulleted ? line.replace(/^\s*[-*]\s+/, '') : line
    const parts = body.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
      /^\*\*[^*]+\*\*$/.test(seg)
        ? <strong key={si} style={{ color: 'var(--navy-50)', fontWeight: 600 }}>{seg.slice(2, -2)}</strong>
        : <span key={si}>{seg}</span>,
    )
    return (
      <div key={li} style={{ display: 'flex', gap: bulleted ? 7 : 0, paddingLeft: bulleted ? 2 : 0, minHeight: line === '' ? 8 : undefined }}>
        {bulleted && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span>}
        <span>{parts}</span>
      </div>
    )
  })
}

export default function Agent({
  tasks, setTasks, roadmapItems, setRoadmapItems, spaces, toast,
}: {
  tasks: Task[]
  setTasks: (fn: (p: Task[]) => Task[]) => void
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  spaces: Space[]
  toast: (m: string) => void
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const weekStart = getMonday()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  // ── describe a proposed action for its card label ──
  function describe(a: ProposedAction): string {
    const input = a.input
    if (a.tool === 'complete_task') {
      const id = stripId(input.task_id, 'task'); const t = tasks.find(x => x.id === id)
      return `Mark “${t?.title ?? id}” done`
    }
    if (a.tool === 'reschedule_task') {
      const id = stripId(input.task_id, 'task'); const t = tasks.find(x => x.id === id)
      return `Move “${t?.title ?? id}” → ${String(input.due_date ?? '')}`
    }
    if (a.tool === 'add_task') {
      const sid = stripId(input.space_id, 'space')
      const sp = sid ? spaces.find(s => s.id === sid)?.name : null
      const due = input.due_date ? ` · due ${String(input.due_date)}` : ''
      return `Add task “${String(input.title ?? '')}”${sp ? ` to ${sp}` : ''}${due}`
    }
    if (a.tool === 'set_kr_health') {
      const id = stripId(input.kr_id, 'kr'); const k = roadmapItems.find(x => x.id === id)
      return `Set “${k?.title ?? id}” → ${String(input.health ?? '').replace('_', ' ')}`
    }
    return a.tool
  }

  // ── run a proposed action (only after approval) ──
  async function run(a: ProposedAction): Promise<void> {
    const input = a.input
    if (a.tool === 'complete_task') {
      const id = stripId(input.task_id, 'task')
      if (!tasks.some(t => t.id === id)) throw new Error('Task not found')
      const at = new Date().toISOString()
      await tasksDb.update(id, { completed_at: at })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, completed_at: at } : t))
      return
    }
    if (a.tool === 'reschedule_task') {
      const id = stripId(input.task_id, 'task'); const due = String(input.due_date ?? '')
      if (!tasks.some(t => t.id === id)) throw new Error('Task not found')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Bad date')
      await tasksDb.update(id, { due_date: due })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, due_date: due } : t))
      return
    }
    if (a.tool === 'add_task') {
      const title = String(input.title ?? '').trim()
      if (!title) throw new Error('No title')
      const sid = stripId(input.space_id, 'space') || null
      const due = input.due_date ? String(input.due_date) : null
      const created = await tasksDb.create({ title, space_id: sid, due_date: due })
      setTasks(prev => [...prev, created])
      return
    }
    if (a.tool === 'set_kr_health') {
      const id = stripId(input.kr_id, 'kr'); const health = String(input.health ?? '') as HealthStatus
      if (!roadmapItems.some(k => k.id === id)) throw new Error('KR not found')
      await krsDb.update(id, { health_status: health })
      setRoadmapItems(prev => prev.map(k => k.id === id ? { ...k, health_status: health } : k))
      return
    }
    throw new Error('Unknown action')
  }

  function setActionStatus(msgIdx: number, actionId: string, status: ActionStatus) {
    setMessages(prev => prev.map((m, i) =>
      i === msgIdx && m.actions ? { ...m, actions: m.actions.map(a => a.id === actionId ? { ...a, status } : a) } : m,
    ))
  }

  async function approve(msgIdx: number, a: UIAction) {
    try { await run(a); setActionStatus(msgIdx, a.id, 'approved') }
    catch (e) { setActionStatus(msgIdx, a.id, 'failed'); toast(e instanceof Error ? e.message : 'Action failed') }
  }

  async function approveAll(msgIdx: number, actions: UIAction[]) {
    for (const a of actions) if (a.status === 'pending') await approve(msgIdx, a)
  }

  async function send(text: string) {
    const content = text.trim()
    if (!content || pending) return
    const next: ChatMsg[] = [...messages, { role: 'user', content }]
    setMessages(next)
    setInput('')
    setPending(true)
    try {
      const history: AgentMessage[] = next.map(({ role, content }) => ({ role, content }))
      const { reply, actions } = await sendAgentMessage(history, today, weekStart)
      const uiActions: UIAction[] = actions.map(a => ({ ...a, id: crypto.randomUUID(), status: 'pending' as const }))
      setMessages([...next, { role: 'assistant', content: reply, actions: uiActions.length ? uiActions : undefined }])
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Agent failed')
      setMessages(messages)
      setInput(content)
    } finally {
      setPending(false)
      taRef.current?.focus()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <div style={{ height: 'calc(100vh - 0px)', display: 'flex', flexDirection: 'column', maxWidth: 860, width: '100%', margin: '0 auto', padding: '20px 24px 16px' }}>
      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <h3 style={nwLabel}>Chief of Staff</h3>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--navy-400)' }}>
          Knows your whole operation — spaces, KRs, tasks, calendar, reflections. It can also propose actions; nothing changes until you approve.
        </p>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 4 }}>
        {messages.length === 0 && !pending && (
          <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: 'var(--navy-400)' }}>
            <p style={{ fontSize: 14, margin: 0, textAlign: 'center', maxWidth: 440, lineHeight: 1.5 }}>
              Your chief of staff is up to speed on everything in HQ. Start with one of these or ask your own.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 520 }}>
              {STARTERS.map(s => (
                <button key={s} onClick={() => send(s)} style={{
                  fontSize: 13, padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                  background: 'var(--navy-800)', border: '1px solid var(--navy-600)', color: 'var(--navy-100)',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 8 }}>
            <div style={{
              maxWidth: m.role === 'user' ? '78%' : '92%',
              padding: m.role === 'user' ? '10px 14px' : '12px 16px',
              borderRadius: 14,
              background: m.role === 'user' ? 'var(--accent)' : 'var(--navy-800)',
              border: m.role === 'user' ? '1px solid var(--accent)' : '1px solid var(--navy-600)',
              color: m.role === 'user' ? '#fff' : 'var(--navy-100)',
              fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {m.role === 'assistant' ? renderContent(m.content) : m.content}
            </div>

            {m.actions && m.actions.length > 0 && (
              <div style={{ width: '92%', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {m.actions.map(a => (
                  <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                    background: 'var(--navy-800)',
                    border: `1px solid ${a.status === 'approved' ? 'var(--nw-nominal-text)' : a.status === 'failed' ? 'var(--nw-alarm-text)' : 'var(--navy-600)'}`,
                    opacity: a.status === 'dismissed' ? 0.5 : 1,
                  }}>
                    <span style={{ fontSize: 13, flex: 1, color: 'var(--navy-100)', textDecoration: a.status === 'dismissed' ? 'line-through' : 'none' }}>
                      {a.status === 'approved' && <span style={{ color: 'var(--nw-nominal-text)', marginRight: 6 }}>✓</span>}
                      {a.status === 'failed' && <span style={{ color: 'var(--nw-alarm-text)', marginRight: 6 }}>⚠</span>}
                      {describe(a)}
                    </span>
                    {a.status === 'pending' && (
                      <>
                        <button onClick={() => approve(i, a)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' }}>Approve</button>
                        <button onClick={() => setActionStatus(i, a.id, 'dismissed')} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--navy-300)' }}>Dismiss</button>
                      </>
                    )}
                    {a.status === 'approved' && <span style={{ fontSize: 11, color: 'var(--nw-nominal-text)' }}>done</span>}
                    {a.status === 'dismissed' && <span style={{ fontSize: 11, color: 'var(--navy-400)' }}>dismissed</span>}
                    {a.status === 'failed' && <button onClick={() => approve(i, a)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--navy-300)' }}>Retry</button>}
                  </div>
                ))}
                {m.actions.filter(a => a.status === 'pending').length > 1 && (
                  <button onClick={() => approveAll(i, m.actions!)} style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                    Approve all ({m.actions.filter(a => a.status === 'pending').length})
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {pending && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '12px 16px', borderRadius: 14, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', display: 'flex', gap: 5 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--navy-400)', animation: `agentdot 1s ${i * 0.18}s infinite` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={taRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask your chief of staff…"
          rows={1}
          style={{
            flex: 1, resize: 'none', maxHeight: 160, padding: '11px 14px', borderRadius: 12,
            background: 'var(--navy-800)', border: '1px solid var(--navy-600)', color: 'var(--navy-50)',
            fontSize: 14, lineHeight: 1.5, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          onClick={() => send(input)}
          disabled={pending || !input.trim()}
          style={{
            flexShrink: 0, padding: '11px 18px', borderRadius: 12, cursor: pending || !input.trim() ? 'default' : 'pointer',
            background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600,
            opacity: pending || !input.trim() ? 0.5 : 1,
          }}
        >Send</button>
      </div>

      <style>{`@keyframes agentdot { 0%,60%,100% { opacity:.3; transform:translateY(0) } 30% { opacity:1; transform:translateY(-3px) } }`}</style>
    </div>
  )
}
