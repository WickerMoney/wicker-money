/**
 * An axis label from the host's money formatter, without a run of zero
 * cents: "$15,000" rather than "$15,000.00". Ticks are round numbers, so the
 * cents only add noise; anything that is not all zeros is left alone, and
 * a comma decimal separator ("15.000,00 €") is handled the same way.
 *
 * @param value - The tick value, a whole number.
 * @param formatMoney - The host's formatter.
 * @returns The label.
 */
export function axisMoney(value: number, formatMoney: (value: string) => string): string {
  return formatMoney(String(value)).replace(/[.,]00(?=\D*$)/, '')
}
