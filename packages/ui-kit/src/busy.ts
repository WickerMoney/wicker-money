import type { SyntheticEvent } from 'react'

/** What is announced when someone activates a control that is busy. */
const BUSY_MESSAGE = 'Still working. Try again in a moment.'
/** The fallback region is emptied this long after it is filled, so it is not read twice in browse mode. */
const CLEAR_MS = 1500

type Announcer = (text: string) => void

let registered: Announcer | null = null
let fallback: HTMLElement | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Makes the toast provider's always-mounted live region the one busy messages go through.
 *
 * Internal to the package. Returns the function that withdraws it.
 */
export function registerAnnouncer(announcer: Announcer): () => void {
  registered = announcer
  return () => { if (registered === announcer) registered = null }
}

/**
 * Speaks a short message politely.
 *
 * The toast provider's region when one is mounted in this document (the host). Without one, as in a plugin
 * frame, a visually hidden `role="status"` element in `document.body`, created on first use.
 */
function announce(text: string): void {
  if (registered !== null) { registered(text); return }
  if (typeof document === 'undefined') return
  if (fallback === null || !fallback.isConnected) {
    const el = document.createElement('div')
    el.className = 'wm-visually-hidden'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.setAttribute('aria-atomic', 'true')
    document.body.append(el)
    fallback = el
  }
  const el = fallback
  // A fresh node each time, so the same text twice is announced twice.
  const span = document.createElement('span')
  span.textContent = text
  el.replaceChildren(span)
  clearTimeout(fallbackTimer)
  fallbackTimer = setTimeout(() => { el.replaceChildren() }, CLEAR_MS)
}

function ignoreWhileBusy(event: SyntheticEvent): void {
  // Same as a disabled control: no click reaches a parent, nothing submits, a checkbox does not flip.
  event.preventDefault()
  event.stopPropagation()
  announce(BUSY_MESSAGE)
}

/**
 * The handler for a control that stays focusable while a request runs.
 *
 * A `disabled` control loses keyboard focus, and a screen reader's cursor with it, the moment it is set, which
 * sends the person back to the top of the page after every save. A busy control is `aria-disabled="true"`
 * instead, keeps focus, and ignores the activation: this returns the handler to put on it. While `busy` is
 * `false` it returns `handler` unchanged. While `busy` is `true` it returns one that cancels the event (so a
 * submit button submits nothing and a checkbox does not toggle), keeps it from reaching a parent, and announces
 * "Still working. Try again in a moment." Pair it with `aria-disabled={busy || undefined}` on a plain element;
 * `Button`, `IconButton`, `Field` and `SelectField` do both when given `busy`.
 *
 * @param busy - Whether the control should ignore activation.
 * @param handler - What to run when it is not busy.
 */
export function guardBusy<E extends SyntheticEvent>(
  busy: boolean | undefined,
  handler?: (event: E) => void,
): ((event: E) => void) | undefined {
  return busy === true ? ignoreWhileBusy : handler
}
