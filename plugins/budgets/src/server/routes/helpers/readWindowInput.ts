import { isDate, isValidPlan } from '../../../shared/index.js'
import { BudgetError } from '../../service/BudgetError.js'
import type { WindowInput } from '../../service/WindowInput.js'
import { readRecord } from './readRecord.js'
import { requireUuid } from './requireUuid.js'
import { requireWindowId } from './requireWindowId.js'

/**
 * Validates the body of a create-or-update window request.
 *
 * Checks the shape of each field only. Whether the dates make a window (in
 * order, not exactly one month, not too long) is the service's rule, so it
 * holds however the service is called.
 *
 * @param body - The parsed JSON body.
 * @returns The validated input. An absent or null `id` means "create". A blank
 *   note becomes `null`, and a note longer than 300 characters is truncated.
 * @throws {BudgetError} `400` with code `bad_body`, `bad_id`, `bad_category`,
 *   `bad_planned`, `bad_date` or `bad_note` for the first invalid field.
 */
export function readWindowInput(body: unknown): WindowInput {
  const b = readRecord(body)
  const planned = b['planned']
  // Numbers are refused, not coerced, for the same reason as on a monthly line:
  // a float has already lost precision by the time it arrives.
  if (typeof planned !== 'string' || !isValidPlan(planned)) {
    throw new BudgetError('planned must be an amount as a string, and not negative.', 400, 'bad_planned')
  }
  const start = b['start']
  const through = b['through']
  if (typeof start !== 'string' || !isDate(start)) {
    throw new BudgetError('start must be a date as YYYY-MM-DD.', 400, 'bad_date')
  }
  if (typeof through !== 'string' || !isDate(through)) {
    throw new BudgetError('through must be a date as YYYY-MM-DD.', 400, 'bad_date')
  }
  const note = b['note']
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new BudgetError('note must be text.', 400, 'bad_note')
  }
  const id = b['id']

  return {
    id: id === undefined || id === null ? null : requireWindowId(id),
    categoryId: requireUuid(b['categoryId'], 'categoryId'),
    start,
    through,
    planned,
    note: typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 300) : null,
  }
}
