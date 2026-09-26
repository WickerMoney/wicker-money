/**
 * Whether an unmatched request is a client-side route that should be answered
 * with the web app's `index.html`.
 *
 * True only for `GET`/`HEAD` requests outside `/api` whose last path segment has
 * no file extension. The extension rule is deliberate: a missing
 * `/assets/index-abc123.js` must be a 404, not an HTML page. Serving HTML there
 * turns a stale-deploy problem into "Unexpected token '<'" in the console, far
 * from the cause.
 *
 * @param method - HTTP method of the request.
 * @param url - Request URL including any query string.
 * @returns `true` if the app shell should be served.
 * @example
 * isSpaRoute('GET', '/transactions?page=2') // true
 * isSpaRoute('GET', '/assets/missing.js')   // false
 * isSpaRoute('GET', '/api/v1/nope')         // false
 */
export function isSpaRoute(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  const path = url.split('?')[0] ?? ''
  if (path === '/api' || path.startsWith('/api/')) return false
  const lastSegment = path.slice(path.lastIndexOf('/') + 1)
  return !lastSegment.includes('.')
}
