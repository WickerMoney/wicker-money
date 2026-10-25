import {
  useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type ReactNode,
} from 'react'
import {
  ToastApiContext, ToastViewContext,
  type ToastApi, type ToastItem, type ToastKind, type ToastView,
} from './useToast.js'

/** Props for {@link ToastProvider}. */
export interface ToastProviderProps {
  readonly children: ReactNode
  /**
   * When this value changes (pass the current route), every toast that is not
   * an `error` is cleared: a confirmation from the page the person left is stale.
   */
  readonly routeKey?: string
}

/** Three toasts on screen, two on a phone. Nothing is evicted: the rest wait. */
const LIMIT_DESKTOP = 3
const LIMIT_PHONE = 2
const PHONE_QUERY = '(max-width: 560px)'
/** The announcer is emptied this long after it is filled, so it is not read twice in browse mode. */
const ANNOUNCER_CLEAR_MS = 1500
/** A toast raised while a modal is open waits at most this long for the modal to close. */
const MODAL_HOLD_MS = 2000
const ADVISED_LENGTH = 200

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', onChange)
  return () => { query.removeEventListener('change', onChange) }
}
const phoneLimit = (): number => (
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
    ? LIMIT_PHONE : LIMIT_DESKTOP
)

function modalIsOpen(): boolean {
  if (document.querySelector('[aria-modal="true"]') !== null) return true
  try { return document.querySelector('dialog:modal') !== null } catch { return false }
}

const announcedText = (t: ToastItem): string => (
  t.kind === 'error' ? `Error: ${t.message}` : t.kind === 'warning' ? `Warning: ${t.message}` : t.message
)

/** Adds delivered toasts to the list: the same id replaces in place, an error goes ahead of the waiting queue. */
function merge(list: readonly ToastItem[], batch: readonly ToastItem[], limit: number): ToastItem[] {
  const next = [...list]
  for (const item of batch) {
    const at = next.findIndex((t) => t.id === item.id)
    if (at >= 0) { next[at] = { ...item, rev: next[at]!.rev + 1 }; continue }
    if (item.kind === 'error' && next.length >= limit) {
      let i = limit
      while (next[i]?.kind === 'error') i += 1
      next.splice(i, 0, item)
    } else next.push(item)
  }
  return next
}

/**
 * Owns the toast queue and the screen-reader announcer. Mount it once, above
 * the routes, and place a {@link ToastViewport} where the stack should draw.
 *
 * - The announcer is one always-mounted, visually hidden `role="status"`
 *   region, separate from the visible stack. Nothing here moves focus.
 * - Nothing dismisses itself. A toast stays until it is closed (its button,
 *   or Escape) or the same `key` replaces it.
 * - A burst of `show()` calls in one animation frame is announced once.
 * - While a modal is open (`dialog:modal` or `aria-modal="true"`) delivery is
 *   held, up to two seconds. Close the dialog first, then call `show()`.
 *
 * @experimental May change in any 0.x release; for the core app only until the plugin path ships.
 */
export function ToastProvider({ children, routeKey }: ToastProviderProps) {
  const [list, setList] = useState<readonly ToastItem[]>([])
  const limit = useSyncExternalStore(subscribePhone, phoneLimit, () => LIMIT_DESKTOP)
  const limitRef = useRef(limit)
  limitRef.current = limit

  const pending = useRef<ToastItem[]>([])
  const frame = useRef<number | null>(null)
  const heldSince = useRef<number | null>(null)
  const alive = useRef(false)
  const counter = useRef(0)
  const announcer = useRef<HTMLDivElement>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const announced = useRef(new Set<string>())
  const originRef = useRef<HTMLElement | null>(null)
  const groupRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef(list)
  listRef.current = list

  // A new route clears everything but errors. Adjusting state while rendering is
  // the documented way to react to a changed prop without an extra commit.
  const [lastRouteKey, setLastRouteKey] = useState(routeKey)
  if (routeKey !== lastRouteKey) {
    setLastRouteKey(routeKey)
    if (list.some((t) => t.kind !== 'error')) setList(list.filter((t) => t.kind === 'error'))
  }

  const announce = useCallback((text: string) => {
    const el = announcer.current
    if (el === null) return
    // A fresh node each time, so identical text twice is announced twice.
    const span = document.createElement('span')
    span.textContent = text
    el.replaceChildren(span)
    if (clearTimer.current !== null) clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => { clearTimer.current = null; el.replaceChildren() }, ANNOUNCER_CLEAR_MS)
  }, [])

  const tick = useCallback(() => {
    frame.current = null
    if (!alive.current || pending.current.length === 0) { heldSince.current = null; return }
    if (modalIsOpen()) {
      heldSince.current ??= Date.now()
      if (Date.now() - heldSince.current < MODAL_HOLD_MS) {
        frame.current = requestAnimationFrame(tick)
        return
      }
    }
    heldSince.current = null
    const batch = pending.current
    pending.current = []
    setList((prev) => merge(prev, batch, limitRef.current))
  }, [])

  const schedule = useCallback(() => {
    if (alive.current && frame.current === null) frame.current = requestAnimationFrame(tick)
  }, [tick])

  useEffect(() => {
    alive.current = true
    if (pending.current.length > 0) schedule()
    return () => {
      alive.current = false
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
      if (clearTimer.current !== null) { clearTimeout(clearTimer.current); clearTimer.current = null }
    }
  }, [schedule])

  // Announce what has just become visible: a new toast, a replaced one, or one
  // promoted from the queue. One update covers everything that appeared together.
  useEffect(() => {
    const fresh: ToastItem[] = []
    const keep = new Set<string>()
    list.forEach((t, i) => {
      const token = `${t.id}:${t.rev}`
      if (i >= limit) return
      keep.add(token)
      if (!announced.current.has(token)) fresh.push(t)
    })
    announced.current = keep
    if (fresh.length > 0) announce(fresh.map(announcedText).join('. '))
  }, [list, limit, announce])

  const removeIds = useCallback((ids: readonly string[]) => {
    // If focus is on a toast that is going away, give it back before it does.
    const active = document.activeElement
    const holder = active instanceof Element ? active.closest<HTMLElement>('[data-toast-id]') : null
    if (holder !== null && groupRef.current?.contains(holder) === true && ids.includes(holder.dataset['toastId'] ?? '')) {
      const origin = originRef.current
      const target = origin !== null && origin.isConnected && !groupRef.current.contains(origin)
        ? origin : document.querySelector<HTMLElement>('main')
      target?.focus({ preventScroll: true })
    }
    pending.current = pending.current.filter((t) => !ids.includes(t.id))
    setList((prev) => (prev.some((t) => ids.includes(t.id)) ? prev.filter((t) => !ids.includes(t.id)) : prev))
  }, [])

  const api = useMemo<ToastApi>(() => ({
    show(message, options) {
      const kind: ToastKind = options?.kind ?? 'info'
      const key = options?.key
      counter.current += 1
      const id = key !== undefined ? `key:${key}` : `toast:${counter.current}`
      if (message.length > ADVISED_LENGTH) {
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        if (env?.['NODE_ENV'] !== 'production') {
          console.warn(`useToast().show: a message of ${message.length} characters is long; keep toasts under ${ADVISED_LENGTH}.`)
        }
      }
      const item: ToastItem = { id, message, kind, rev: 0 }
      const at = pending.current.findIndex((t) => t.id === id)
      if (at >= 0) pending.current[at] = item
      else pending.current.push(item)
      schedule()
      return id
    },
    dismiss(id) { removeIds([id]) },
  }), [schedule, removeIds])

  const visible = useMemo(() => list.slice(0, limit).reverse(), [list, limit])
  const view = useMemo<ToastView>(
    () => ({ visible, dismissMany: removeIds, originRef, groupRef }),
    [visible, removeIds],
  )

  return (
    <ToastApiContext.Provider value={api}>
      <ToastViewContext.Provider value={view}>
        {children}
        <div ref={announcer} className="wm-visually-hidden" role="status" aria-live="polite" aria-atomic="true" />
      </ToastViewContext.Provider>
    </ToastApiContext.Provider>
  )
}

const GLYPH: Record<ToastKind, string> = { success: '✓', info: 'i', warning: '!', error: '✕' }
const WORD: Record<ToastKind, string> = { success: '', info: '', warning: 'Warning: ', error: 'Error: ' }

function ToastCard({ item, onDismiss }: { readonly item: ToastItem; readonly onDismiss: (id: string) => void }) {
  const textId = useId()
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    onDismiss(item.id)
  }
  return (
    <div className={`wm-toast wm-toast--${item.kind}`} data-toast-id={item.id} onKeyDown={onKeyDown}>
      <span className="wm-toast__icon" aria-hidden="true">{GLYPH[item.kind]}</span>
      <p className="wm-toast__text" id={textId}>
        {WORD[item.kind] === '' ? null : <span className="wm-visually-hidden">{WORD[item.kind]}</span>}
        {item.message}
      </p>
      <button type="button" className="wm-btn wm-toast__close" aria-label="Dismiss notification"
              aria-describedby={textId} onClick={() => { onDismiss(item.id) }}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

/**
 * Draws the toasts as an in-flow banner that sticks to the top of the page
 * while it scrolls. Place it as the first child of `<main>`.
 *
 * It sticks at `top: var(--wm-toast-offset-top, 0px)`; set that custom
 * property (on `<main>` or any ancestor) to the bottom edge of anything fixed
 * to the top of the viewport. It takes no props, is not a live region (the
 * provider's announcer speaks), holds no tab stop when empty, and renders
 * nothing outside a {@link ToastProvider}.
 *
 * @experimental May change in any 0.x release; for the core app only until the plugin path ships.
 */
export function ToastViewport() {
  const view = useContext(ToastViewContext)
  if (view === null || view.visible.length === 0) return null
  const { visible, dismissMany, originRef, groupRef } = view
  return (
    <div ref={groupRef} className="wm-toast-viewport" role="group" aria-label="Notifications"
         onFocus={(e) => {
           // Remember where focus came from, so closing a focused toast can return it.
           const from = e.relatedTarget
           if (from instanceof HTMLElement && !e.currentTarget.contains(from)) originRef.current = from
           else if (!(from instanceof HTMLElement)) originRef.current = null
         }}>
      {visible.map((t) => <ToastCard key={t.id} item={t} onDismiss={(id) => { dismissMany([id]) }} />)}
      {visible.length >= 2 ? (
        <div className="wm-toast-viewport__all">
          <button type="button" className="wm-btn" onClick={() => { dismissMany(visible.map((t) => t.id)) }}>
            Dismiss all
          </button>
        </div>
      ) : null}
    </div>
  )
}
