/**
 * Data layer for the `share_tokens` table and the share-flow RPCs.
 *
 * Two access paths to be aware of:
 *
 *  1. Authenticated app — findActiveByLabel('Melissa') to surface the link
 *     on the topbar. Goes through RLS (owner_all) as the signed-in owner.
 *
 *  2. Anon /share/[token] page — getShareData(token, quarter) calls a
 *     SECURITY DEFINER RPC that validates the token AND returns every
 *     row the share page needs in a single round trip.
 *
 *     This replaces the prior pattern of (a) validating via the
 *     find_active_share_token RPC then (b) doing direct anon SELECTs
 *     against annual_objectives / roadmap_items / spaces. After the
 *     RLS hardening pass (May 20), no public table has an anon SELECT
 *     policy — share page data MUST flow through get_share_data or
 *     nothing returns.
 *
 * If a write path is ever added, expand here rather than reaching for
 * raw supabase calls.
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { ShareToken, AnnualObjective, RoadmapItem, Space } from '@/lib/types'

/** Shape returned by the get_share_data RPC. */
export interface ShareData {
  token: { token: string; label: string | null; space_id: string | null }
  objectives: AnnualObjective[]
  items: RoadmapItem[]
  /** Populated only when token is all-spaces scoped (space_id IS NULL). */
  spaces: Space[]
}

/**
 * Find the single active share token for a given label (e.g. 'Melissa').
 * Called from the authenticated app to surface the share link in the UI.
 * Returns null if no active token exists for that label — this is a
 * normal state for users who haven't set up a share link yet.
 */
export async function findActiveByLabel(label: string): Promise<ShareToken | null> {
  const { data, error } = await supabase
    .from('share_tokens')
    .select('token, space_id')
    .eq('label', label)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

/**
 * Validate an inbound /share/[token] request and fetch all data the page
 * needs in a single RPC call. The underlying SECURITY DEFINER function
 * (get_share_data) checks the token is active, then returns objectives,
 * items, and (for all-spaces tokens) spaces scoped to whatever the token
 * grants access to. Returns null if the token doesn't exist or isn't
 * active.
 */
export async function getShareData(
  token: string,
  quarter: string,
): Promise<ShareData | null> {
  const { data, error } = await supabase.rpc('get_share_data', {
    p_token: token,
    p_quarter: quarter,
  })
  if (error) throw error
  return (data as ShareData | null) ?? null
}
