import { normalizeEmail } from '../../service/normalizeEmail.js'

/** Longest email address the body schema accepts; longer input is cut before use as a key. */
const MAX_EMAIL_LENGTH = 320

/**
 * Extracts the email from a request body as a rate-limit key.
 *
 * @param body - The parsed, not yet validated, request body.
 * @returns The normalised email, or an empty string when the body has none.
 */
export function emailKeyOf(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('email' in body)) return ''
  const email = body.email
  return typeof email === 'string' ? normalizeEmail(email.slice(0, MAX_EMAIL_LENGTH)) : ''
}
