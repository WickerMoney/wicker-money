import { useEffect, useId, useRef, type ReactNode } from 'react'

/** Props for {@link Dialog}. */
export interface DialogProps {
  /** Heading shown at the top; also the dialog's accessible name. */
  readonly title: string
  /**
   * The id of an element inside the dialog that describes it, announced after
   * the title (`aria-describedby`). Optional; use it when a short summary
   * carries what a person must know before choosing.
   */
  readonly describedBy?: string
  /** Called when the user dismisses the dialog: Escape, the close button or a click outside it. */
  readonly onClose: () => void
  /** The dialog content, usually a form. */
  readonly children?: ReactNode
}

/**
 * A modal dialog: a side drawer on a desktop window and a full-screen sheet on
 * a phone.
 *
 * Rendered only while it is wanted, so a form inside starts fresh each time it
 * opens. It is the native `<dialog>` shown with `showModal()`, which supplies
 * what a hand-rolled modal gets wrong: the page behind it is inert, Tab stays
 * inside, and Escape closes it. Focus goes back to whatever opened it.
 */
export function Dialog({ title, describedBy, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // A drag that starts inside the dialog (selecting text in an input) and ends
  // on the backdrop still fires a click on the dialog; only a press that began
  // on the backdrop counts as "click outside".
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      // showModal() would focus the close button; a form wants its first field. preventScroll: the dialog is
      // fixed to the window, so there is nothing to scroll to, and in a plugin's page frame (as tall as its
      // content, inside a scrolling window) the scroll would throw the person to the top of the frame.
      dialog.querySelector<HTMLElement>('.wm-dialog__body :is(input, select, textarea)')?.focus({ preventScroll: true })
    }
    return () => { opener?.focus() }
  }, [])

  return (
    <dialog
      ref={ref}
      className="wm-dialog"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onClose={onClose}
      onMouseDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (pressedBackdrop.current && e.target === e.currentTarget) onClose() }}
    >
      <div className="wm-dialog__header">
        <h2 className="wm-dialog__title" id={titleId}>{title}</h2>
        <button type="button" className="wm-btn wm-dialog__close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="wm-dialog__body">{children}</div>
    </dialog>
  )
}
