import type { z } from 'zod'
import { ValidationError } from '../errors.js'
import { humanZodMessage } from './humanZodMessage.js'

/**
 * Validates an untrusted value against a Zod schema.
 *
 * Use for request bodies, query strings and route params alike.
 *
 * @param schema - The schema the value must satisfy.
 * @param value - The raw request body, query string or params object.
 * @returns The parsed value, with the schema's defaults and transforms applied.
 * @throws {ValidationError} When validation fails. `issues` holds one
 * `{ path, message }` per problem, each message a sentence about its field
 * (see {@link humanZodMessage}). The top-level message joins every issue as
 * `path: message`, separated by `; `, as it always has.
 */
export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value, { error: humanZodMessage })
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
      message: i.message,
    }))
    const message = issues
      .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ')
    throw new ValidationError(message, issues)
  }
  return result.data
}
