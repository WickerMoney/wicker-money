import type { HostChange, HostConnection } from '@wickermoney/plugin-sdk/isolated'

/** The slice of the host connection {@link ModalLift} uses. */
export type ModalLiftConnection = Pick<HostConnection, 'modal' | 'subscribe'>

/**
 * Set on `<html>` while a modal dialog is open in a page frame. `pending`: the host has been asked to lift the frame
 * and the dialog is held invisible until it has; `lifted`: the frame is lifted and the page is drawn where it was;
 * `inplace`: the host did not answer, so the dialog is shown against the frame, as it is in a host that predates
 * the lift. `frame.css` keys on it.
 */
export const MODAL_ATTRIBUTE = 'data-wm-modal'

/** Where the page sits in the lifted viewport, as CSS custom properties on `<html>` (read by `frame.css`). */
const VAR_X = '--wm-lift-x'
const VAR_Y = '--wm-lift-y'
const VAR_WIDTH = '--wm-lift-width'

/** Timings, in milliseconds. */
export interface ModalLiftTimings {
  /** How long to hold the dialog invisible for the host's answer before showing it against the frame. */
  readonly answerMs: number
  /** How long to wait for the viewport to change after a layout message before applying it anyway. */
  readonly settleMs: number
}
export const DEFAULT_MODAL_LIFT_TIMINGS: ModalLiftTimings = { answerMs: 400, settleMs: 250 }

/** Whether any dialog in the document is open as a modal (`showModal()`), not merely `open`. */
function anyModalDialog(doc: Document): boolean {
  for (const dialog of Array.from(doc.querySelectorAll('dialog[open]'))) {
    try {
      if (dialog.matches(':modal')) return true
    } catch { /* a browser without :modal has no page-lifting to do for it */ }
  }
  return false
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps Tab inside the open modal dialog.
 *
 * A native modal dialog traps focus in its own document, but the frame is one part of the host page: after the last
 * control the browser moves on to the host's chrome (or the browser's own), and Escape then goes to the host and never
 * reaches the dialog. The frame sees the key while focus is still on the last (or first) control, so it wraps there.
 * Returns true when it handled the key.
 */
export function wrapTab(doc: Document, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return false
  const dialogs = Array.from(doc.querySelectorAll('dialog[open]')).filter((d) => { try { return d.matches(':modal') } catch { return false } })
  const dialog = dialogs.at(-1)
  if (dialog === undefined) return false
  const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) { event.preventDefault(); return true }
  const active = doc.activeElement
  const inside = active !== null && dialog.contains(active)
  if (event.shiftKey && (!inside || active === first)) { event.preventDefault(); last.focus(); return true }
  if (!event.shiftKey && (!inside || active === last)) { event.preventDefault(); first.focus(); return true }
  return false
}

/** The slice of `HTMLDialogElement.prototype` {@link quietShowModal} wraps. */
export interface ShowModalHost { showModal?: (this: HTMLDialogElement) => void }

/**
 * Makes `showModal()` stop scrolling the host window.
 *
 * The browser's own step at the end of `showModal()` focuses a control in the dialog and scrolls it into view, and
 * "into view" reaches out of the frame: the dialog of a tall page frame sits at the top of the frame, so the host
 * window jumps to the top of the page before the frame has had a chance to ask for a lift (measured: from 522 px
 * down to 0 as the dialog opened). The dialog is `inert` while that step runs, so it finds nothing to focus, and
 * then gets the same focus, without the scroll.
 *
 * @param proto - `HTMLDialogElement.prototype`.
 * @returns A function that puts the original back.
 */
export function quietShowModal(proto: ShowModalHost): () => void {
  const original = proto.showModal
  if (typeof original !== 'function') return () => undefined
  const wrapped = function (this: HTMLDialogElement): void {
    const wasInert = this.inert
    this.inert = true
    try { original.call(this) } finally { this.inert = wasInert }
    // What the browser would have focused: the dialog's `autofocus` control, else the first focusable one, else the dialog.
    const target = this.querySelector<HTMLElement>('[autofocus]') ?? this.querySelector<HTMLElement>(FOCUSABLE) ?? this
    target.focus({ preventScroll: true })
  }
  proto.showModal = wrapped
  return () => { if (proto.showModal === wrapped) proto.showModal = original }
}

type Phase = 'idle' | 'pending' | 'lifted' | 'inplace' | 'closing'

/**
 * Asks the host to lift this page frame while a modal dialog is open in it, and draws the page where it was.
 *
 * The page frame is as tall as its content, so a native modal `<dialog>` is placed against the frame, not the
 * window. This runs in the frame, beside the plugin: it watches the document for a dialog opened with
 * `showModal()` (so a plugin needs no code of its own), says `modal` to the host, and, once the host has lifted the
 * frame over the visible content area and sent `modal-layout`, shifts the page so it stays where the person saw it.
 *
 * The order matters for what the person sees:
 *
 * 1. The dialog opens. A mutation observer runs before the next paint, so it hides the dialog (`opacity: 0`, and its
 *    backdrop) before it is ever drawn, and asks the host.
 * 2. The host sends the layout and lifts the frame. The frame's viewport changes. The page is shifted when that
 *    `resize` arrives, in the same rendering update, so no frame is drawn with the page in the wrong place. If the
 *    resize is late, a timer applies the layout anyway.
 * 3. The dialog is shown. It fills the new viewport: the window as the person sees it.
 * 4. When the last modal closes, the frame says so and keeps the page shifted until the viewport is back to what it
 *    was, so the page does not jump while the host puts the frame back.
 *
 * A host that does not answer within {@link ModalLiftTimings.answerMs} leaves the dialog where the browser put it.
 */
export class ModalLift {
  private phase: Phase = 'idle'
  private layout: { x: number; y: number; width: number } | null = null
  private baseline: { width: number; height: number } | null = null
  private answerTimer: ReturnType<typeof setTimeout> | undefined
  private settleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly connection: ModalLiftConnection,
    private readonly doc: Document = document,
    private readonly win: Window = window,
    private readonly timings: ModalLiftTimings = DEFAULT_MODAL_LIFT_TIMINGS,
    private readonly isModalOpen: () => boolean = () => anyModalDialog(doc),
  ) {}

  /** Starts watching. Returns a function that stops and puts everything back. */
  start(): () => void {
    const root = this.doc.documentElement
    const observer = new MutationObserver(() => { this.evaluate() })
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    const unsubscribe = this.connection.subscribe((change) => { this.onHost(change) })
    const onResize = (): void => { this.reconcile() }
    this.win.addEventListener('resize', onResize)
    const onKeydown = (event: KeyboardEvent): void => { if (this.isModalOpen()) wrapTab(this.doc, event) }
    this.doc.addEventListener('keydown', onKeydown)
    const unquiet = quietShowModal((this.win as Window & { HTMLDialogElement?: { prototype: ShowModalHost } }).HTMLDialogElement?.prototype ?? {})
    this.evaluate()
    return () => {
      unquiet()
      this.doc.removeEventListener('keydown', onKeydown)
      observer.disconnect()
      unsubscribe()
      this.win.removeEventListener('resize', onResize)
      this.clearTimers()
      if (this.phase !== 'idle') this.connection.modal(false)
      this.finish()
    }
  }

  private evaluate(): void {
    const open = this.isModalOpen()
    if (open && (this.phase === 'idle' || this.phase === 'closing')) this.opened()
    else if (!open && (this.phase === 'pending' || this.phase === 'lifted' || this.phase === 'inplace')) this.closed()
  }

  private opened(): void {
    this.clearTimers()
    // While closing, the viewport is still the lifted one; the baseline is the one from before the lift.
    if (this.phase === 'idle') this.baseline = { width: this.win.innerWidth, height: this.win.innerHeight }
    this.phase = this.layout !== null && this.differs() ? 'lifted' : 'pending'
    this.doc.documentElement.setAttribute(MODAL_ATTRIBUTE, this.phase)
    this.connection.modal(true)
    if (this.phase === 'pending') {
      // A host that does not answer leaves the dialog where it is, as before the lift existed.
      this.answerTimer = setTimeout(() => {
        if (this.phase === 'pending') { this.phase = 'inplace'; this.doc.documentElement.setAttribute(MODAL_ATTRIBUTE, 'inplace') }
      }, this.timings.answerMs)
    }
  }

  private closed(): void {
    this.clearTimers()
    this.connection.modal(false)
    if (this.layout === null || !this.differs()) { this.finish(); return }
    // Keep the page where it is drawn until the host has put the frame back (the viewport is the baseline again).
    this.phase = 'closing'
    this.settleTimer = setTimeout(() => { this.finish() }, this.timings.settleMs * 4)
  }

  private onHost(change: HostChange): void {
    if (change.type !== 'modal-layout') return
    if (change.lifted) {
      // A layout for a dialog that has already closed (the host answers in order, so this is the late half of an
      // open and close in quick succession) is not for anything on screen.
      if (this.phase === 'idle' || this.phase === 'closing') return
      this.layout = { x: change.x, y: change.y, width: change.width }
      const root = this.doc.documentElement.style
      root.setProperty(VAR_X, `${change.x}px`)
      root.setProperty(VAR_Y, `${change.y}px`)
      root.setProperty(VAR_WIDTH, `${change.width}px`)
      if (this.phase === 'pending' || this.phase === 'inplace') {
        // Normally the viewport changes with, or just after, this message. Apply when it has, or after a moment.
        if (this.differs()) this.applyLift()
        else this.settleTimer = setTimeout(() => { if (this.phase === 'pending' || this.phase === 'inplace') this.applyLift() }, this.timings.settleMs)
      }
    } else {
      this.layout = null
      if (this.phase === 'closing') this.reconcile()
    }
  }

  /** A viewport change: apply a waiting layout, or finish a close the host has completed. */
  private reconcile(): void {
    if ((this.phase === 'pending' || this.phase === 'inplace') && this.layout !== null && this.differs()) this.applyLift()
    else if (this.phase === 'closing' && !this.differs()) this.finish()
  }

  private applyLift(): void {
    this.clearTimers()
    this.phase = 'lifted'
    this.doc.documentElement.setAttribute(MODAL_ATTRIBUTE, 'lifted')
  }

  private differs(): boolean {
    const b = this.baseline
    if (b === null) return false
    return Math.abs(this.win.innerWidth - b.width) > 1 || Math.abs(this.win.innerHeight - b.height) > 1
  }

  private finish(): void {
    this.clearTimers()
    this.phase = 'idle'
    this.layout = null
    this.baseline = null
    const root = this.doc.documentElement
    root.removeAttribute(MODAL_ATTRIBUTE)
    for (const name of [VAR_X, VAR_Y, VAR_WIDTH]) root.style.removeProperty(name)
  }

  private clearTimers(): void {
    if (this.answerTimer !== undefined) clearTimeout(this.answerTimer)
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer)
    this.answerTimer = undefined
    this.settleTimer = undefined
  }
}
