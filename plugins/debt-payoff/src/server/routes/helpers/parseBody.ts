import type { z } from 'zod'
import { DebtPayoffError } from '../../service/DebtPayoffError.js'
import { parseWith } from './parseWith.js'

/**
 * Validates a JSON request body.
 *
 * @param schema - What the body must look like.
 * @param body - The parsed JSON body.
 * @returns The parsed body.
 * @throws {DebtPayoffError} `400 bad_body` when the body is not a JSON object,
 *   otherwise as {@link parseWith}.
 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new DebtPayoffError('Expected a JSON object.', 400, 'bad_body')
  }
  return parseWith(schema, body)
}
