import { getDriveAccessToken, trackDriveFile } from '@/lib/db/googleApi'
import { openDrivePicker } from '@/lib/drivePicker'
import * as filesDb from '@/lib/db/trackedFiles'
import type { TrackedFile } from '@/lib/types'

/**
 * Opens the Google Picker, tracks each selected Drive file, and optionally
 * files them to a space + KR in one gesture. Shared by the Files tab (track
 * into a scope) and the Home KR work view (track straight onto the KR).
 *
 * Throws on picker-open / track failure — callers toast. Returns the tracked
 * rows (already linked) for optimistic state merge. Empty array = user
 * cancelled the Picker.
 */
export async function trackViaPicker(opts: {
  apiKey: string
  spaceId?: string | null
  roadmapItemId?: string | null
}): Promise<TrackedFile[]> {
  const { accessToken, appId } = await getDriveAccessToken()
  const picked = await openDrivePicker({ accessToken, apiKey: opts.apiKey, appId })
  const out: TrackedFile[] = []
  for (const p of picked) {
    const { file } = await trackDriveFile(p.id, opts.spaceId ?? null)
    // Apply the KR link (and ensure the space) if the track route didn't already
    // land them — the track route only sets space_id, never roadmap_item_id.
    const needsLink = opts.roadmapItemId && file.roadmap_item_id !== opts.roadmapItemId
    const needsSpace = opts.spaceId != null && file.space_id !== opts.spaceId
    if (needsLink || needsSpace) {
      out.push(await filesDb.update(file.id, {
        ...(opts.roadmapItemId ? { roadmap_item_id: opts.roadmapItemId } : {}),
        ...(opts.spaceId != null ? { space_id: opts.spaceId } : {}),
      }))
    } else {
      out.push(file)
    }
  }
  return out
}
