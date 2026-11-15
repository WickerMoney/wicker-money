/**
 * How long after its date an unsettled occurrence of a tracked item is still
 * expected. Inside this many days it is late and still projected (on the
 * first projected day); after it, it is missed and dropped from projections.
 * A week covers a weekend plus a bank holiday plus a slow payroll run.
 */
export const LATE_DAYS = 7

/**
 * How far back an unsettled occurrence of a tracked item is still listed as
 * missed, and how far either side of its date "Find payment" looks for the
 * transaction that paid it. A car payment that clears two weeks after its due
 * date is missed (not projected) but can still be matched. Automatic
 * suggestions keep their own, tighter rules.
 */
export const MISSED_DAYS = 30

/**
 * How far an occurrence may be moved from its nominal date, either way. A
 * month is enough for any weekend or holiday shift and keeps an occurrence
 * from passing the next one, and it bounds how far around a range the
 * service has to look for occurrences moved into it.
 */
export const MAX_MOVE_DAYS = 31
