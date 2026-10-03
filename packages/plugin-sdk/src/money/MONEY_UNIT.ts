/**
 * Integer units per whole currency unit (`10 ** MONEY_SCALE`).
 *
 * {@link moneyToUnits} returns amounts in these units, so `1n` is 0.0001 and
 * `MONEY_UNIT` is 1.0000.
 */
export const MONEY_UNIT = 10_000n
