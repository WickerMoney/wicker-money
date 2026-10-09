import { isUuid } from '@wickermoney/plugin-sdk/server'
import { ImportError } from '../../service/ImportError.js'

/**
 * Checks that a value is a UUID string, by the SDK's `isUuid` rule.
 *
 * @param value - The unvalidated value.
 * @param field - Name used in the error message, such as `accountId`.
 * @returns The value, narrowed to `string`.
 * @throws {ImportError} `400` when the value is not a UUID.
 */
export function readUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw ImportError.field([field], field === 'accountId' ? 'Choose an account.' : 'Must be a valid id.')
  }
  return value
}
