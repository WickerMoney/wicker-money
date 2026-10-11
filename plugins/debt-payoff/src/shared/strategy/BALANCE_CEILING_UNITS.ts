/**
 * The balance, in units of 0.0001, at which the engine stops and reports the
 * plan as capped: 10^15, the first value that no longer fits `numeric(19,4)`.
 *
 * A debt whose minimum is below its interest grows every month. At a high rate
 * that outruns any sensible output within the month limit, and a schedule
 * whose balances are hundreds of digits long is not an answer anyone can use.
 */
export const BALANCE_CEILING_UNITS = 10n ** 19n
