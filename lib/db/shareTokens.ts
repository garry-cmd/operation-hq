/**
 * Data layer for the `share_tokens` table.
 *
 * Tiny module — share tokens are read-only from the app's perspective today
 * (no UI to create or revoke). Two read paths: looking up "the Melissa link"
 * by label on the topbar, and validating an inbound /share/[token] route.
 *
 * If a write path is ever added, expand here rather than reaching for raw
 * supabase calls.
 *
 * See lib/db/objectives.ts for module-level conventions.
 */
import { supabase } from '@/lib/supabase'
import type { ShareToken } from '@/lib/types'

/**
 * Find the single active share token for a given label (e.g. 'Melissa').
 * Returns null if no active token exists for that label — this is a normal
 * state for users who haven't set up a share link yet.
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
 * Look up an active share token by its token string. Used by the public
 * /share/[token] route to validate inbound requests. Returns null if the
 * token doesn't exist or isn't active.
 */
export async function findActiveByToken(token: string): Promise<ShareToken | null> {
  const { data, error } = await supabase
    .from('share_tokens')
    .select('token, space_id')
    .eq('token', token)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}
