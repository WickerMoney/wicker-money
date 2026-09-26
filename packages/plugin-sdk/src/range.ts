/** Keys of the time ranges the dashboard offers: `Nm` for the last N whole months, `ytd` for year to date. */
export const RANGE_KEYS = ['1m', '3m', '6m', '12m', '24m', 'ytd'] as const
/** One of the range keys in `RANGE_KEYS`. */
export type RangeKey = (typeof RANGE_KEYS)[number]

/**
 * The dashboard's time range, as every widget receives it.
 *
 * Passed down as a prop rather than published on a bus. A bus would need a
 * subscription, a teardown and an initial value, and it would make two widgets
 * able to observe each other — which is the coupling the plugin boundary exists
 * to prevent. A prop is the same information with none of that: the host owns
 * the control, React re-renders the widgets, and a widget that does not care
 * about time simply ignores it.
 *
 * Both shapes are provided deliberately. `months` is what the existing
 * aggregate endpoints already take, so nothing has to change to honour a range;
 * `from`/`to` are resolved calendar dates for anything that needs to be exact.
 * Offering only `months` would make "year to date" inexpressible, and offering
 * only dates would break every endpoint that counts in months.
 */
export interface DashboardRange {
  /** Which range this is. */
  readonly key: RangeKey
  /** What the control shows. Short enough for a compact segmented control. */
  readonly label: string
  /** Whole months covered, including the current one. */
  readonly months: number
  /** Inclusive first day, `YYYY-MM-DD`. */
  readonly from: string
  /** Exclusive last day, `YYYY-MM-DD`. Half-open, like every period in the app. */
  readonly to: string
}

/** The range the dashboard starts on: the last 12 months. */
export const DEFAULT_RANGE_KEY: RangeKey = '12m'

/**
 * Narrows a string to a `RangeKey`.
 *
 * @param value - Any string, typically read from a URL or stored setting.
 * @returns `true` when `value` is one of `RANGE_KEYS`.
 */
export function isRangeKey(value: string): value is RangeKey {
  return (RANGE_KEYS as readonly string[]).includes(value)
}

/** Short control label for each range key. */
const LABELS: Record<RangeKey, string> = {
  '1m': 'This month',
  '3m': '3 months',
  '6m': '6 months',
  '12m': '12 months',
  '24m': '24 months',
  ytd: 'Year to date',
}

/**
 * Looks up the control's label for a key without resolving dates.
 *
 * @param key - The range key.
 * @returns The short label shown on the range control, e.g. `Year to date`.
 */
export function rangeLabel(key: RangeKey): string {
  return LABELS[key]
}

/**
 * Resolves a key against a given day, which is the user's today in their zone.
 *
 * `today` is passed in rather than read from a clock so the same call always
 * gives the same answer — a range that silently depends on when it is evaluated
 * cannot be tested, and would put the host and a widget on different days
 * either side of midnight.
 *
 * Ranges end at the end of `today`'s month, not at today. A chart whose last
 * bar is a part-month that shrinks as you look at it invites the reader to
 * compare a half month against whole ones, which is the most common way a
 * spending trend lies.
 *
 * @param key - The range to resolve.
 * @param today - The current day as `YYYY-MM-DD`, in the user's time zone.
 * @returns The range with its label, month count and half-open `from`/`to` dates.
 */
export function resolveRange(key: RangeKey, today: string): DashboardRange {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))

  const months = key === 'ytd' ? month : Number(key.replace('m', ''))

  // Start at the first day of the month `months - 1` before this one.
  const startAbsolute = year * 12 + (month - 1) - (months - 1)
  const from = `${pad4(Math.floor(startAbsolute / 12))}-${pad2((startAbsolute % 12) + 1)}-01`

  // End exclusive: the first day of next month.
  const endAbsolute = year * 12 + month
  const to = `${pad4(Math.floor(endAbsolute / 12))}-${pad2((endAbsolute % 12) + 1)}-01`

  return { key, label: LABELS[key], months, from, to }
}

/**
 * Lists every month a range covers.
 *
 * @param range - A resolved range.
 * @returns The months from `range.from` up to but not including `range.to`,
 * oldest first, each as `YYYY-MM`.
 */
export function monthsInRange(range: DashboardRange): string[] {
  const out: string[] = []
  let absolute = Number(range.from.slice(0, 4)) * 12 + (Number(range.from.slice(5, 7)) - 1)
  const end = Number(range.to.slice(0, 4)) * 12 + (Number(range.to.slice(5, 7)) - 1)
  while (absolute < end) {
    out.push(`${pad4(Math.floor(absolute / 12))}-${pad2((absolute % 12) + 1)}`)
    absolute += 1
  }
  return out
}

/** Left-pads a number with zeros to two digits. */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
/** Left-pads a number with zeros to four digits. */
function pad4(n: number): string {
  return String(n).padStart(4, '0')
}
