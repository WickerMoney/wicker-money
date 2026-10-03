/**
 * How long after its date an unsettled occurrence of a tracked item is still
 * expected. Inside this many days it is late and still projected (on the
 * first projected day); after it, it is missed and dropped from projections.
 * A week covers a weekend plus a bank holiday plus a slow payroll run.
 */
export const LATE_DAYS = 7

/**
 * How far an occurrence may be moved from its nominal date, either way. A
 * month is enough for any weekend or holiday shift and keeps an occurrence
 * from passing the next one, and it bounds how far around a range the
 * service has to look for occurrences moved into it.
 */
export const MAX_MOVE_DAYS = 31
