/**
 * Decides whether two already-normalised merchant strings are the same merchant
 * as a human would skim them.
 *
 * Deliberately simple: it only decides whether to *ask*. One being a prefix of
 * the other covers "AMAZON MKTPL" vs "AMAZON MKTPL 4XJ22" without matching two
 * unrelated merchants.
 *
 * @param x - A string from `normalizeMerchant`.
 * @param y - A string from `normalizeMerchant`.
 * @returns `true` when they are equal, or the shorter (at least six characters)
 *   is a prefix of the longer.
 */
export function sameNormalizedMerchant(x: string, y: string): boolean {
  if (x === y) return true
  const shorter = x.length <= y.length ? x : y
  const longer = x.length <= y.length ? y : x
  return shorter.length >= 6 && longer.startsWith(shorter)
}
