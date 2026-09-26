/** Which end of a segment is rounded: the outer end of a stack, so the bar reads as one shape. */
export type SegmentRounding = 'top' | 'bottom' | 'none'

/** One category's slice of one month's bar, in SVG units. */
export interface StackSegment {
  /** The series it belongs to. */
  readonly id: string
  /** The exact amount, as a four-decimal string. */
  readonly value: string
  /** Top edge. */
  readonly y: number
  /** Height; at least 1 so a real amount never vanishes. */
  readonly h: number
  /** Which end is rounded. */
  readonly rounding: SegmentRounding
}
