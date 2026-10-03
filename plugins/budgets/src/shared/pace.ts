import { isNegativeMoney, isZeroMoney } from '@wickermoney/plugin-sdk/money'
import { ratio } from './ratio.js'
import { elapsedFraction } from './period.js'

/**
 * Which lines are actually in trouble.
 *
 * A progress bar answers "how much is left". It does not answer "is that bad",
 * and those are different questions: 80% of a grocery budget gone is unremarkable
 * on the 28th and alarming on the 10th. Everything here is about the second
 * question, because that is the only one worth a dashboard tile.
 *
 * Pace is the ratio of how much is spent to how much of the month has passed.
 * Above 1 means spending faster than the month is arriving. It is deliberately
 * naive — real spending is lumpy, rent lands on the 1st and makes housing look
 * catastrophic all month — rather than the model trying to be clever about
 * seasonality it has no data for.
 */

/**
 * A line's condition for the month: `over` (remaining is negative), `at-risk`
 * (spending faster than {@link AT_RISK_PACE}), `ahead` (well under pace),
 * `on-track`, or `unused` (nothing spent yet).
 */
export type Health = 'over' | 'at-risk' | 'ahead' | 'on-track' | 'unused'

/** A budget line's figures together with its derived pace and health. */
export interface LineStatus {
  /** Id of the category the line budgets. */
  readonly categoryId: string
  /** Display name of that category. */
  readonly categoryName: string
  /** Amount planned for the month, as a decimal string. */
  readonly planned: string
  /** `planned` plus any balance carried in, as a decimal string. */
  readonly available: string
  /** Amount spent in the month, as a decimal string. */
  readonly spent: string
  /** `available - spent`, as a decimal string; negative means overspent. */
  readonly remaining: string
  /** Whether the line's remaining balance carries into the next month. */
  readonly rollover: boolean
  /** `spent / available`, for the bar. Not money; never used in arithmetic. */
  readonly used: number
  /** `used / elapsed`. 1.0 is exactly on pace. Infinity-free: capped at 99. */
  readonly pace: number
  /**
   * Fraction of the line's period elapsed, from 0 to 1: the calendar month for
   * a monthly line, the whole window for a window. The bar's "today" mark sits
   * here, so the bar and the pace it illustrates are measured against the same
   * stretch of time.
   */
  readonly elapsed: number
  /** The line's condition for the month. */
  readonly health: Health
}

/** The already-computed money figures {@link statusFor} needs for one line. */
export interface StatusInput {
  /** Id of the category the line budgets. */
  readonly categoryId: string
  /** Display name of that category. */
  readonly categoryName: string
  /** Amount planned for the month, as a decimal string. */
  readonly planned: string
  /** `planned` plus any balance carried in, as a decimal string. */
  readonly available: string
  /** Amount spent in the month, as a decimal string. */
  readonly spent: string
  /** `available - spent`, as a decimal string; negative means overspent. */
  readonly remaining: string
  /** Whether the line's remaining balance carries into the next month. */
  readonly rollover: boolean
}

/** How far past pace a line must be before it is called at-risk. */
export const AT_RISK_PACE = 1.15

/**
 * Derives a line's usage ratio, pace and health for a given day.
 *
 * @param line - The line's money figures for the month.
 * @param monthKey - The `YYYY-MM` month the line belongs to.
 * @param today - The current date as `YYYY-MM-DD`, in the user's zone.
 * @returns The input plus `used`, `pace` (capped at 99), `elapsed` and `health`.
 * @throws {RangeError} If `monthKey` or any amount is malformed.
 */
export function statusFor(line: StatusInput, monthKey: string, today: string): LineStatus {
  return statusAt(line, elapsedFraction(monthKey, today))
}

/**
 * Derives a line's usage ratio, pace and health given how far through its
 * period it is.
 *
 * {@link statusFor} measures a calendar month. A window spanning several
 * months measures its own start and end instead (see `windowElapsed`), so
 * spending half a holiday budget in October is judged against October to
 * December rather than against October alone.
 *
 * `judgePace: false` keeps `pace` as a number but never lets it decide
 * `health`, so the line is only ever `over`, `unused` or `on-track`. Windows
 * use it: a window exists for spending that comes in lumps (the gifts are
 * bought the first weekend of October), and a dashboard calling that
 * "at risk" on day two is noise. Running out is still `over`.
 *
 * @param line - The line's money figures over the period being judged.
 * @param elapsed - Fraction of the period elapsed, from 0 to 1.
 * @param options - `judgePace` (default `true`): whether pace may make a line
 *   `at-risk` or `ahead`.
 * @returns The input plus `used`, `pace` (capped at 99), `elapsed` and `health`.
 * @throws {RangeError} If any amount is malformed.
 */
export function statusAt(
  line: StatusInput,
  elapsed: number,
  { judgePace = true }: { readonly judgePace?: boolean } = {},
): LineStatus {
  const used = ratio(line.spent, line.available)
  // A month that has not started has no pace. Reporting 0 rather than dividing
  // by zero keeps a future month's plan looking like a plan rather than a
  // triumph.
  const pace = elapsed === 0 ? 0 : Math.min(99, used / elapsed)

  // Treating the period as already over is exactly "judge the total, not the pace".
  return { ...line, used, pace, elapsed, health: healthOf(line, used, pace, judgePace ? elapsed : 1) }
}

/**
 * Classifies a line, checking conditions from most to least severe.
 *
 * @param line - The line's money figures.
 * @param used - Fraction of `available` spent.
 * @param pace - `used` divided by the elapsed fraction of the month.
 * @param elapsed - Fraction of the month elapsed, from 0 to 1.
 * @returns The line's {@link Health}.
 */
function healthOf(line: StatusInput, used: number, pace: number, elapsed: number): Health {
  if (isNegativeMoney(line.remaining)) return 'over'
  if (isZeroMoney(line.spent)) return 'unused'
  // Once the month is done, pace is meaningless — what matters is whether the
  // final number landed inside the plan, and by then it has.
  if (elapsed >= 1) return 'on-track'
  if (pace >= AT_RISK_PACE) return 'at-risk'
  if (used < elapsed * 0.75) return 'ahead'
  return 'on-track'
}

/**
 * The lines worth showing on a dashboard, worst first.
 *
 * Overspent before at-risk, then by how far past pace — so the tile leads with
 * the thing you can still do something about rather than the largest number.
 * Lines that are fine are not ranked at all: a widget listing everything is a
 * table, and the dashboard already has two of those.
 *
 * @param lines - Statuses for every line in a month.
 * @param limit - Maximum number of lines to return; defaults to 4.
 * @returns Up to `limit` lines whose health is `over` or `at-risk`, worst first.
 */
export function rankAtRisk(lines: readonly LineStatus[], limit = 4): LineStatus[] {
  const weight = (l: LineStatus): number => (l.health === 'over' ? 0 : l.health === 'at-risk' ? 1 : 2)
  return lines
    .filter((l) => l.health === 'over' || l.health === 'at-risk')
    .sort((a, b) => weight(a) - weight(b) || b.pace - a.pace)
    .slice(0, limit)
}

/**
 * Every line, in the order a half-width dashboard breakdown should show them.
 *
 * Where {@link rankAtRisk} answers "what needs acting on", this answers "how is
 * the month going": lines that need attention still lead (over, then at-risk,
 * each worst pace first), then the rest by how much of their budget is used, so
 * the next line likely to tip over sits right after the ones that already have.
 * Unused lines come last, since an untouched budget says nothing yet.
 *
 * @param lines - Statuses for every line in a month.
 * @param limit - Maximum number of lines to return; defaults to 6.
 * @returns Up to `limit` lines, attention first.
 */
export function rankBreakdown(lines: readonly LineStatus[], limit = 6): LineStatus[] {
  const weight = (l: LineStatus): number =>
    l.health === 'over' ? 0 : l.health === 'at-risk' ? 1 : l.health === 'unused' ? 3 : 2
  return [...lines]
    .sort((a, b) =>
      weight(a) - weight(b)
      || (weight(a) < 2 ? b.pace - a.pace : b.used - a.used)
      || a.categoryName.localeCompare(b.categoryName))
    .slice(0, limit)
}

/** Whole-month totals across every budget line. */
export interface MonthSummary {
  /** Total planned, as a decimal string. */
  readonly planned: string
  /** Total available (planned plus carried in), as a decimal string. */
  readonly available: string
  /** Total spent, as a decimal string. */
  readonly spent: string
  /** Total remaining, as a decimal string; negative means overspent overall. */
  readonly remaining: string
  /** Number of lines whose health is `over`. */
  readonly overCount: number
  /** Number of lines whose health is `at-risk`. */
  readonly atRiskCount: number
}
