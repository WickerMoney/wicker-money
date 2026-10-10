/**
 * @module
 * Exact money arithmetic on decimal strings.
 *
 * Money is `numeric(19,4)` in PostgreSQL and a `string` in TypeScript at every
 * boundary, never a `number`. In between, arithmetic happens in `bigint` units
 * of 0.0001, so `0.1 + 0.2` is `0.3000` and a 19-digit balance keeps every
 * digit.
 *
 * Two layers:
 * - String in, string out: {@link addMoney}, {@link sumMoney},
 *   {@link compareMoney} and friends. Enough for most plugins.
 * - `bigint` units, for loops that accumulate many values:
 *   {@link moneyToUnits}, {@link unitsToMoney} and {@link divideUnits}.
 *
 * Rules every function follows:
 * - Input is a plain decimal string with at most four decimal places;
 *   anything else throws `RangeError`. Nothing is silently truncated.
 * - Output is canonical: four decimal places, no `'-0.0000'`.
 * - The only rounding is in {@link divideUnits}: half away from zero, the
 *   same rule the API uses.
 *
 * Pure and dependency-free, so it is safe in the browser and in Node. For
 * showing an amount to a person, use the host's `ctx.formatMoney`.
 *
 * Stability: `@stable`. Plugins, the API and the web app all use it.
 *
 * @stable
 */
export type { Money } from './Money.js'
export { MONEY_SCALE } from './MONEY_SCALE.js'
export { MONEY_UNIT } from './MONEY_UNIT.js'
export { ZERO_MONEY } from './ZERO_MONEY.js'
export { moneyToUnits } from './moneyToUnits.js'
export { unitsToMoney } from './unitsToMoney.js'
export { divideUnits } from './divideUnits.js'
export { normalizeMoney } from './normalizeMoney.js'
export { addMoney } from './addMoney.js'
export { subtractMoney } from './subtractMoney.js'
export { sumMoney } from './sumMoney.js'
export { negateMoney } from './negateMoney.js'
export { absMoney } from './absMoney.js'
export { compareMoney } from './compareMoney.js'
export { equalMoney } from './equalMoney.js'
export { isNegativeMoney } from './isNegativeMoney.js'
export { isZeroMoney } from './isZeroMoney.js'
export { editableMoney } from './editableMoney.js'
