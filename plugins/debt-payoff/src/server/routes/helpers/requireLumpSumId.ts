import { isUuid } from '@wickermoney/plugin-sdk/server'
import { DebtPayoffError } from '../../service/DebtPayoffError.js'

/**
 * Reads the lump sum id from the path.
 *
 * @param value - The `:id` path parameter.
 * @returns The id.
 * @throws {DebtPayoffError} `400 bad_id` when it is not a UUID, so a malformed
 *   id is refused before it reaches a `uuid` column.
 */
export function requireLumpSumId(value: string | undefined): string {
  if (!isUuid(value)) throw DebtPayoffError.field('id', 'That is not a lump sum id.', 'bad_id')
  return value
}
