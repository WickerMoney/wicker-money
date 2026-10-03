import { useEffect, useRef, useState } from 'react'

/**
 * Tracks an element's rendered width, so a chart can draw in real pixels
 * instead of scaling a fixed drawing box (which shrinks its text to
 * unreadable on a phone).
 *
 * @param fallback - The width to use before the first measurement, or where
 *   `ResizeObserver` does not exist (tests, very old browsers).
 * @returns A ref to attach and the current width.
 */
export function useWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0)
      if (w > 0) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
