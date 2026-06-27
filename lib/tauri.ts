/**
 * Tauri bridge — uses the __TAURI__ global injected by the Rust shell.
 * Safe to import in the web app; all functions degrade gracefully in a browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined'

/**
 * Open a native file picker. Returns the selected path, or null if cancelled.
 */
export async function pickFile(opts?: {
  title?: string
  filters?: { name: string; extensions: string[] }[]
}): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const result = await window.__TAURI__.dialog.open({
      title: opts?.title ?? 'Select file',
      multiple: false,
      directory: false,
      filters: opts?.filters,
    })
    if (!result) return null
    return typeof result === 'string' ? result : null
  } catch (e) {
    console.error('pickFile failed', e)
    return null
  }
}

/**
 * Open a native folder picker. Returns the selected path, or null if cancelled.
 */
export async function pickFolder(opts?: { title?: string }): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const result = await window.__TAURI__.dialog.open({
      title: opts?.title ?? 'Select folder',
      multiple: false,
      directory: true,
    })
    if (!result) return null
    return typeof result === 'string' ? result : null
  } catch (e) {
    console.error('pickFolder failed', e)
    return null
  }
}

/**
 * Open a file or URL in its default app.
 * Falls back to window.open in the browser.
 */
export async function shellOpen(pathOrUrl: string): Promise<void> {
  if (!isTauri()) {
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    await window.__TAURI__.shell.open(pathOrUrl)
  } catch (e) {
    console.error('shellOpen failed', e)
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Listen for events emitted from the Rust shell.
 * Returns an unlisten function. No-op in the browser.
 */
export async function onTauriEvent(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  if (!isTauri()) return () => {}
  try {
    const unlisten = await window.__TAURI__.event.listen(event, (e: { payload: unknown }) =>
      handler(e.payload)
    )
    return unlisten
  } catch (e) {
    console.error('onTauriEvent failed', e)
    return () => {}
  }
}
