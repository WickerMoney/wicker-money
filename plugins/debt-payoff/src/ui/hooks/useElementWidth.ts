import { useLayoutEffect, useState } from 'react'

/**
 * The rendered width of an element, tracked as it resizes.
 *
 * Used to draw a chart at the width it is shown at rather than a fixed design
 * width scaled to fit: scaling a 1200-unit drawing into a 340px phone card also
 * scales its 10px axis labels to 3px.
 *
 * @param element - The element to measure; `null` before it is mounted.
 * @returns Its width in px, or `null` until it has been measured, and for good
 *   where `ResizeObserver` is not available (the chart then keeps its design width).
 */
export function useElementWidth(element: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = () => { setWidth(element.clientWidth > 0 ? element.clientWidth : null) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return width
}
