/**
 * Tauri bridge — calls Rust commands via window.__TAURI__.core.invoke.
 * Safe to import anywhere; degrades gracefully in a plain browser.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && typeof window.__TAURI__ !== 'undefined'

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.__TAURI__.core.invoke(cmd, args)
}

/** Open a native file picker. Returns the selected path, or null if cancelled. */
export async function pickFile(opts?: { title?: string }): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string | null>('pick_file')
  } catch (e) {
    console.error('pickFile failed', e)
    return null
  }
}

/** Open a native folder picker. Returns the selected path, or null if cancelled. */
export async function pickFolder(opts?: { title?: string }): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string | null>('pick_folder')
  } catch (e) {
    console.error('pickFolder failed', e)
    return null
  }
}

/**
 * Open a file or URL in its default app (Excel, Finder, browser, etc.).
 * Falls back to window.open in the browser.
 */
export async function shellOpen(pathOrUrl: string): Promise<void> {
  if (!isTauri()) {
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    await invoke('shell_open', { url: pathOrUrl })
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
    const unlisten = await window.__TAURI__.event.listen(
      event,
      (e: { payload: unknown }) => handler(e.payload)
    )
    return unlisten
  } catch (e) {
    console.error('onTauriEvent failed', e)
    return () => {}
  }
}
