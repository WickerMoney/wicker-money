/** What an origin allowed into the policy must look like: `https://host[:port]`, no path and nothing that could end a directive. */
const HTTPS_ORIGIN = /^https:\/\/[^\s;,'"/]+$/

/**
 * Content-Security-Policy for the HTML document that hosts the web app.
 *
 * Scripts and connections are limited to this origin plus the plugin origins
 * the operator listed in `PLUGIN_REMOTE_ORIGINS`, so a plugin remote can only
 * come from somewhere the operator named. This is the policy recommended in the
 * code review (S6).
 *
 * Every origin listed is trusted completely: script from it runs in this app's
 * origin and can call the whole API as the signed-in user, and `connect-src`
 * lets it send data back. The policy limits where code may come from, not what
 * that code may do, so keep the list empty unless you trust each origin.
 *
 * It replaces Helmet's default for the document. That default carries
 * `upgrade-insecure-requests`, which makes a browser rewrite every sub-resource
 * request on an `http://` page to `https://` — so a self-hosted instance reached
 * over plain HTTP on a LAN would load a blank page.
 *
 * @param pluginOrigins - `https` origins allowed to serve plugin code.
 * @returns The header value.
 * @throws {Error} If an origin is not a plain `https` origin, since it is
 *   interpolated into a header and must not be able to add a directive.
 * @example
 * buildContentSecurityPolicy(['https://plugins.example.com'])
 * // "default-src 'self'; script-src 'self' https://plugins.example.com; ..."
 */
export function buildContentSecurityPolicy(pluginOrigins: readonly string[] = []): string {
  for (const origin of pluginOrigins) {
    if (!HTTPS_ORIGIN.test(origin)) {
      throw new Error(`'${origin}' cannot go in a Content-Security-Policy: expected an https origin such as https://plugins.example.com.`)
    }
  }
  const remotes = pluginOrigins.length === 0 ? '' : ` ${pluginOrigins.join(' ')}`
  return [
    "default-src 'self'",
    `script-src 'self'${remotes}`,
    `connect-src 'self'${remotes}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
