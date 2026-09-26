/**
 * Name of the request header that identifies the plugin a request is made on
 * behalf of, when there is one.
 *
 * Advisory: it is set by the host's own client and honoured by the server, but
 * a caller can send any value or omit it.
 */
export const PLUGIN_HEADER = 'x-wickermoney-plugin'
