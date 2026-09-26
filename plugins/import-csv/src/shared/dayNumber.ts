/**
 * Converts an ISO date to a whole day count since the epoch.
 *
 * @param iso - An ISO `YYYY-MM-DD` date.
 * @returns The day number, or `NaN` when the text is not a date.
 */
export function dayNumber(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000
}
