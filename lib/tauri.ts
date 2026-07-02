/**
 * Tauri bridge — postMessage IPC to the local shell (tauri://localhost).
 *
 * The shell sends HQ_TAURI_READY on iframe load, which sets _isTauri=true
 * synchronously so no async ping is needed. Falls back to a ping probe.
 */

let _isTauri = false
let _pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
let _listenerAttached = false

function attachListener() {
  if (_listenerAttached || typeof window === 'undefined') return
  _listenerAttached = true
  window.addEventListener('message', (event) => {
    const data = event.data || {}
    // Shell announces itself
    if (data.type === 'HQ_TAURI_READY') {
      _isTauri = true
      return
    }
    // Reply to a pending call
    const { type, id, result, error } = data
    if (type !== 'HQ_REPLY' || !id) return
    const pending = _pendingCalls.get(id)
    if (!pending) return
    _pendingCalls.delete(id)
    if (error) pending.reject(new Error(error))
    else pending.resolve(result)
  })
}

// Attach listener immediately so we catch HQ_TAURI_READY even before
// any component calls checkIsTauri()
if (typeof window !== 'undefined') attachListener()

function call<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2)
    _pendingCalls.set(id, { resolve: resolve as (v: unknown) => void, reject })
    window.parent.postMessage({ type, id, payload: payload ?? {} }, '*')
    setTimeout(() => {
      if (_pendingCalls.has(id)) {
        _pendingCalls.delete(id)
        reject(new Error('HQ Tauri timeout: ' + type))
      }
    }, 30000)
  })
}

/** Returns true if running inside the Tauri desktop shell. */
export async function checkIsTauri(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (_isTauri) return true
  if (window.parent === window) return false
  // Give the READY message a moment to arrive if we're very early
  await new Promise(r => setTimeout(r, 200))
  return _isTauri
}

/** Synchronous version — valid after HQ_TAURI_READY has fired. */
export function isTauri(): boolean {
  return _isTauri
}

/** Open a native file picker. Returns the selected path, or null if cancelled. */
export async function pickFile(_opts?: { title?: string }): Promise<string | null> {
  if (!(await checkIsTauri())) return null
  try { return await call<string | null>('HQ_PICK_FILE') }
  catch (e) { console.error('pickFile failed', e); return null }
}

/** Open a native folder picker. Returns the selected path, or null if cancelled. */
export async function pickFolder(_opts?: { title?: string }): Promise<string | null> {
  if (!(await checkIsTauri())) return null
  try { return await call<string | null>('HQ_PICK_FOLDER') }
  catch (e) { console.error('pickFolder failed', e); return null }
}

/**
 * Open a file or URL in its default app.
 * Falls back to window.open in the browser.
 */
export async function shellOpen(pathOrUrl: string): Promise<void> {
  if (!(await checkIsTauri())) {
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
    return
  }
  try { await call('HQ_SHELL_OPEN', { url: pathOrUrl }) }
  catch (e) {
    console.error('shellOpen failed', e)
    window.open(pathOrUrl, '_blank', 'noopener,noreferrer')
  }
}

/**
 * Raise a native OS notification via the desktop shell.
 * Returns false when not in Tauri (caller can fall back to web push / in-app).
 */
export async function notifyNative(title: string, body: string): Promise<boolean> {
  if (!(await checkIsTauri())) return false
  try { await call('HQ_NOTIFY', { title, body }); return true }
  catch (e) { console.error('notifyNative failed', e); return false }
}

/**
 * Set the macOS dock badge count. null or 0 clears it. No-op in the browser.
 */
export async function setBadge(count: number | null): Promise<void> {
  if (!(await checkIsTauri())) return
  try { await call('HQ_SET_BADGE', { count }) }
  catch (e) { console.error('setBadge failed', e) }
}

/**
 * Listen for Tauri events forwarded from the shell.
 */
export async function onTauriEvent(
  event: string,
  handler: (payload: unknown) => void
): Promise<() => void> {
  const listener = (e: MessageEvent) => {
    if (e.data?.type === 'HQ_EVENT' && e.data?.event === event) {
      handler(e.data.payload)
    }
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
