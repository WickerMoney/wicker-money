/** Where a lifted page frame draws its page, in the frame's own viewport. Same fields as the SDK's `ModalLayoutMessage`. */
export interface LiftLayout {
  readonly lifted: boolean
  readonly x: number
  readonly y: number
  readonly width: number
}

/** What {@link PageFrameLift} needs. */
export interface PageFrameLiftOptions {
  /** The page frame's iframe. */
  readonly iframe: HTMLIFrameElement
  /** The element that holds the iframe in the page's flow (`.plugin-frame`). It keeps the iframe's place while it is lifted. */
  readonly root: HTMLElement
  /** Tells the frame where its page sits (`modal-layout`). */
  readonly send: (layout: LiftLayout) => void
  /** The host window. Replaceable in tests. */
  readonly win?: Window
}

/** Set on `<html>` while a frame is lifted: the window does not scroll (see `app.css`). */
export const SCROLL_LOCK_ATTRIBUTE = 'data-wm-frame-modal'
/** Set on the frame's holder while its iframe is lifted (see `app.css`). */
export const LIFTED_ATTRIBUTE = 'data-lifted'

const round = (n: number): number => Math.round(n * 100) / 100

/**
 * Lifts a page frame over the visible part of the content area while a modal dialog is open in it.
 *
 * A page frame is as tall as its content, so a `position: fixed` element in it, a native modal `<dialog>` among
 * them, is placed against the frame, not the window (ADR 0014, "Needs of P4"). Lifting makes the frame's own
 * viewport the part of the window the person can see, so the dialog fills it as the app's own dialogs do.
 *
 * What it changes, all of it undone by {@link release} and {@link dispose}:
 *
 * - The iframe becomes `position: fixed` over `<main>`'s visible box (CSS in `app.css`, keyed on the holder's
 *   `data-lifted`): never over the navigation or the phone's top bar, so the person can always leave. The holder
 *   keeps the iframe's old height, so nothing below it moves.
 * - The window stops scrolling (`data-wm-frame-modal` on `<html>`), as it does behind the app's own dialogs; the
 *   page behind the dialog stays where the person left it.
 * - The frame is told where its page sits in the new, larger viewport (`modal-layout`), so it can draw the page in
 *   the same place on screen and the person sees the page dimmed behind the dialog, not moved.
 *
 * The frame decides nothing about the layer's size or position: it only says "a modal is open" and receives where
 * its own page is. The rectangle it is lifted to is the host's CSS.
 */
export class PageFrameLift {
  private on = false
  /** Where the page was, before the lift: the holder's left, top and width in the window. */
  private home: { left: number; top: number; width: number } | null = null
  private readonly win: Window

  constructor(private readonly options: PageFrameLiftOptions) {
    this.win = options.win ?? window
  }

  /** Whether the frame is lifted. */
  get lifted(): boolean { return this.on }

  /** Lifts the frame (or, if it is lifted, tells it its layout again) and tells it where its page sits. */
  lift(): void {
    const { iframe, root } = this.options
    if (!this.on) {
      this.home = this.readHome()
      // The holder keeps the iframe's height, so the page below it stays put while the iframe is out of the flow.
      root.style.minHeight = `${Math.ceil(iframe.getBoundingClientRect().height)}px`
      root.setAttribute(LIFTED_ATTRIBUTE, 'true')
      this.win.document.documentElement.setAttribute(SCROLL_LOCK_ATTRIBUTE, '')
      this.win.addEventListener('resize', this.onResize)
      this.on = true
    }
    this.push()
  }

  /** Puts the frame back where it was and tells it so. Does nothing when it is not lifted. */
  release(): void {
    if (!this.on) return
    this.undo()
    this.options.send({ lifted: false, x: 0, y: 0, width: 0 })
  }

  /** Puts the frame back without telling it (it is going away). */
  dispose(): void {
    if (this.on) this.undo()
  }

  private undo(): void {
    this.on = false
    this.home = null
    this.win.removeEventListener('resize', this.onResize)
    this.options.root.removeAttribute(LIFTED_ATTRIBUTE)
    this.options.root.style.minHeight = ''
    this.win.document.documentElement.removeAttribute(SCROLL_LOCK_ATTRIBUTE)
  }

  private readHome(): { left: number; top: number; width: number } {
    const r = this.options.root.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width }
  }

  /** The window changed size while lifted (a phone turned over): the holder is where the page now belongs. */
  private readonly onResize = (): void => {
    if (!this.on) return
    this.home = this.readHome()
    this.push()
  }

  private push(): void {
    const home = this.home
    if (home === null) return
    // Reading the iframe's box forces the layout that the lift just changed, so this is where it sits now.
    const layer = this.options.iframe.getBoundingClientRect()
    this.options.send({
      lifted: true, x: round(home.left - layer.left), y: round(home.top - layer.top), width: round(home.width),
    })
  }
}
