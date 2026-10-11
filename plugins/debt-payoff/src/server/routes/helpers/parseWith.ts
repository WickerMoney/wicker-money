import type { PluginRouteIssue } from '@wickermoney/plugin-sdk/server'
import type { z } from 'zod'
import { DebtPayoffError } from '../../service/DebtPayoffError.js'

/**
 * Validates a request value with a zod schema.
 *
 * @param schema - What the value must look like.
 * @param value - The unvalidated value.
 * @returns The parsed value, after the schema's transforms (amounts come back
 *   normalised to four decimal places).
 * @throws {DebtPayoffError} `400 validation_failed`, with one issue per
 *   problem on the field it belongs to, so the form can show each in place.
 */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  const issues: PluginRouteIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
    message: issue.message,
  }))
  const first = issues[0]
  const where = first === undefined || first.path.length === 0 ? '' : `${first.path.join('.')}: `
  throw new DebtPayoffError(`${where}${first?.message ?? 'The request is not valid.'}`, 400, 'validation_failed', issues)
}
