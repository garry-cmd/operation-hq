import { supabase } from '@/lib/supabase'
import type { ProposedAction } from '@/lib/agentTools'

/**
 * Client wrapper for /api/agent (the HQ chief-of-staff chat). Attaches the
 * Supabase session as a Bearer token; the route resolves the user, builds the
 * full HQ snapshot server-side, and returns Claude's reply. Stateless — pass
 * the running message history each call.
 */

export interface AgentMessage { role: 'user' | 'assistant'; content: string }

export type { ProposedAction }

/**
 * Streams the agent reply. Calls onText for each text chunk as it arrives and
 * onActions once the proposed tool calls are assembled. Resolves when the
 * stream ends; rejects on transport or mid-stream error.
 */
export async function streamAgentMessage(
  messages: AgentMessage[],
  today: string,
  weekStart: string,
  handlers: { onText: (delta: string) => void; onActions: (actions: ProposedAction[]) => void },
  opts?: { voice?: boolean },
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const r = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, today, weekStart, mode: opts?.voice ? 'voice' : 'text' }),
  })
  if (!r.ok || !r.body) {
    const msg = (await r.json().catch(() => ({} as { error?: string }))).error || `agent ${r.status}`
    throw new Error(msg)
  }

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const handleLine = (line: string) => {
    const s = line.trim()
    if (!s) return
    let evt: { t?: string; d?: string; a?: ProposedAction[]; e?: string }
    try { evt = JSON.parse(s) } catch { return }
    if (evt.t === 'text' && typeof evt.d === 'string') handlers.onText(evt.d)
    else if (evt.t === 'actions' && Array.isArray(evt.a)) handlers.onActions(evt.a)
    else if (evt.t === 'error') throw new Error(evt.e || 'stream error')
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
  if (buf) handleLine(buf)
}
