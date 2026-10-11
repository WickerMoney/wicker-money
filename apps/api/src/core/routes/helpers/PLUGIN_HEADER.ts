/**
 * Name of the request header that names the plugin a request is made on
 * behalf of, when the caller chooses to say.
 *
 * Advisory, not authentication, and never the source of a request's identity.
 * A request is attributed to a plugin by the plugin token it carries (see
 * `auth/pluginTokens.ts`); this header is ignored on such a request. On a
 * request made with the host's own access token it can only narrow what the
 * request may do, by holding it to the named plugin's manifest, and a caller
 * can send any value or omit it. First-party plugin code that still runs in
 * the host page sends it so its own mistakes fail fast; it is not a security
 * boundary.
 */
export const PLUGIN_HEADER = 'x-wickermoney-plugin'
