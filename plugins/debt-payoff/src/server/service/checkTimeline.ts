import { DebtPayoffError } from './DebtPayoffError.js'

/** The promotion fields of a debt, which depend on each other. */
export interface PromoFields {
  readonly promoApr: string | null
  readonly promoEndsOn: string | null
  readonly promoDeferredInterest: boolean
}

/**
 * Checks that a debt's promotion fields agree with each other, after any
 * change has been merged into what was saved.
 *
 * A promotional rate and its end date come together or not at all, and
 * deferred interest only means something with a promotion. The database
 * checks the same rules; this says it on the field the person can fix.
 *
 * @param fields - The promotion fields as they would be saved.
 * @throws {DebtPayoffError} `400 bad_promotion` on the field that needs attention.
 */
export function checkTimeline(fields: PromoFields): void {
  if (fields.promoApr !== null && fields.promoEndsOn === null) {
    throw DebtPayoffError.field('promoEndsOn', 'Enter the day the promotional rate ends.', 'bad_promotion')
  }
  if (fields.promoApr === null && fields.promoEndsOn !== null) {
    throw DebtPayoffError.field('promoApr', 'Enter the promotional rate, or clear the end date.', 'bad_promotion')
  }
  if (fields.promoDeferredInterest && fields.promoApr === null) {
    throw DebtPayoffError.field(
      'promoDeferredInterest', 'Deferred interest needs a promotional rate and an end date.', 'bad_promotion',
    )
  }
}
