import { ImportError } from '../../service/ImportError.js'

/**
 * Checks that a value is a UUID string in the canonical 8-4-4-4-12 form.
 *
 * @param value - The unvalidated value.
 * @param field - Name used in the error message, such as `accountId`.
 * @returns The value, narrowed to `string`.
 * @throws {ImportError} `400` when the value is not a UUID.
 */
export function readUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw ImportError.field([field], field === 'accountId' ? 'Choose an account.' : 'Must be a valid id.')
  }
  return value
}
