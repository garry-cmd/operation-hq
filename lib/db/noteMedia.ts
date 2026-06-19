import { supabase } from '@/lib/supabase'

const BUCKET = 'note-media'
// Re-signed every time a note opens, so a generous TTL is fine. Loaded
// <img> bytes stay rendered past expiry; only fresh loads need a new URL.
const SIGNED_URL_TTL = 28800 // 8 hours

/**
 * Upload an image File for a note. Returns the storage **path** — the stable
 * source of truth we persist in the note body. We never store a URL, so the
 * bucket can flip public/private without rewriting any note content.
 */
export async function uploadNoteImage(noteId: string, file: File): Promise<{ path: string }> {
  const ext =
    (file.name.split('.').pop() || file.type.split('/').pop() || 'png')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${noteId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw error
  return { path }
}

/**
 * Upload an arbitrary file (PDF, doc, zip, …) for a note. Returns the storage
 * path plus the display metadata we persist on the attachment node so the chip
 * can render without a round-trip. The original filename is kept for display;
 * the storage key itself is uuid-based to avoid collisions and odd characters.
 */
export async function uploadNoteFile(
  noteId: string,
  file: File,
): Promise<{ path: string; name: string; size: number; mime: string }> {
  const ext =
    (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  const path = `${noteId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw error
  return { path, name: file.name || `file.${ext}`, size: file.size, mime: file.type || '' }
}

/**
 * Resolve a stored storage path to a short-lived signed URL for display.
 * The bucket is private and owner-locked; URLs are transient and never
 * written back into note bodies.
 */
export async function signNoteMedia(
  path: string,
  expiresIn = SIGNED_URL_TTL,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (error || !data) return null
  return data.signedUrl
}
