import { moneyString } from './moneyString.js'

/**
 * An account's buffer: a money string that is zero or more. The database
 * holds the same rule (`ck_accounts_buffer_non_negative`); checking it here
 * turns a negative buffer into a 400 with a sentence rather than a failed
 * insert.
 */
export const bufferAmount = moneyString.refine((v) => !v.startsWith('-'), 'Buffer cannot be negative.')
