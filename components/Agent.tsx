'use client'
/**
 * Agent — the HQ chief-of-staff chat. A full-state-aware conversational layer:
 * each message ships the running history to /api/agent, which rebuilds a fresh
 * HQ snapshot server-side and returns Claude's reply. Read-only for now (the
 * agent advises + triages; it doesn't mutate). History is in-session only.
 */
import { useState, useRef, useEffect } from 'react'
import { getMonday } from '@/lib/utils'
import { sendAgentMessage, type AgentMessage } from '@/lib/db/agentApi'

const STARTERS = [
  "What's slipping right now?",
  'What should I focus on today?',
  'Is my week realistic?',
  "What have I been dropping?",
]

const nwLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: '.16em', textTransform: 'uppercase',
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

export default function Agent({ toast }: { toast: (m: string) => void }) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const weekStart = getMonday()

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  async function send(text: string) {
    const content = text.trim()
    if (!content || pending) return
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setInput('')
    setPending(true)
    try {
      const reply = await sendAgentMessage(next, today, weekStart)
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Agent failed')
      setMessages(messages) // roll back the optimistic user message
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
          Knows your whole operation — spaces, KRs, tasks, calendar, reflections. Ask it anything. It advises; it doesn’t change anything.
        </p>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 4 }}>
        {messages.length === 0 && !pending && (
          <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, color: 'var(--navy-400)' }}>
            <p style={{ fontSize: 14, margin: 0, textAlign: 'center', maxWidth: 420, lineHeight: 1.5 }}>
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
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
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
