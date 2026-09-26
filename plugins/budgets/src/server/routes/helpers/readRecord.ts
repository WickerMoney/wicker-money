import { BudgetError } from '../../service/BudgetError.js'

/**
 * Narrows a request body to an object whose fields can be looked up by name.
 *
 * @param body - The parsed JSON body.
 * @returns The body as a record; its values are still unvalidated.
 * @throws {BudgetError} `400 bad_body` when the body is not an object.
 */
export function readRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new BudgetError('Expected a JSON object.', 400, 'bad_body')
  }
  return body as Record<string, unknown>
}
