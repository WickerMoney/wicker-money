import { dayNumber } from './dayNumber.js'
import { earlierMatchInBucket } from './earlierMatchInBucket.js'
import type { ExistingTransaction } from './ExistingTransaction.js'
import { MATCH_WINDOW_DAYS } from './MATCH_WINDOW_DAYS.js'
import { normalizeMerchant } from './normalizeMerchant.js'
import { normalizeMoney } from './normalizeMoney.js'
import type { IndexedTransaction } from './IndexedTransaction.js'

/**
 * Lookup structure over the transactions already in an account.
 *
 * Heuristic duplicate detection needs "same amount, date within the window,
 * similar merchant". Scanning every existing transaction for every file row is
 * quadratic; keying on the normalised amount and the day makes each row look at
 * a handful of candidates. Among several matches the earliest in the input list
 * is returned, so the verdict is the same as a linear scan's.
 *
 * Dates are expected to be ISO `YYYY-MM-DD`; a transaction whose date does not
 * parse is never a heuristic match.
 */
export class ExistingIndex {
  private readonly byExternalId = new Map<string, ExistingTransaction>()
  private readonly byAmountAndDay = new Map<string, IndexedTransaction[]>()

  /**
   * @param existing - Transactions already in the account, in a stable order.
   */
  constructor(existing: readonly ExistingTransaction[]) {
    existing.forEach((transaction, order) => {
      if (transaction.externalId !== null && transaction.externalId !== '') {
        this.byExternalId.set(transaction.externalId, transaction)
      }
      const day = dayNumber(transaction.date)
      if (Number.isNaN(day)) return
      const key = `${normalizeMoney(transaction.amount)}|${day}`
      const bucket = this.byAmountAndDay.get(key)
      const entry = { transaction, order, merchant: normalizeMerchant(transaction.merchant) }
      if (bucket === undefined) this.byAmountAndDay.set(key, [entry])
      else bucket.push(entry)
    })
  }

  /**
   * Finds the transaction carrying a source id.
   *
   * @param externalId - The source's transaction id.
   * @returns The stored transaction (the last one, if several share the id), or `undefined`.
   */
  findByExternalId(externalId: string): ExistingTransaction | undefined {
    return this.byExternalId.get(externalId)
  }

  /**
   * Finds an existing transaction that looks like a file row.
   *
   * @param amount - The row's decimal amount.
   * @param date - The row's ISO date.
   * @param merchant - The row's merchant text.
   * @returns The earliest transaction with the same amount, a similar merchant
   *   and a date within `MATCH_WINDOW_DAYS`, or `undefined`.
   */
  findHeuristicMatch(amount: string, date: string, merchant: string): ExistingTransaction | undefined {
    const day = dayNumber(date)
    if (Number.isNaN(day)) return undefined
    const wanted = normalizeMerchant(merchant)
    const normalizedAmount = normalizeMoney(amount)

    let best: IndexedTransaction | undefined
    for (let offset = -MATCH_WINDOW_DAYS; offset <= MATCH_WINDOW_DAYS; offset += 1) {
      const bucket = this.byAmountAndDay.get(`${normalizedAmount}|${day + offset}`)
      if (bucket !== undefined) best = earlierMatchInBucket(bucket, wanted, best)
    }
    return best?.transaction
  }
}
