import { supabase } from '@/lib/supabase'

export type Briefing = {
  id: string
  title: string
  body: string
  for_date: string
  source: string
  created_at: string
}

/** Client-side read of recent briefings (RLS owner_all, authenticated). */
export async function listRecentBriefs(limit = 10): Promise<Briefing[]> {
  const { data, error } = await supabase
    .from('briefings')
    .select('id, title, body, for_date, source, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as Briefing[]
}
