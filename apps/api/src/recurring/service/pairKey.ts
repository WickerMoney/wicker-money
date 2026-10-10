/** Map key for one transaction against one occurrence. */
export const pairKey = (transactionId: string, itemId: string, nominalDate: string): string =>
  `${transactionId}|${itemId}|${nominalDate}`
