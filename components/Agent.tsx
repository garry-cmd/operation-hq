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
import { streamAgentMessage, type AgentMessage, type ProposedAction } from '@/lib/db/agentApi'
import { runProposedAction, describeAction, type ActionContext } from '@/lib/agentActions'
import { useVoice } from '@/lib/voice/useVoice'
import BriefingsFeed from '@/components/BriefingsFeed'
import type { Task, RoadmapItem, Space, CalendarBlock, Note, AnnualObjective } from '@/lib/types'

const STARTERS = [
  "What's slipping right now?",
  'What should I focus on today?',
  'Is my week realistic?',
  "What have I been dropping?",
]

export type ActionStatus = 'pending' | 'approved' | 'dismissed' | 'failed'
export interface UIAction extends ProposedAction { id: string; status: ActionStatus }
export interface ChatMsg { role: 'user' | 'assistant'; content: string; actions?: UIAction[] }

const nwLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase',
  color: 'var(--nw-label)', margin: 0,
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

// Classify a spoken reply to a proposal as a confirm / deny / neither. Local
// keyword match — boring + reliable for a binary yes/no; anything unclear falls
// through to a normal new turn. 'yes' is tested first so "no, do it" reads as yes.
function classifyConfirm(t: string): 'yes' | 'no' | 'unclear' {
  const s = t.toLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\b(yes|yeah|yep|yup|sure|do it|go ahead|go for it|confirm|confirmed|approve|approved|please do|sounds good|affirmative|aye|okay|okey|ok)\b/.test(s)) return 'yes'
  if (/\b(no|nope|nah|skip|cancel|cancelled|don't|dont|do not|stop|negative|leave it|leave them|never mind|nevermind|forget it)\b/.test(s)) return 'no'
  return 'unclear'
}

export default function Agent({
  tasks, setTasks, roadmapItems, setRoadmapItems, spaces, setCalendarBlocks, notes, setNotes, objectives, setObjectives, onOpenNote, toast,
  messages, setMessages, pending, setPending,
}: {
  tasks: Task[]
  setTasks: (fn: (p: Task[]) => Task[]) => void
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  spaces: Space[]
  setCalendarBlocks: (fn: (p: CalendarBlock[]) => CalendarBlock[]) => void
  notes: Note[]
  setNotes: (fn: (p: Note[]) => Note[]) => void
  objectives: AnnualObjective[]
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  onOpenNote?: (noteId: string) => void
  toast: (m: string) => void
  // Conversation state lives in page.tsx so the thread (and any in-flight
  // streamed reply, which keeps writing through these setters) survives
  // navigating away from the Chief of Staff screen.
  messages: ChatMsg[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMsg[]>>
  pending: boolean
  setPending: React.Dispatch<React.SetStateAction<boolean>>
}) {
  const [input, setInput] = useState('')
  // When a voice turn proposes actions, the index of that assistant message —
  // the next spoken "yes/no" resolves its pending proposals (Voice Step 2).
  const [confirmMsgIdx, setConfirmMsgIdx] = useState<number | null>(null)
  const voice = useVoice({ onError: toast })
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const ctx: ActionContext = { tasks, roadmapItems, spaces, notes, objectives, setTasks, setRoadmapItems, setCalendarBlocks, setNotes, setObjectives }

  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const weekStart = getMonday()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' })
  }, [messages, pending])

  function setActionStatus(msgIdx: number, actionId: string, status: ActionStatus) {
    setMessages(prev => prev.map((m, i) =>
      i === msgIdx && m.actions ? { ...m, actions: m.actions.map(a => a.id === actionId ? { ...a, status } : a) } : m,
    ))
  }

  async function approve(msgIdx: number, a: UIAction) {
    try { await runProposedAction(a, ctx); setActionStatus(msgIdx, a.id, 'approved') }
    catch (e) { setActionStatus(msgIdx, a.id, 'failed'); toast(e instanceof Error ? e.message : 'Action failed') }
  }

  async function approveAll(msgIdx: number, actions: UIAction[]) {
    for (const a of actions) if (a.status === 'pending') await approve(msgIdx, a)
  }

  // ── Voice Step 2: resolve a spoken yes/no against a turn's pending proposals ──
  async function confirmYes(msgIdx: number) {
    const pendingActions = messages[msgIdx]?.actions?.filter(a => a.status === 'pending') ?? []
    setConfirmMsgIdx(null)
    if (!pendingActions.length) return
    await approveAll(msgIdx, pendingActions)
    voice.say(pendingActions.length > 1 ? 'Done — all set.' : 'Done.')
  }

  function confirmNo(msgIdx: number) {
    const pendingActions = messages[msgIdx]?.actions?.filter(a => a.status === 'pending') ?? []
    setConfirmMsgIdx(null)
    pendingActions.forEach(a => setActionStatus(msgIdx, a.id, 'dismissed'))
    voice.say('Okay, leaving those.')
  }

  async function runTurn(text: string, speak: boolean) {
    const content = text.trim()
    if (!content || pending) return
    setConfirmMsgIdx(null) // a new turn closes any open voice-confirm window
    const prevState = messages
    const next: ChatMsg[] = [...messages, { role: 'user', content }]
    const assistantIdx = next.length
    setMessages(next)
    setInput('')
    setPending(true)
    if (speak) voice.beginSpeech()
    let started = false
    let proposed = false
    let assembled = ''
    try {
      const history: AgentMessage[] = next.map(({ role, content }) => ({ role, content }))
      await streamAgentMessage(history, today, weekStart, {
        onText: (delta) => {
          assembled += delta
          if (!started) {
            started = true
            setMessages(prev => [...prev, { role: 'assistant', content: assembled }])
          } else {
            setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: assembled } : m))
          }
          if (speak) voice.pushSpeech(delta)
        },
        onActions: (actions) => {
          const ui: UIAction[] = actions.map(a => ({ ...a, id: crypto.randomUUID(), status: 'pending' as const }))
          if (!ui.length) return
          proposed = true
          if (!started) {
            started = true
            assembled = assembled || 'I’ve proposed the following — approve below.'
            setMessages(prev => [...prev, { role: 'assistant', content: assembled, actions: ui }])
          } else {
            setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, actions: ui } : m))
          }
        },
      }, { voice: speak })
      if (!started) setMessages(prev => [...prev, { role: 'assistant', content: '(no response)' }])
      // Voice turn that proposed actions → the next spoken yes/no resolves them.
      if (speak && proposed) setConfirmMsgIdx(assistantIdx)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Agent failed')
      if (!started) { setMessages(prevState); if (!speak) setInput(content) } // nothing streamed — roll back
    } finally {
      setPending(false)
      if (speak) voice.endSpeech()
      taRef.current?.focus()
    }
  }

  function send(text: string) { return runTurn(text, false) }

  // Mic button: idle→record, listening→transcribe+send (spoken reply), speaking→stop playback.
  async function onMic() {
    if (voice.status === 'speaking') { voice.stopSpeaking(); return }
    if (voice.status === 'idle') { await voice.startListening(); return }
    if (voice.status === 'listening') {
      const text = await voice.stopListening()
      if (!text) return
      // If a voice proposal is awaiting confirmation, a spoken yes/no resolves it.
      if (confirmMsgIdx != null) {
        const verdict = classifyConfirm(text)
        if (verdict === 'yes') { await confirmYes(confirmMsgIdx); return }
        if (verdict === 'no') { confirmNo(confirmMsgIdx); return }
        setConfirmMsgIdx(null) // unclear → treat as a fresh question
      }
      await runTurn(text, true)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <div style={{ height: 'calc(100vh - 0px)', display: 'flex', flexDirection: 'column', maxWidth: 860, width: '100%', margin: '0 auto', padding: '20px 24px 16px' }}>
      <div style={{ flexShrink: 0, marginBottom: 14 }}>
        <div style={nwLabel}>Daily · Agent</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--navy-50)', margin: '5px 0 0', letterSpacing: '-.02em' }}>Chief of Staff</h1>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--navy-400)' }}>
          Knows your whole operation — spaces, KRs, tasks, calendar, reflections. It can also propose actions; nothing changes until you approve.
        </p>
        <BriefingsFeed ctx={ctx} onOpenNote={onOpenNote} toast={toast} />
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
                      {describeAction(a, ctx)}
                    </span>
                    {a.status === 'pending' && (
                      <>
                        <button onClick={() => approve(i, a)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff' }}>Approve</button>
                        <button onClick={() => setActionStatus(i, a.id, 'dismissed')} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--navy-300)' }}>Dismiss</button>
                      </>
                    )}
                    {a.status === 'approved' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--nw-nominal-text)' }}>done</span>}
                    {a.status === 'dismissed' && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--navy-400)' }}>dismissed</span>}
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

        {pending && messages[messages.length - 1]?.role !== 'assistant' && (
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
        {voice.supported && (() => {
          const st = voice.status
          const red = st === 'listening'
          const busy = st === 'thinking'
          const speaking = st === 'speaking'
          const color = red ? 'var(--nw-alarm-text, #ff6452)' : 'var(--accent)'
          const title = red ? 'Stop & send' : speaking ? 'Stop speaking' : busy ? 'Transcribing…' : 'Speak'
          return (
            <button
              onClick={onMic}
              disabled={busy || pending && st === 'idle'}
              title={title}
              aria-label={title}
              style={{
                flexShrink: 0, width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center',
                cursor: busy ? 'default' : 'pointer', color,
                background: red ? 'rgba(255,100,82,0.12)' : 'var(--navy-800)',
                border: `1px solid ${red ? color : 'var(--navy-600)'}`,
                animation: red ? 'voicepulse 1.3s ease-in-out infinite' : 'none',
                opacity: busy ? 0.6 : 1, transition: 'color .15s, border-color .15s, background .15s',
              }}
            >
              {busy ? (
                <span style={{ width: 15, height: 15, borderRadius: '50%', border: '2px solid var(--navy-500)', borderTopColor: color, animation: 'voicespin .7s linear infinite' }} />
              ) : speaking ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
              )}
            </button>
          )
        })()}
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

      <style>{`@keyframes agentdot { 0%,60%,100% { opacity:.3; transform:translateY(0) } 30% { opacity:1; transform:translateY(-3px) } }
@keyframes voicepulse { 0%,100% { box-shadow:0 0 0 0 rgba(255,100,82,0.5) } 50% { box-shadow:0 0 0 6px rgba(255,100,82,0) } }
@keyframes voicespin { to { transform:rotate(360deg) } }`}</style>
    </div>
  )
}
