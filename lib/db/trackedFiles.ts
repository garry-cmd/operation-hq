import { supabase } from '@/lib/supabase'
import {
  TrackedFile, TrackedFileStatus,
  FileVersion, FileVersionDirection, NewFileVersionInput,
} from '@/lib/types'

/**
 * tracked_files / file_versions DB layer.
 *
 * A tracked file is a client working document whose source of truth lives in
 * Google Drive — HQ links by drive_file_id and never copies it in. file_versions
 * are frozen handoff snapshots (received ← / sent →) forming the version ladder.
 *
 * Inserts of tracked_files happen SERVER-SIDE (the /api/google/drive/track route
 * fetches Drive metadata first), so there's no client `create` here — use
 * googleApi.trackDriveFile. This module owns reads, patches, deletes, and the
 * version-row helpers. `fromRow` is exported so the route wrapper can map the
 * raw row it returns.
 */

export function fromRow(row: Record<string, unknown>): TrackedFile {
  return {
    id: row.id as string,
    space_id: (row.space_id as string | null) ?? null,
    drive_file_id: row.drive_file_id as string,
    name: (row.name as string) ?? '',
    mime_type: (row.mime_type as string | null) ?? null,
    drive_modified_time: (row.drive_modified_time as string | null) ?? null,
    status: (row.status as TrackedFileStatus) ?? 'new_in',
    roadmap_item_id: (row.roadmap_item_id as string | null) ?? null,
    note_id: (row.note_id as string | null) ?? null,
    task_id: (row.task_id as string | null) ?? null,
    archived: Boolean(row.archived),
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

function versionFromRow(row: Record<string, unknown>): FileVersion {
  return {
    id: row.id as string,
    tracked_file_id: row.tracked_file_id as string,
    direction: row.direction as FileVersionDirection,
    drive_file_id: (row.drive_file_id as string | null) ?? null,
    snapshot_name: (row.snapshot_name as string) ?? '',
    source: (row.source as string | null) ?? null,
    dest: (row.dest as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    created_at: row.created_at as string,
  }
}

// ── tracked_files ──
export async function listAll(): Promise<TrackedFile[]> {
  const { data, error } = await supabase
    .from('tracked_files')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(fromRow)
}

export async function update(
  id: string,
  patch: Partial<Omit<TrackedFile, 'id' | 'drive_file_id' | 'created_at' | 'updated_at'>>,
): Promise<TrackedFile> {
  const { data, error } = await supabase
    .from('tracked_files')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return fromRow(data)
}

export async function remove(id: string): Promise<void> {
  const { error } = await supabase.from('tracked_files').delete().eq('id', id)
  if (error) throw error
}

// ── file_versions (the handoff ladder) ──
export async function listAllVersions(): Promise<FileVersion[]> {
  const { data, error } = await supabase
    .from('file_versions')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(versionFromRow)
}

export async function listVersions(trackedFileId: string): Promise<FileVersion[]> {
  const { data, error } = await supabase
    .from('file_versions')
    .select('*')
    .eq('tracked_file_id', trackedFileId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(versionFromRow)
}

export async function addVersion(input: NewFileVersionInput): Promise<FileVersion> {
  const { data, error } = await supabase
    .from('file_versions')
    .insert({
      tracked_file_id: input.tracked_file_id,
      direction: input.direction,
      drive_file_id: input.drive_file_id ?? null,
      snapshot_name: input.snapshot_name ?? '',
      source: input.source ?? null,
      dest: input.dest ?? null,
      note: input.note ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return versionFromRow(data)
}

export async function removeVersion(id: string): Promise<void> {
  const { error } = await supabase.from('file_versions').delete().eq('id', id)
  if (error) throw error
}
