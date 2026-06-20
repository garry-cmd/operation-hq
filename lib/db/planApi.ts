import { supabase } from '@/lib/supabase'

/**
 * Client wrapper for /api/plan-week (the AI planner's judgment half). Attaches
 * the Supabase session as a Bearer token; the route resolves the user from it.
 * The deterministic placement (exact minutes) happens after this returns, in
 * calendarPlan.planFromAssignments.
 */

export interface PlanRequestPayload {
  weekStart: string
  days: { date: string; name: string }[]
  capacity: { date: string; day: string; start: string; end: string; kind: string; space: string }[]
  items: { key: string; title: string; space: string; kind: string; minutes: number; due: string | null; health: string | null }[]
  busy: { date: string; day: string; start: string; end: string; title: string }[]
}

export interface PlanAssignment {
  rationale: string
  plan: { key: string; day: string; reason?: string }[]
  skipped: { key: string; reason?: string }[]
}

export async function requestPlan(payload: PlanRequestPayload): Promise<PlanAssignment> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const r = await fetch('/api/plan-week', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  if (!r.ok) {
    const msg = (await r.json().catch(() => ({} as { error?: string }))).error || `plan ${r.status}`
    throw new Error(msg)
  }
  return r.json()
}
