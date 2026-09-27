import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** Props for {@link Button}: every native `<button>` attribute plus a visual variant. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual emphasis. Defaults to `"default"`. */
  readonly variant?: 'default' | 'primary' | 'danger'
  /** The button label or content. */
  readonly children?: ReactNode
}

/**
 * A button.
 *
 * `type` defaults to `"button"` rather than the browser's `"submit"`, which
 * surprises people inside a form. Pass `type="submit"` to opt in.
 */
export function Button({ variant = 'default', className, children, ...rest }: ButtonProps) {
  const classes = ['wm-btn', variant !== 'default' ? `wm-btn--${variant}` : '', className ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" {...rest} className={classes}>
      {children}
    </button>
  )
}
