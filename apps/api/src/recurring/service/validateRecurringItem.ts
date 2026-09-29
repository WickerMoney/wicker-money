import { ValidationError } from '../../errors.js'
import { money, toMoney } from '../../money.js'
import type { LegAccount } from '../repository/LegAccount.js'
import type { RecurringItemWrite } from '../repository/RecurringItemWrite.js'
import type { RecurringItemInput } from './RecurringItemInput.js'

/** The most legs an item may have: a split paycheck into more accounts than this is not a real case. */
export const MAX_LEGS = 10

/** Account types a `debt_payment` may pay into. */
const LIABILITY_TYPES = new Set(['credit_card', 'loan'])

/**
 * Checks a submitted recurring item against every rule the database also
 * enforces, plus the ones it cannot, and returns the row to write.
 *
 * The database is the backstop (row CHECKs, composite keys, the deferred legs
 * trigger); this exists so a caller gets a sentence saying what is wrong
 * rather than a constraint name at commit. The rules:
 *
 * - `endDate`, when set, is on or after `seriesStartDate`.
 * - `semimonthly` has two different days, 1-31, the earlier no later than the
 *   27th (so they never clamp onto one February date); they default to the
 *   1st and 15th. Any other frequency must not send days.
 * - Legs are non-zero, one per account, on accounts that exist and are not
 *   archived, and have the shape the kind requires: income is one or more
 *   positive legs, a bill exactly one negative leg, a transfer or debt payment
 *   two legs netting to zero.
 * - A debt payment pays a credit card or loan. Only checked here: account type
 *   can change later, so the database cannot keep this true.
 * - A transfer or debt payment has no category (it is money moving, not
 *   spending or income), and a category, when set, exists.
 *
 * @param input - The submitted item.
 * @param accounts - The accounts the legs name that exist for this user.
 * @param categoryExists - Whether `input.categoryId` (when set) exists for this user.
 * @returns The item in the shape the repository writes.
 * @throws {ValidationError} Naming the first rule the item breaks.
 */
export function validateRecurringItem(
  input: RecurringItemInput,
  accounts: readonly LegAccount[],
  categoryExists: boolean,
): RecurringItemWrite {
  const endDate = input.endDate ?? null
  if (endDate !== null && endDate < input.seriesStartDate) {
    throw new ValidationError('endDate: Must be on or after seriesStartDate.')
  }

  const semimonthlyDays = checkSemimonthlyDays(input)
  const legs = checkLegs(input, accounts)

  const categoryId = input.categoryId ?? null
  if (categoryId !== null && (input.kind === 'transfer' || input.kind === 'debt_payment')) {
    throw new ValidationError(
      `categoryId: A ${input.kind === 'transfer' ? 'transfer' : 'debt payment'} has no category -- ` +
        'it is money moving between your accounts, not spending or income.',
    )
  }
  if (categoryId !== null && !categoryExists) throw new ValidationError('categoryId: Category not found.')

  return {
    name: input.name,
    kind: input.kind,
    frequency: input.frequency,
    seriesStartDate: input.seriesStartDate,
    endDate,
    semimonthlyDays,
    categoryId,
    legs,
  }
}

/** Validates and orders the semimonthly days; `null` for every other frequency. */
function checkSemimonthlyDays(input: RecurringItemInput): readonly [number, number] | null {
  const given = input.semimonthlyDays ?? null
  if (input.frequency !== 'semimonthly') {
    if (given !== null) throw new ValidationError('semimonthlyDays: Only a semimonthly item has semimonthly days.')
    return null
  }
  const [a, b] = given ?? [1, 15]
  for (const d of [a, b]) {
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      throw new ValidationError('semimonthlyDays: Each day must be a whole number from 1 to 31.')
    }
  }
  const earlier = Math.min(a, b)
  const later = Math.max(a, b)
  if (earlier === later) throw new ValidationError('semimonthlyDays: The two days must differ.')
  if (earlier > 27) {
    throw new ValidationError(
      `semimonthlyDays: ${earlier} and ${later} both land on the 28th in February; the earlier day must be 27 or less. ` +
        'Use 31 for "the last day of the month".',
    )
  }
  return [earlier, later]
}

/** Validates the legs against their accounts and the kind's shape; returns them with canonical amounts. */
function checkLegs(input: RecurringItemInput, accounts: readonly LegAccount[]): RecurringItemWrite['legs'] {
  const { legs, kind } = input
  if (legs.length === 0) throw new ValidationError('legs: At least one leg is required.')
  if (legs.length > MAX_LEGS) throw new ValidationError(`legs: At most ${MAX_LEGS} legs.`)

  const byId = new Map(accounts.map((a) => [a.id, a]))
  const seen = new Set<string>()
  for (const leg of legs) {
    if (seen.has(leg.accountId)) throw new ValidationError('legs: Each account may appear only once.')
    seen.add(leg.accountId)
    const account = byId.get(leg.accountId)
    if (account === undefined) throw new ValidationError('legs: Account not found.')
    if (account.archived) throw new ValidationError('legs: That account is archived; restore it or pick another.')
    if (money(leg.amount).isZero()) throw new ValidationError('legs: An amount of zero moves nothing.')
  }

  const positive = legs.filter((l) => money(l.amount).isPositive())
  const negative = legs.filter((l) => money(l.amount).isNegative())

  switch (kind) {
    case 'income':
      if (negative.length > 0) {
        throw new ValidationError('legs: Income only adds money; every leg must be positive.')
      }
      break
    case 'bill':
      if (legs.length !== 1 || negative.length !== 1) {
        throw new ValidationError('legs: A bill is one negative amount on the account that pays it.')
      }
      break
    case 'transfer':
    case 'debt_payment': {
      const net = legs.reduce((sum, l) => sum.plus(l.amount), money(0))
      if (legs.length !== 2 || positive.length !== 1 || negative.length !== 1 || !net.isZero()) {
        throw new ValidationError(
          `legs: A ${kind === 'transfer' ? 'transfer' : 'debt payment'} is two legs that cancel out: ` +
            'the amount leaving one account and the same amount arriving in another.',
        )
      }
      if (kind === 'debt_payment') {
        const destination = byId.get(positive[0]!.accountId)!
        if (!LIABILITY_TYPES.has(destination.account_type)) {
          throw new ValidationError(
            'legs: A debt payment pays a credit card or loan account. Use kind "transfer" to move money to any other account.',
          )
        }
      }
      break
    }
  }

  return legs.map((l) => ({ accountId: l.accountId, amount: toMoney(l.amount) }))
}
