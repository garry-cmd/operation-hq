/**
 * Tauri bridge — communicates with the Rust shell via a custom URI scheme.
 * The Tauri shell registers hq://localhost/<command> as a URI scheme handler.
 * fetch() calls to that scheme are intercepted by Rust, which opens native
 * dialogs and returns JSON. Degrades gracefully in a plain browser.
 */

const BASE = 'hq://localhost'

let _isTauri: boolean | null = null

/** Returns true if running inside the Tauri desktop shell. */
export async function checkIsTauri(): Promise<boolean> {
  if (_isTauri !== null) return _isTauri
  try {
    const res = await fetch(`${BASE}/ping`)
    _isTauri = res.ok
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
    const res = await fetch(`${BASE}/pick-file`)
    const data = await res.json()
    return data.path ?? null
  } catch (e) {
    console.error('pickFile failed', e)
    return null
  }
}

/** Open a native folder picker. Returns the selected path, or null if cancelled. */
export async function pickFolder(_opts?: { title?: string }): Promise<string | null> {
  if (!(await checkIsTauri())) return null
  try {
    const res = await fetch(`${BASE}/pick-folder`)
    const data = await res.json()
    return data.path ?? null
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
    await fetch(`${BASE}/shell-open?url=${encodeURIComponent(pathOrUrl)}`)
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
