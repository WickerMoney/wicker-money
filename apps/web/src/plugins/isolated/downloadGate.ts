/**
 * Whether a frame's `download` may go ahead because of what the person just did.
 *
 * The default gate is `navigator.userActivation.isActive` on the host window plus the iframe being the document's
 * active element. Real input anywhere in the page sets the activation, a click inside a cross-origin frame included
 * (activation propagates to its ancestors), and nothing a script does can set it. It does not say which frame was
 * clicked, so `activeElement` (a click in a frame focuses its iframe) narrows it.
 *
 * A frame that loads within the activation window of a person's click on the host could satisfy both, so there is a
 * strict gate that also refuses when the host document saw real input in the last {@link STRICT_WINDOW_MS}. It is
 * implemented and tested but not turned on: {@link STRICT_DOWNLOAD_GATE} is the one switch, and it is `false`.
 * Turning it on, or a confirm dialog, is a condition of letting any plugin that is not bundled save files.
 */

/** The one switch for the strict gate. Wired only as the default (off). */
export const STRICT_DOWNLOAD_GATE = false

/** How recent host input must be to refuse a download under the strict gate, in milliseconds. */
export const STRICT_WINDOW_MS = 5000

/** What {@link downloadGateAllows} reads. */
export interface GateInputs {
  /** `navigator.userActivation.isActive` on the host window. */
  readonly activationActive: boolean
  /** Whether `document.activeElement` is this frame's iframe. */
  readonly iframeIsActive: boolean
  /** Epoch milliseconds of the last real input on the host document, or `null` if there was none. */
  readonly lastHostInputAt: number | null
  readonly now: number
}

/** The decision, as a function of what was observed. Pure so it can be tested without a browser. */
export function downloadGateAllows(inputs: GateInputs, strict: boolean): boolean {
  if (!inputs.activationActive || !inputs.iframeIsActive) return false
  if (!strict || inputs.lastHostInputAt === null) return true
  return inputs.now - inputs.lastHostInputAt > STRICT_WINDOW_MS
}

/** Observes the host window for one frame and answers {@link downloadGateAllows}. */
export class DownloadGate {
  private lastHostInputAt: number | null = null
  private readonly cleanup: () => void

  constructor(
    private readonly win: Window,
    private readonly iframe: HTMLIFrameElement,
    private readonly strict: boolean = STRICT_DOWNLOAD_GATE,
    private readonly now: () => number = () => Date.now(),
  ) {
    const note = (e: Event): void => { if (e.isTrusted) this.lastHostInputAt = this.now() }
    const types = ['pointerdown', 'keydown', 'touchstart'] as const
    for (const t of types) win.addEventListener(t, note, true)
    this.cleanup = () => { for (const t of types) win.removeEventListener(t, note, true) }
  }

  allows(): boolean {
    return downloadGateAllows({
      activationActive: this.win.navigator.userActivation?.isActive === true,
      iframeIsActive: this.win.document.activeElement === this.iframe,
      lastHostInputAt: this.lastHostInputAt,
      now: this.now(),
    }, this.strict)
  }

  dispose(): void { this.cleanup() }
}
