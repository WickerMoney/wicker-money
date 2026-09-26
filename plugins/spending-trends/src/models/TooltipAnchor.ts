/** Where the tooltip sits relative to the bar it describes. */
export interface TooltipAnchor {
  /** The tooltip's anchoring edge, as a percentage of the chart's width. */
  readonly leftPercent: number
  /** `right`: the tooltip starts at the anchor and extends right. `left`: it ends at the anchor and extends left. */
  readonly side: 'left' | 'right'
}
