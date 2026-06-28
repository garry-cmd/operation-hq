/**
 * Tauri bridge — postMessage IPC to the local shell (tauri://localhost).
 *
 * Architecture:
 *   tauri://localhost  →  dist/index.html  (trusted Tauri origin, can invoke Rust)
 *       └── <iframe src="https://hq.svirene.com">  (this code runs here)
 *
 * Detection: if window.parent !== window AND the shell responds to HQ_PING,
 * we're inside the desktop app. postMessage uses '*' as target (safe — the
 * shell validates event.origin === 'https://hq.svirene.com' on its side).
 */

let _isTauri: boolean | null = null
let _pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
let _listenerAttached = false

function attachListener() {
  if (_listenerAttached) return
  _listenerAttached = true
  window.addEventListener('message', (event) => {
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
    // Use '*' — shell validates origin on its side
    window.parent.postMessage({ type, id, payload: payload ?? {} }, '*')
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
  // Not in an iframe at all
  if (window.parent === window) { _isTauri = false; return false }
  // We're in an iframe — probe the parent
  try {
    const result = await Promise.race([
      call<boolean>('HQ_PING'),
      new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ])
    _isTauri = result === true
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
 * Listen for Tauri events forwarded from the shell via postMessage.
 */
export async function onTauriEvent(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  attachListener()
  const listener = (e: MessageEvent) => {
    if (e.data?.type === 'HQ_EVENT' && e.data?.event === event) {
      handler(e.data.payload)
    }
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
