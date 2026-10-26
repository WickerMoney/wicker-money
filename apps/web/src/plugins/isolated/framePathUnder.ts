import { MAX_PATH_LENGTH } from '@wickermoney/plugin-sdk/isolated'

/**
 * The path a page frame is told it is at: the part of the address under the page's own route, with the query.
 *
 * `/p/acme.reports/report/2026/10?tab=2` under the route `/p/acme.reports/report` is `/2026/10?tab=2`; the
 * page's own address is `/`. The fragment is not sent (the host owns it). A value the protocol would refuse
 * (too long, control characters, a backslash, a protocol-relative start) is replaced by `/`, so a crafted address
 * cannot make the frame's `init` unreadable and the page fail to start.
 *
 * @param base - The page's route, for example `/p/acme.reports/report`.
 * @param pathname - The location's path.
 * @param search - The location's query string, with its leading `?`, or empty.
 * @returns A path starting with a single `/`.
 */
export function framePathUnder(base: string, pathname: string, search: string): string {
  const rest = pathname === base ? '' : pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : ''
  const path = `${rest === '' ? '/' : rest}${search}`
  // eslint-disable-next-line no-control-regex
  if (path.length > MAX_PATH_LENGTH || path.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(path)) return '/'
  return path
}
