import { MAX_EXCLUDED_CATEGORIES, planProblem } from '../../../shared/index.js'
import { BudgetError } from '../../service/BudgetError.js'
import type { AccountLineInput } from '../../service/AccountLineInput.js'
import { readRecord } from './readRecord.js'
import { requireMonth } from './requireMonth.js'
import { requireUuid } from './requireUuid.js'

/**
 * Validates the body of a create-or-update account line request.
 *
 * Checks the shape of each field only. Whether the account is a checking
 * account of the caller's, and whether the excluded categories are theirs, is
 * the service's rule, since it needs the database.
 *
 * @param body - The parsed JSON body.
 * @returns The validated input. `rollover` defaults to `true` when absent,
 *   unlike a category line: an allowance you did not spend is the point of
 *   having one. A blank note becomes `null`, a note longer than 300 characters
 *   is truncated, and repeated excluded categories are collapsed.
 * @throws {BudgetError} `400` with code `bad_body`, `bad_month`, `bad_account`,
 *   `bad_planned`, `bad_rollover`, `bad_excluded` or `bad_note` for the first
 *   invalid field.
 */
export function readAccountLineInput(body: unknown): AccountLineInput {
  const b = readRecord(body)
  const planned = b['planned']
  // Refused rather than coerced, for the same reason as on a category line.
  if (typeof planned !== 'string') throw BudgetError.field('planned', 'Must be an amount, sent as text.', 'bad_planned')
  const problem = planProblem(planned)
  if (problem !== null) throw BudgetError.field('planned', problem, 'bad_planned')

  const rollover = b['rollover']
  if (rollover !== undefined && typeof rollover !== 'boolean') {
    throw BudgetError.field('rollover', 'Must be true or false.', 'bad_rollover')
  }

  const excluded = b['excludedCategoryIds'] ?? []
  if (!Array.isArray(excluded) || excluded.length > MAX_EXCLUDED_CATEGORIES) {
    throw BudgetError.field(
      'excludedCategoryIds',
      `Must be a list of at most ${MAX_EXCLUDED_CATEGORIES} categories.`,
      'bad_excluded',
    )
  }
  const excludedIds = excluded.map((id) =>
    requireUuid(id, 'excludedCategoryIds', 'Choose from your own categories.', 'bad_excluded'),
  )

  const note = b['note']
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw BudgetError.field('note', 'Must be text.', 'bad_note')
  }

  return {
    monthKey: requireMonth(b['month']),
    accountId: requireUuid(b['accountId'], 'accountId', 'Choose an account.', 'bad_account'),
    planned,
    rollover: rollover ?? true,
    excludedCategoryIds: [...new Set(excludedIds)],
    note: typeof note === 'string' && note.trim() !== '' ? note.trim().slice(0, 300) : null,
  }
}
