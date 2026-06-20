import { supabase } from '@/lib/supabase'
import { CalendarBlock, NewCalendarBlockInput, CalendarBlockStatus } from '@/lib/types'

/**
 * calendar_blocks DB layer — concrete placements of HQ items on the calendar.
 * Each row is a task XOR weekly_action scheduled to a date/time, 'proposed'
 * until committed (written to Google).
 */

function rowTo(row: Record<string, unknown>): CalendarBlock {
  return {
    id: row.id as string,
    task_id: (row.task_id as string | null) ?? null,
    weekly_action_id: (row.weekly_action_id as string | null) ?? null,
    space_id: (row.space_id as string | null) ?? null,
    capacity_block_id: (row.capacity_block_id as string | null) ?? null,
    title: row.title as string,
    block_date: row.block_date as string,
    start_minute: Number(row.start_minute),
    end_minute: Number(row.end_minute),
    google_event_id: (row.google_event_id as string | null) ?? null,
    google_calendar_id: (row.google_calendar_id as string | null) ?? null,
    status: (row.status as CalendarBlockStatus) ?? 'proposed',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export async function listAll(): Promise<CalendarBlock[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('*')
    .order('block_date', { ascending: true })
    .order('start_minute', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowTo)
}

/** Inclusive date range, both 'YYYY-MM-DD'. */
export async function listByDateRange(from: string, to: string): Promise<CalendarBlock[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('*')
    .gte('block_date', from)
    .lte('block_date', to)
    .order('block_date', { ascending: true })
    .order('start_minute', { ascending: true })
  if (error) throw error
  return (data ?? []).map(rowTo)
}

export async function create(input: NewCalendarBlockInput): Promise<CalendarBlock> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .insert({
      task_id: input.task_id ?? null,
      weekly_action_id: input.weekly_action_id ?? null,
      space_id: input.space_id ?? null,
      capacity_block_id: input.capacity_block_id ?? null,
      title: input.title,
      block_date: input.block_date,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      status: input.status ?? 'proposed',
    })
    .select()
    .single()
  if (error) throw error
  return rowTo(data)
}

/** Bulk insert — used by the planner to write a whole proposed week at once. */
export async function createMany(inputs: NewCalendarBlockInput[]): Promise<CalendarBlock[]> {
  if (inputs.length === 0) return []
  const { data, error } = await supabase
    .from('calendar_blocks')
    .insert(inputs.map(input => ({
      task_id: input.task_id ?? null,
      weekly_action_id: input.weekly_action_id ?? null,
      space_id: input.space_id ?? null,
      capacity_block_id: input.capacity_block_id ?? null,
      title: input.title,
      block_date: input.block_date,
      start_minute: input.start_minute,
      end_minute: input.end_minute,
      status: input.status ?? 'proposed',
    })))
    .select()
  if (error) throw error
  return (data ?? []).map(rowTo)
}

export async function update(
  id: string,
  patch: Partial<Omit<CalendarBlock, 'id' | 'created_at' | 'updated_at'>>,
): Promise<CalendarBlock> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return rowTo(data)
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_blocks').delete().eq('id', id)
  if (error) throw error
}

/** Delete all PROPOSED (uncommitted) blocks in a date range — re-planning a
 *  week wipes the prior proposal but never touches committed/Google-synced
 *  blocks. Returns the ids removed (for optimistic state pruning). */
export async function removeProposedInRange(from: string, to: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .delete()
    .eq('status', 'proposed')
    .gte('block_date', from)
    .lte('block_date', to)
    .select('id')
  if (error) throw error
  return (data ?? []).map((r: { id: string }) => r.id)
}
