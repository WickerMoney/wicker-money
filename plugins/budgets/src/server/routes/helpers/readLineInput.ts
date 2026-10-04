import { planProblem } from '../../../shared/index.js'
import { BudgetError } from '../../service/BudgetError.js'
import type { LineInput } from '../../service/LineInput.js'
import { readRecord } from './readRecord.js'
import { requireMonth } from './requireMonth.js'
import { requireUuid } from './requireUuid.js'

/**
 * Validates the body of a create-or-update line request.
 *
 * @param body - The parsed JSON body.
 * @returns The validated input. A blank note becomes `null`, a note longer than
 *   300 characters is truncated, and `rollover` is true only for a literal `true`.
 * @throws {BudgetError} `400` with code `bad_body`, `bad_planned`, `bad_note`,
 *   `bad_month` or `bad_category` for the first invalid field.
 */
export function readLineInput(body: unknown): LineInput {
  const b = readRecord(body)
  const planned = b['planned']
  // Numbers are refused rather than coerced. A float that arrived as JSON has
  // already lost whatever precision it was going to lose, and accepting it here
  // would put that loss in the database where it is permanent.
  if (typeof planned !== 'string') throw BudgetError.field('planned', 'Must be an amount, sent as text.', 'bad_planned')
  const problem = planProblem(planned)
  if (problem !== null) throw BudgetError.field('planned', problem, 'bad_planned')
  const note = b['note']
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw BudgetError.field('note', 'Must be text.', 'bad_note')
  }

  return {
    monthKey: requireMonth(b['month']),
    categoryId: requireUuid(b['categoryId'], 'categoryId'),
    planned,
    rollover: b['rollover'] === true,
    note: typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 300) : null,
  }
}
