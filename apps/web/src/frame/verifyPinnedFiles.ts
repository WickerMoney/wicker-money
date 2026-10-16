import type { FrameParams } from './fragment.js'

/**
 * Makes the browser check every pinned file against its Subresource Integrity
 * (SRI) value, before the federation runtime loads the plugin.
 *
 * Each listed file is fetched with a `<link rel="modulepreload">` that carries
 * the pin. The browser refuses a response whose bytes differ and keeps the
 * failure: the later `import()` of the same URL reuses the verified fetch
 * through the module map, or fails without fetching again. So a changed file
 * does not run, and no host-side re-download (which a server could answer
 * differently the second time) takes part.
 *
 * An entry on another origin must come with a pin: that is the second lock
 * behind the API's admission rule, for a frame opened with a hand-built URL.
 * An entry the host serves itself may omit it.
 *
 * Limits, kept in the SDK README: only the listed files are checked; style
 * sheets are not covered; the remote origin must answer with CORS headers
 * (`Access-Control-Allow-Origin`) or the browser fails the check.
 *
 * @param params - The validated frame parameters.
 * @param base - The frame document's URL, whose origin counts as the host's own.
 * @param doc - The document to add the links to. A test seam.
 * @returns Resolves once every pinned file has been fetched and matched.
 * @throws {Error} When a remote entry has no pin, the entry itself is not pinned, or any file fails its check.
 */
export async function verifyPinnedFiles(params: FrameParams, base: string, doc: Document = document): Promise<void> {
  const entry = new URL(params.entry)
  const pin = params.integrity
  const hasPin = pin !== undefined && Object.keys(pin).length > 0
  if (!hasPin) {
    if (entry.origin !== new URL(base).origin) {
      throw new Error(`Plugin '${params.pluginId}' is served from ${entry.origin} and has no integrity pin, so it was not loaded.`)
    }
    return
  }
  const entryName = entry.pathname.slice(entry.pathname.lastIndexOf('/') + 1)
  if (!Object.hasOwn(pin, entryName)) {
    throw new Error(`Plugin '${params.pluginId}' has an integrity pin that does not list its entry file '${entryName}', so it was not loaded.`)
  }
  const links: HTMLLinkElement[] = []
  try {
    await Promise.all(Object.entries(pin).map(([path, integrity]) => new Promise<void>((resolve, reject) => {
      const href = new URL(path, entry).href
      const link = doc.createElement('link')
      links.push(link)
      link.rel = 'modulepreload'
      link.crossOrigin = 'anonymous'
      link.setAttribute('integrity', integrity)
      link.addEventListener('load', () => resolve(), { once: true })
      link.addEventListener('error', () => reject(new Error(
        `Plugin '${params.pluginId}' was not loaded: '${path}' did not match its integrity pin, or could not be fetched (a remote origin must allow cross-origin requests).`,
      )), { once: true })
      link.href = href
      doc.head.appendChild(link)
    })))
  } finally {
    // The module map keeps the verified response; the elements are only the trigger.
    for (const link of links) link.remove()
  }
}
