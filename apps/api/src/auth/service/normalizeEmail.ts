/**
 * Trims and lower-cases an email so registration, login and reset agree on one spelling.
 *
 * @param email - Email address as entered.
 * @returns The normalised address.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
