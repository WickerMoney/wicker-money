import { tokenClaims } from './tokenClaims.js'

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
  const exp = tokenClaims(token)?.['exp']
  return typeof exp === 'number' ? exp * 1000 : null
}
