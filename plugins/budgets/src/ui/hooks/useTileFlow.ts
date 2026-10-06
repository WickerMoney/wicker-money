import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { tileFlow, type TileFlow } from '../helpers/tileFlow.js'

/** What {@link useTileFlow} hands back. */
export interface TileFlowLayout {
  /** Attach to the box the tiles may fill; it is sized by the card, not by the tiles. */
  readonly viewportRef: RefObject<HTMLDivElement | null>
  /** Attach to the grid of tiles, which is measured for the tile height. */
  readonly tilesRef: RefObject<HTMLDivElement | null>
  /** `null` until measured, and for good where `ResizeObserver` does not exist; the tiles then simply stack. */
  readonly flow: TileFlow | null
}

/**
 * Measures the box the budget tiles sit in and works out their columns.
 *
 * Until the first measurement, and wherever the browser cannot observe sizes,
 * the caller renders a plain stack: slightly less clever, never broken.
 *
 * @param count - Number of tiles.
 * @param gap - Gap between tiles, in px; must match the CSS.
 * @param minTileWidth - Narrowest tile, in px; must match the CSS.
 */
export function useTileFlow(count: number, gap: number, minTileWidth: number): TileFlowLayout {
  const viewportRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<HTMLDivElement>(null)
  const [flow, setFlow] = useState<TileFlow | null>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const tiles = tilesRef.current
    if (viewport === null || tiles === null || typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const tileHeight = Math.max(0, ...Array.from(tiles.children, (el) => (el as HTMLElement).offsetHeight))
      if (tileHeight === 0) return // not laid out (hidden tab, detached); keep what we have
      const next = tileFlow({
        count, gap, minTileWidth, tileHeight, height: viewport.clientHeight, width: viewport.clientWidth,
      })
      setFlow((prev) =>
        prev !== null && prev.columns === next.columns && prev.rows === next.rows && prev.minHeight === next.minHeight
          ? prev
          : next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [count, gap, minTileWidth])

  return { viewportRef, tilesRef, flow }
}
