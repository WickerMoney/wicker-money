/**
 * Chooses the merchant label for each leg of a transfer.
 *
 * A description given by the caller labels both legs. Otherwise the outgoing
 * leg reads "Transfer to X" and the incoming leg "Transfer from Y", using the
 * account names.
 *
 * @param description - Caller-supplied label, if any.
 * @param fromName - Name of the source account.
 * @param toName - Name of the destination account.
 * @returns The label for the outgoing and the incoming leg.
 */
export function transferLabels(
  description: string | undefined,
  fromName: string,
  toName: string,
): { readonly outgoing: string; readonly incoming: string } {
  const given = description?.trim() ?? ''
  return given === ''
    ? { outgoing: `Transfer to ${toName}`, incoming: `Transfer from ${fromName}` }
    : { outgoing: given, incoming: given }
}
