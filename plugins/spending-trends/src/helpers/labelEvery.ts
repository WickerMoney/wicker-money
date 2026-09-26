/**
 * Chooses how often to label the month axis, so a long axis does not collide with itself.
 *
 * Chosen from the count rather than measured: the widget's width is fixed by its
 * slot, so the number of labels that fit depends only on how many months there
 * are. Twelve fit one per bar at the chart's design width, which matters here
 * because every gap in a spending trend is worth reading.
 *
 * @param count - The number of months on the axis.
 * @returns Label every nth month: 1, 2 or 3.
 */
export function labelEvery(count: number): number {
  if (count <= 12) return 1
  if (count <= 24) return 2
  return 3
}
