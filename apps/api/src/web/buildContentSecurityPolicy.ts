/**
 * Content-Security-Policy for the HTML document that hosts the web app.
 *
 * Scripts and connections are limited to this origin. That includes plugin
 * code: a plugin served from another origin (`PLUGIN_REMOTE_ORIGINS`) runs only
 * in a sandboxed frame, whose own policy
 * ({@link ./buildFrameContentSecurityPolicy.ts}) names those origins, so the app's
 * own page has no reason to and does not. A remote origin can therefore not
 * serve script into this page even by mistake, which is the browser-side half
 * of "a remote entry has no in-realm path" (the other half is `pluginRuntimeFor`).
 * This is the policy recommended in the code review (S6).
 *
 * It replaces Helmet's default for the document. That default carries
 * `upgrade-insecure-requests`, which makes a browser rewrite every sub-resource
 * request on an `http://` page to `https://` — so a self-hosted instance reached
 * over plain HTTP on a LAN would load a blank page.
 *
 * @returns The header value.
 * @example
 * buildContentSecurityPolicy()
 * // "default-src 'self'; script-src 'self'; connect-src 'self'; ..."
 */
export function buildContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
