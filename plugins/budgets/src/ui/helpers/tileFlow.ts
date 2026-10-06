/** What {@link tileFlow} needs to know about the space and the tiles. */
export interface TileFlowInput {
  /** How many tiles there are. */
  readonly count: number
  /** Height of the area the tiles may use, in px. */
  readonly height: number
  /** Width of that area, in px. */
  readonly width: number
  /** Height of one tile (the tallest, if they differ), in px. */
  readonly tileHeight: number
  /** Gap between tiles, both directions, in px. */
  readonly gap: number
  /** The narrowest a tile may be, in px. Decides how many columns can exist. */
  readonly minTileWidth: number
  /** Rows the area always has room for, even when it is not stretched by a neighbour. Defaults to 3. */
  readonly baseRows?: number
}

/** How to lay the tiles out. */
export interface TileFlow {
  /** Number of columns. */
  readonly columns: number
  /** Tiles per column: a column fills to this, then the next one starts. */
  readonly rows: number
  /** The least height the area needs, in px, so nothing has to scroll. */
  readonly minHeight: number
}

/**
 * Lays tiles out as one column that spills into another when it runs out of
 * height.
 *
 * With room for N tiles top to bottom, tiles 1..N fill the first column, N+1..2N
 * the second, and so on. When the area is wide enough for another column it
 * takes one; when it is not, the area is made taller instead (`minHeight`)
 * rather than scrolling. So a narrow card or a phone shows a plain stack, and
 * a card stretched beside a tall neighbour fills its height before it widens.
 *
 * `minHeight` depends only on the count, the width and the tile height, never
 * on the measured height, so feeding the result back into the layout cannot
 * change the next measurement.
 *
 * @param input - The space and the tiles.
 * @returns Columns, tiles per column and the minimum height.
 */
export function tileFlow({
  count, height, width, tileHeight, gap, minTileWidth, baseRows = 3,
}: TileFlowInput): TileFlow {
  if (count <= 0 || tileHeight <= 0) return { columns: 1, rows: Math.max(count, 1), minHeight: 0 }

  const maxColumns = Math.max(1, Math.floor((width + gap) / (minTileWidth + gap)))
  const heightOf = (rows: number): number => rows * tileHeight + (rows - 1) * gap

  // Never less room than it takes to fit the tiles into the columns that exist.
  const minRows = Math.max(Math.min(baseRows, count), Math.ceil(count / maxColumns))
  const minHeight = heightOf(minRows)

  const fit = Math.max(1, Math.floor((Math.max(height, minHeight) + gap) / (tileHeight + gap)))
  const columns = Math.min(maxColumns, Math.ceil(count / fit))
  const rows = columns === Math.ceil(count / fit) ? Math.min(fit, count) : Math.ceil(count / columns)
  return { columns, rows, minHeight }
}
