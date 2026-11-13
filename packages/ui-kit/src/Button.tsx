import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { guardBusy } from './busy.js'

/** Props for {@link Button}: every native `<button>` attribute plus a visual variant. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. Defaults to `"default"`. */
  readonly variant?: 'default' | 'primary' | 'danger'
  /**
   * `true` while the action this button starts (or one beside it) is running. The button stays focusable and
   * looks disabled, is `aria-disabled`, and ignores a click with a spoken "Still working" message. Use it instead
   * of `disabled` for a request in flight: `disabled` drops keyboard focus to `<body>`. Keep `disabled` for a
   * button that cannot be used for another reason (an empty field).
   */
  readonly busy?: boolean
  /** The button label or content. */
  readonly children?: ReactNode
}

/**
 * A button.
 *
 * `type` defaults to `"button"` rather than the browser's `"submit"`, which
 * surprises people inside a form. Pass `type="submit"` to opt in.
 */
export function Button({ variant = 'default', busy = false, className, children, onClick, ...rest }: ButtonProps) {
  const classes = ['wm-btn', variant !== 'default' ? `wm-btn--${variant}` : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" {...rest} {...(busy ? { 'aria-disabled': true } : {})} className={classes} onClick={guardBusy(busy, onClick)}>
      {children}
    </button>
  )
}
