/**
 * Name of the request header that identifies the plugin a request is made on
 * behalf of, when there is one.
 *
 * Advisory, not authentication: it is set by the host's own client and honoured
 * by the server, but a caller can send any value or omit it, and omitting it
 * makes the request count as the host application. UI plugins run in the host
 * origin and can do exactly that, so this header is not a security boundary.
 */
export const PLUGIN_HEADER = 'x-wickermoney-plugin'
