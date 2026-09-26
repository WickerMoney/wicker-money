/**
 * Request header that cookie-authenticated endpoints (refresh, logout) require
 * with the value `1`. A browser will not add a custom header to a cross-site
 * request without a CORS preflight, which this server never approves, so
 * requiring it stops other sites from riding the cookie.
 */
export const CSRF_HEADER = 'x-wickermoney-csrf'
