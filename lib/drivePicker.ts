/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Google Picker glue. Under the drive.file scope the Picker is the ONLY way HQ
 * gains access to an existing Drive file — you can't fetch a file by id you
 * didn't pick. This loads apis.google.com/js/api.js once, then opens a Picker
 * and resolves the selected files. Vendor globals (gapi/google.picker) have no
 * types here, hence the file-level any-disable.
 */

let pickerReady = false
let loadingPromise: Promise<void> | null = null

function loadPickerApi(): Promise<void> {
  if (pickerReady) return Promise.resolve()
  if (loadingPromise) return loadingPromise
  loadingPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('no window')); return }
    const w = window as any
    const onApiReady = () => {
      w.gapi.load('picker', {
        callback: () => { pickerReady = true; resolve() },
        onerror: () => reject(new Error('picker module failed to load')),
      })
    }
    if (w.gapi) { onApiReady(); return }
    const existing = document.getElementById('google-api-js') as HTMLScriptElement | null
    if (existing) { existing.addEventListener('load', onApiReady, { once: true }); return }
    const s = document.createElement('script')
    s.id = 'google-api-js'
    s.src = 'https://apis.google.com/js/api.js'
    s.async = true
    s.defer = true
    s.onload = onApiReady
    s.onerror = () => reject(new Error('apis.google.com script failed'))
    document.body.appendChild(s)
  })
  return loadingPromise
}

export interface PickedFile { id: string; name: string; mimeType: string }

/** Opens the Google Picker and resolves the chosen files (empty array if the
 *  user cancels). Selecting a file grants HQ drive.file access to it. */
export async function openDrivePicker(opts: {
  accessToken: string
  apiKey: string
  appId?: string
}): Promise<PickedFile[]> {
  await loadPickerApi()
  const google = (window as any).google
  if (!google?.picker) throw new Error('picker unavailable')

  return new Promise<PickedFile[]>((resolve) => {
    const docsView = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMode(google.picker.DocsViewMode.LIST)

    const builder = new google.picker.PickerBuilder()
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(opts.accessToken)
      .setDeveloperKey(opts.apiKey)
      .addView(docsView)
      .setCallback((data: any) => {
        const action = data?.action
        if (action === google.picker.Action.PICKED) {
          const docs = (data.docs ?? []) as any[]
          resolve(docs.map((d) => ({ id: d.id as string, name: (d.name as string) ?? '', mimeType: (d.mimeType as string) ?? '' })))
        } else if (action === google.picker.Action.CANCEL) {
          resolve([])
        }
      })

    if (opts.appId) builder.setAppId(opts.appId)
    builder.build().setVisible(true)
  })
}
