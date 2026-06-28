/**
 * Tauri bridge — postMessage IPC to the local shell (tauri://localhost).
 *
 * Architecture:
 *   tauri://localhost  →  dist/index.html  (trusted Tauri origin, can invoke Rust)
 *       └── <iframe src="https://hq.svirene.com">  (this code runs here)
 *
 * The shell listens for postMessage from the iframe, calls Rust invoke(),
 * and posts the result back. We assign each call a unique id to match replies.
 *
 * Degrades gracefully in a plain browser — all functions return null/no-op.
 */

const SHELL_ORIGIN = 'tauri://localhost'
let _isTauri: boolean | null = null
let _pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
let _listenerAttached = false

function attachListener() {
  if (_listenerAttached) return
  _listenerAttached = true
  window.addEventListener('message', (event) => {
    if (event.origin !== SHELL_ORIGIN) return
    const { type, id, result, error } = event.data || {}
    if (type !== 'HQ_REPLY' || !id) return
    const pending = _pendingCalls.get(id)
    if (!pending) return
    _pendingCalls.delete(id)
    if (error) pending.reject(new Error(error))
    else pending.resolve(result)
  })
}

function call<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    attachListener()
    const id = Math.random().toString(36).slice(2)
    _pendingCalls.set(id, { resolve: resolve as (v: unknown) => void, reject })
    window.parent.postMessage({ type, id, payload: payload ?? {} }, SHELL_ORIGIN)
    // Timeout after 30s (picker can take a while)
    setTimeout(() => {
      if (_pendingCalls.has(id)) {
        _pendingCalls.delete(id)
        reject(new Error('HQ Tauri call timed out: ' + type))
      }
    }, 30000)
  })
}

/** Returns true if running inside the Tauri desktop shell. */
export async function checkIsTauri(): Promise<boolean> {
  if (_isTauri !== null) return _isTauri
  // We're in an iframe inside tauri://localhost if window.parent !== window
  // and the shell posted HQ_TAURI_READY, OR we can probe with a ping.
  if (window.parent === window) { _isTauri = false; return false }
  try {
    await call<boolean>('HQ_PING')
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
    return await call<string | null>('HQ_PICK_FILE')
  } catch (e) {
    console.error('pickFile failed', e)
    return null
  }
}

/** Open a native folder picker. Returns the selected path, or null if cancelled. */
export async function pickFolder(_opts?: { title?: string }): Promise<string | null> {
  if (!(await checkIsTauri())) return null
  try {
    return await call<string | null>('HQ_PICK_FOLDER')
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
    await call('HQ_SHELL_OPEN', { url: pathOrUrl })
  } catch (e) {
    console.error('shellOpen failed', e)
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Listen for Tauri events (global shortcuts etc.) via __TAURI__.event.
 * These are emitted on the shell (tauri://localhost), not the iframe.
 * The shell forwards them via postMessage with type 'HQ_EVENT_<name>'.
 */
export async function onTauriEvent(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  attachListener()
  const listener = (e: MessageEvent) => {
    if (e.origin !== SHELL_ORIGIN) return
    if (e.data?.type === 'HQ_EVENT' && e.data?.event === event) {
      handler(e.data.payload)
    }
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
