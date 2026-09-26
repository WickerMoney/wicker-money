import { localIsoDate } from '../../../lib/localIsoDate.js'

/**
 * Today's date in the user's local time zone.
 *
 * @returns An ISO date, `YYYY-MM-DD`.
 */
export const today = (): string => localIsoDate()
