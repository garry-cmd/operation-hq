import { supabase } from '@/lib/supabase'

/**
 * Client wrapper for /api/agent (the HQ chief-of-staff chat). Attaches the
 * Supabase session as a Bearer token; the route resolves the user, builds the
 * full HQ snapshot server-side, and returns Claude's reply. Stateless — pass
 * the running message history each call.
 */

export interface AgentMessage { role: 'user' | 'assistant'; content: string }

export interface ProposedAction { tool: string; input: Record<string, unknown> }

export interface AgentReply { reply: string; actions: ProposedAction[] }

export async function sendAgentMessage(
  messages: AgentMessage[],
  today: string,
  weekStart: string,
): Promise<AgentReply> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const r = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, today, weekStart }),
  })
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as { error?: string }))).error || `agent ${r.status}`
    throw new Error(msg)
  }
  const data = await r.json()
  return { reply: data.reply as string, actions: Array.isArray(data.actions) ? data.actions : [] }
}
