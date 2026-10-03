/** Days between labels on a short chart. */
const WEEK = 7
/** Longest chart, in days, labelled weekly rather than monthly. */
const WEEKLY_UP_TO = 45
/** The opening day is labelled on a monthly chart unless a month start follows this closely. */
const MIN_GAP = 10
/** Narrowest room, in pixels, one label gets before every other label is dropped. */
const LABEL_ROOM = 52

/**
 * Which days get a label on the x axis: every seventh day for a short
 * horizon, the first of each month for a long one, so a 30-day chart is not
 * a single "Nov" and a year is not 52 crowded labels. A monthly chart also
 * labels its opening day, unless the first of a month follows too closely
 * for the two labels to fit.
 *
 * On a narrow chart, labels are thinned (every second, every third, ...)
 * until each has about {@link LABEL_ROOM} pixels.
 *
 * @param dates - The plotted days, ascending, `YYYY-MM-DD`.
 * @param plotWidth - The plot's width in pixels; unlimited by default.
 * @returns Ascending indexes into `dates` to label.
 */
export function axisDates(dates: readonly string[], plotWidth = Infinity): number[] {
  if (dates.length === 0) return []
  const picked = candidates(dates)
  const perDay = plotWidth / dates.length
  let keep = 1
  while (picked.length > 1 && meanGap(picked) * keep * perDay < LABEL_ROOM && keep < picked.length) keep += 1
  return picked.filter((_, k) => k % keep === 0)
}

/** Every label a chart of this length would show with unlimited room. */
function candidates(dates: readonly string[]): number[] {
  if (dates.length <= WEEKLY_UP_TO) {
    return dates.map((_, i) => i).filter((i) => i % WEEK === 0)
  }
  const firsts = dates.map((d, i) => (d.endsWith('-01') ? i : -1)).filter((i) => i >= 0)
  const next = firsts[0]
  if (next === 0) return firsts
  return next === undefined || next >= MIN_GAP ? [0, ...firsts] : firsts
}

/** Average distance in days between consecutive labels. */
function meanGap(picked: readonly number[]): number {
  return (picked[picked.length - 1]! - picked[0]!) / (picked.length - 1)
}
