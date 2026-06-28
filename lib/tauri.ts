/**
 * Tauri bridge — communicates with the Rust shell via window.__TAURI__.core.invoke().
 * The Tauri shell injects window.__HQ_TAURI__ via an initialization_script that runs
 * before any page JS, so it's available on every navigation including hq.svirene.com.
 * Degrades gracefully in a plain browser (all functions return null/no-op).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bridge = (): any => (window as any).__HQ_TAURI__ ?? null

let _isTauri: boolean | null = null

/** Returns true if running inside the Tauri desktop shell. */
export async function checkIsTauri(): Promise<boolean> {
  if (_isTauri !== null) return _isTauri
  const b = bridge()
  if (!b) { _isTauri = false; return false }
  try {
    await b.ping()
    _isTauri = true
  } catch {
    _isTauri = false
  }
  return _isTauri
}

/** Synchronous version — only valid after checkIsTauri() has resolved. */
export function isTauri(): boolean {
  return _isTauri === true
}

/** Open a native file picker. Returns the selected path, or null if cancelled. */
export async function pickFile(_opts?: { title?: string }): Promise<string | null> {
  if (!(await checkIsTauri())) return null
  try {
    return await bridge().pickFile() ?? null
  } catch (e) {
    console.error('pickFile failed', e)
    return null
  }
}

/** Open a native folder picker. Returns the selected path, or null if cancelled. */
export async function pickFolder(_opts?: { title?: string }): Promise<string | null> {
  if (!(await checkIsTauri())) return null
  try {
    return await bridge().pickFolder() ?? null
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
  if (!(await checkIsTauri())) {
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    await bridge().shellOpen(pathOrUrl)
  } catch (e) {
    console.error('shellOpen failed', e)
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Listen for Tauri events (global shortcuts etc.) via __TAURI__.event.
 * Returns an unlisten function. No-op in the browser.
 */
export async function onTauriEvent(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (!w.__TAURI__?.event) return () => {}
  try {
    const unlisten = await w.__TAURI__.event.listen(
      event,
      (e: { payload: unknown }) => handler(e.payload)
    )
    return unlisten
  } catch (e) {
    console.error('onTauriEvent failed', e)
    return () => {}
  }
}
