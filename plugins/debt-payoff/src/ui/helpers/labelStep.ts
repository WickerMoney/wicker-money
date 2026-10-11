/**
 * How many points apart to label the x axis so labels do not touch.
 *
 * @param points - Number of points on the axis.
 * @param plotWidth - Drawable width in px.
 * @param room - Px each label needs.
 */
export function labelStep(points: number, plotWidth: number, room = 64): number {
  if (points <= 1) return 1
  const perPoint = plotWidth / (points - 1)
  return Math.max(1, Math.ceil(room / perPoint))
}
