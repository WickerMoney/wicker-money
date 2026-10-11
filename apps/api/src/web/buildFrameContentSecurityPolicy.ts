/** What an origin allowed into the policy must look like: `https://host[:port]`, no path and nothing that could end a directive. */
const HTTPS_ORIGIN = /^https:\/\/[^\s;,'"/]+$/

/**
 * The origin of the request that fetched the frame document, as `scheme://host[:port]`.
 * Hostnames, IPv4 and bracketed IPv6; nothing that could end a directive.
 */
const REQUEST_ORIGIN = /^https?:\/\/(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/

/**
 * Content-Security-Policy for the document that hosts one sandboxed plugin frame.
 *
 * The policy is what makes the frame a sandbox even if the page that embeds it
 * forgets the `sandbox` attribute: `sandbox allow-scripts` gives the document an
 * opaque origin (no cookies, no storage, no access to the embedding page) and
 * nothing else, and everything not listed is denied (`default-src 'none'`). The
 * frame cannot fetch, open a socket, load an image or font, or nest a frame.
 * What it can run is script from this origin and the operator's plugin origins.
 * It is not a complete network seal: see "Verification log" in ADR 0005 for the
 * channels (`<link rel=prerender>`, WebRTC) that CSP does not govern in Chromium.
 *
 * `'self'` alone is not enough. In a sandboxed document without
 * `allow-same-origin`, WebKit does not match `'self'` against the document's own
 * URL, so a policy of `script-src 'self'` blocks the frame's own script there.
 * Naming the origin explicitly works in every engine tried, so both are listed.
 *
 * @param requestOrigin - The origin the document was fetched from, as the browser addressed it (`https://money.example.com`). When it is not a plain `http(s)` origin it is left out and only `'self'` remains: engines that match `'self'` still work, and the document never carries a value it could not vouch for.
 * @param pluginOrigins - `https` origins the operator allowed to serve plugin code, from `PLUGIN_REMOTE_ORIGINS`.
 * @returns The header value.
 * @throws {Error} If a plugin origin is not a plain `https` origin, since it is interpolated into a header.
 * @example
 * buildFrameContentSecurityPolicy('https://money.example.com', [])
 * // "sandbox allow-scripts; default-src 'none'; script-src 'self' https://money.example.com; ..."
 */
export function buildFrameContentSecurityPolicy(
  requestOrigin: string | undefined,
  pluginOrigins: readonly string[] = [],
): string {
  for (const origin of pluginOrigins) {
    if (!HTTPS_ORIGIN.test(origin)) {
      throw new Error(`'${origin}' cannot go in a Content-Security-Policy: expected an https origin such as https://plugins.example.com.`)
    }
  }
  const sources = ["'self'"]
  if (requestOrigin !== undefined && REQUEST_ORIGIN.test(requestOrigin)) sources.push(requestOrigin)
  sources.push(...pluginOrigins)
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src ${sources.join(' ')}`,
    "style-src 'unsafe-inline'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ')
}
