/**
 * Zero in canonical form, as every function in this module returns it.
 *
 * Compare amounts with {@link isZeroMoney} or {@link equalMoney} rather than
 * against this string: `'0'`, `'0.00'` and `'-0.0000'` are all zero too.
 */
export const ZERO_MONEY = '0.0000'
