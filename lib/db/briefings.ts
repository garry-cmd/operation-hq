import { supabase } from '@/lib/supabase'
import type { ProposedAction } from '@/lib/agentTools'

/** A proposal as stored on a brief: the action + a stable id + its status. */
export type BriefProposalStatus = 'pending' | 'approved' | 'dismissed'
export type BriefProposal = ProposedAction & { id: string; status: BriefProposalStatus }

export type Briefing = {
  id: string
  title: string
  body: string
  for_date: string
  source: string
  created_at: string
  note_id: string | null
  proposals: BriefProposal[] | null
}

/** Client-side read of recent briefings (RLS owner_all, authenticated). */
export async function listRecentBriefs(limit = 10): Promise<Briefing[]> {
  const { data, error } = await supabase
    .from('briefings')
    .select('id, title, body, for_date, source, created_at, note_id, proposals')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Briefing[]
}

/** Persist the proposals array for a brief (after an Approve/Dismiss). */
export async function saveProposals(briefId: string, proposals: BriefProposal[]): Promise<void> {
  const { error } = await supabase.from('briefings').update({ proposals }).eq('id', briefId)
  if (error) throw error
}
