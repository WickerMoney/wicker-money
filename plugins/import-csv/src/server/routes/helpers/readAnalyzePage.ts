import { DEFAULT_FLAGGED_LIMIT } from '../../service/DEFAULT_FLAGGED_LIMIT.js'
import type { AnalyzePage } from '../../service/AnalyzePage.js'
import { ImportError } from '../../service/ImportError.js'
import { MAX_FLAGGED_LIMIT } from '../../service/MAX_FLAGGED_LIMIT.js'

/**
 * Reads which flagged rows an analyze request asks for.
 *
 * Both fields are optional, so a request that predates paging gets the first
 * page. A limit above the maximum is lowered to it rather than refused: the
 * limit only protects the response size, and the caller still gets a page it
 * can continue from using `offset`.
 *
 * @param body - The parsed JSON body, unvalidated.
 * @returns The offset (default 0) and limit (default 500, at most 1000).
 * @throws {ImportError} `400` on `flaggedOffset` or `flaggedLimit` that is present but not a whole number
 *   (`flaggedOffset` from 0, `flaggedLimit` from 1).
 */
export function readAnalyzePage(body: unknown): AnalyzePage {
  const b = (body ?? {}) as { flaggedOffset?: unknown; flaggedLimit?: unknown }
  const whole = (value: unknown, field: string, min: number): number | undefined => {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      throw ImportError.field([field], `Must be a whole number, ${min} or more.`)
    }
    return value
  }
  const offset = whole(b.flaggedOffset, 'flaggedOffset', 0) ?? 0
  const limit = whole(b.flaggedLimit, 'flaggedLimit', 1) ?? DEFAULT_FLAGGED_LIMIT
  return { offset, limit: Math.min(limit, MAX_FLAGGED_LIMIT) }
}
