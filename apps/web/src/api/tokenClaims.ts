/**
 * Decodes the claims of a JWT access token without checking its signature.
 *
 * The claims only steer client behaviour (when to refresh, whose cache to keep);
 * the server remains the authority on whether a token is valid.
 *
 * @param token - A compact JWT.
 * @returns The payload object, or `null` when the token is not a JWT.
 */
export function tokenClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (payload === undefined) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const claims: unknown = JSON.parse(json)
    return typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>) : null
  } catch {
    return null
  }
}
