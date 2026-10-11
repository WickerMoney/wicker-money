/** An axis amount without a pointless ".00": `$2,500`. */
export function axisMoney(value: number, formatMoney: (value: string) => string): string {
  return formatMoney(String(value)).replace(/[.,]00(?=\D*$)/, '')
}
