/**
 * Reads the expiry out of a JWT access token, for scheduling a refresh.
 *
 * The signature is not checked: the value only decides when to ask for a new
 * token early, and the server remains the authority on whether a token is valid.
 *
 * @param token - A compact JWT.
 * @returns The expiry as epoch milliseconds, or `null` when the token is not a
 * JWT or carries no numeric `exp` claim.
 */
export function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[1]
  if (payload === undefined) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const claims = JSON.parse(json) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}
