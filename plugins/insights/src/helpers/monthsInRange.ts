import type { DashboardRange } from '@wickermoney/plugin-sdk'

/**
 * Lists every month a dashboard range covers, oldest first, as `YYYY-MM`.
 *
 * The same arithmetic as the SDK's `monthsInRange`, which only the SDK root
 * exports. The root also carries the Zod manifest schemas, and importing one
 * function from it put about 85 kB of them into the trend widget, which a
 * sandboxed frame then downloads and parses once per frame. A test keeps the
 * two in step.
 *
 * @param range - A resolved dashboard range; `to` is exclusive.
 * @returns The months from `range.from` up to but not including `range.to`.
 */
export function monthsInRange(range: DashboardRange): string[] {
  const out: string[] = []
  let absolute = Number(range.from.slice(0, 4)) * 12 + (Number(range.from.slice(5, 7)) - 1)
  const end = Number(range.to.slice(0, 4)) * 12 + (Number(range.to.slice(5, 7)) - 1)
  while (absolute < end) {
    out.push(`${String(Math.floor(absolute / 12)).padStart(4, '0')}-${String((absolute % 12) + 1).padStart(2, '0')}`)
    absolute += 1
  }
  return out
}
