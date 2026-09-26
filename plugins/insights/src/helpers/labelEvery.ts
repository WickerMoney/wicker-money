/**
 * Chooses how often to label the month axis, so a long axis does not collide with itself.
 *
 * Chosen from the count rather than measured: the widget's width is fixed by its
 * slot, so the number of labels that fit depends only on how many months there are.
 *
 * @param count - The number of months on the axis.
 * @returns Label every nth month: 1, 2 or 3.
 */
export function labelEvery(count: number): number {
  if (count <= 8) return 1
  if (count <= 14) return 2
  return 3
}
