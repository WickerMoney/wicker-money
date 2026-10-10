import { tokenClaims } from './tokenClaims.js'

/**
 * Reads whose token this is: the `sub` claim, which the server sets to the user id.
 *
 * The signature is not checked. The value only lets the client notice that a
 * refresh handed back a different user's token, so it can drop what it
 * remembered for the previous one.
 *
 * @param token - A compact JWT.
 * @returns The subject, or `null` when the token is not a JWT or has no string `sub`.
 */
export function tokenSubject(token: string): string | null {
  const sub = tokenClaims(token)?.['sub']
  return typeof sub === 'string' ? sub : null
}
