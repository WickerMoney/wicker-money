import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * How far outside the viewport, in CSS pixels, a placeholder may be and still start its frame.
 *
 * A frame needs the frame document, the plugin's chunk and a first read before it draws, which took
 * from about 150 ms to over a second in the measurements (DEVELOPMENT.md, "Isolated plugin frames").
 * 600 px is a bit under one phone screen and two-thirds of a desktop one, so a frame has usually
 * drawn by the time a normal scroll brings it into view, while the cards further down stay
 * unstarted. A widget frame is at most 800 px tall.
 */
export const FRAME_ROOT_MARGIN_PX = 600

/**
 * How long a placeholder that is in view waits before it starts its frame, in milliseconds.
 *
 * Starting a frame cannot be undone, and the dashboard's layout is not final when it first renders: the
 * cards above are spinners until their chunks arrive, so everything below sits too high (on the seeded
 * dashboard the in-page cards reach full height about 600 ms in). A card is measured again after
 * this long and starts only if it is still in view or inside the margin.
 */
export const SETTLE_MS = 250

/**
 * Until this long after the page loaded, a card that is only inside the margin does not start, in milliseconds.
 *
 * The first seconds are when the layout still moves: frames above report small heights while they load
 * and the in-page cards fill in, so the cards below sit far too high (on the seeded dashboard everything
 * had its final height about 1.3 s in, on a loaded 2-CPU machine). A card inside the margin is off screen,
 * so holding it costs nothing a person can see; one in view is not held. Later (scrolling, or coming back
 * to the dashboard) the margin applies at once, after {@link SETTLE_MS}.
 */
export const LAYOUT_SETTLED_AT_MS = 2500

type Place = 'in-view' | 'near' | 'far' | 'unmeasured'

function place(el: Element, marginPx: number): Place {
  const rect = el.getBoundingClientRect()
  // A zero-sized box is not laid out yet (or is hidden): it says nothing about where it will be.
  if (rect.width === 0 && rect.height === 0) return 'unmeasured'
  if (rect.top < window.innerHeight && rect.bottom > 0) return 'in-view'
  return rect.top < window.innerHeight + marginPx && rect.bottom > -marginPx ? 'near' : 'far'
}

/**
 * True once `ref`'s element has been in view for {@link SETTLE_MS}, or inside the margin of `marginPx` and past
 * {@link LAYOUT_SETTLED_AT_MS}.
 * It never goes back to false: a frame that has started is kept (destroying one throws away its state
 * and pays the start again).
 *
 * Without `IntersectionObserver` it is true from the first render, so nothing is lazy where nothing can
 * say when to start.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  { enabled = true, marginPx = FRAME_ROOT_MARGIN_PX }: { enabled?: boolean; marginPx?: number } = {},
): boolean {
  const [near, setNear] = useState(() => !enabled || typeof IntersectionObserver === 'undefined')

  useLayoutEffect(() => {
    if (near) return undefined
    const el = ref.current
    if (el === null) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let waitingNear = false
    const consider = (): void => {
      const where = place(el, marginPx)
      if (where === 'far') return
      const inView = where === 'in-view'
      if (timer !== undefined) {
        // Scrolled into view while waiting out the long wait: switch to the short one.
        if (!(inView && waitingNear)) return
        clearTimeout(timer)
      }
      waitingNear = !inView
      timer = setTimeout(() => {
        timer = undefined
        // `unmeasured` here still means the observer said it was near, so go.
        if (place(el, marginPx) !== 'far') setNear(true)
      }, inView ? SETTLE_MS : Math.max(SETTLE_MS, LAYOUT_SETTLED_AT_MS - performance.now()))
    }
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) consider() },
      { rootMargin: `${marginPx}px 0px` },
    )
    observer.observe(el)
    consider()
    return () => { observer.disconnect(); if (timer !== undefined) clearTimeout(timer) }
  }, [near, ref, marginPx])

  return near
}
