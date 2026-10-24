import { PLUGIN_FRAME_PATH } from './frameUrl.js'

const WHERE = 'See DEVELOPMENT.md, "Isolated plugin frames" (the Development bullet).'

/**
 * Names the likely cause when a plugin frame never finished its handshake, for
 * the browser console in development.
 *
 * In `pnpm dev` the frame document is not Vite's: the API serves it through the
 * dev server's proxy, and only when it was started with `WEB_DIST_DIR` pointing
 * at a built `apps/web/dist`. When that is missing the iframe loads a 404, a
 * proxy error or Vite's own HTML, and the only symptom on the page is "The
 * plugin did not start in time". This asks for the document the way the iframe
 * did and says which of those it is. It sends one `HEAD` request and reads
 * nothing from the page, so it cannot change what the frame may do.
 *
 * Development only: the caller must not run it in a production build.
 *
 * @param request - The `fetch` to use. Replaceable in tests.
 * @returns One line to log, never rejects.
 * @example
 * void diagnoseFrameTimeout().then((hint) => { console.warn(hint) })
 */
export async function diagnoseFrameTimeout(request: typeof fetch = (input, init) => fetch(input, init)): Promise<string> {
  const lead = 'A plugin frame did not start in time.'
  let response: Response
  try {
    response = await request(PLUGIN_FRAME_PATH, { method: 'HEAD', cache: 'no-store' })
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return `${lead} The dev server did not answer ${PLUGIN_FRAME_PATH} (${why}). ${WHERE}`
  }
  if (response.status === 404) {
    return `${lead} The API answered 404 for ${PLUGIN_FRAME_PATH}: it has no built frame. Build the web app ` +
      '(pnpm --filter @wickermoney/web build) and start the API with WEB_DIST_DIR=../web/dist. ' + WHERE
  }
  if (!response.ok) {
    return `${lead} ${PLUGIN_FRAME_PATH} answered ${String(response.status)}. The dev server proxies it to the API ` +
      `on :8080, so check that the API is running. ${WHERE}`
  }
  if (response.headers.get('content-security-policy') === null) {
    return `${lead} ${PLUGIN_FRAME_PATH} came back without the frame's Content-Security-Policy, so something other ` +
      'than the API is answering it (the Vite proxy for it is missing, or the API is not the one on :8080). ' +
      'Vite\'s own copy of the frame cannot load from a sandboxed origin (CORS). ' + WHERE
  }
  return `${lead} ${PLUGIN_FRAME_PATH} is served by the API with its policy, so look for a blocked request for ` +
    "the frame's own files or the plugin (a CORS or Content-Security-Policy error in this console, a plugin " +
    'file that is stale or missing under apps/web/dist/plugins). ' + WHERE
}
