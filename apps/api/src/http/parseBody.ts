import type { z } from 'zod'
import { ValidationError } from '../errors.js'

/**
 * Validates an untrusted value against a Zod schema.
 *
 * Use for request bodies, query strings and route params alike.
 *
 * @param schema - The schema the value must satisfy.
 * @param value - The raw request body, query string or params object.
 * @returns The parsed value, with the schema's defaults and transforms applied.
 * @throws {ValidationError} When validation fails. The message joins every
 * issue as `path: message`, separated by `; `.
 */
export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  return result.data
}
