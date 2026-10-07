/** Props for {@link Spinner}. */
export interface SpinnerProps {
  /** Text announced by screen readers. Defaults to `"Loading"`. */
  readonly label?: string
}

/**
 * An inline loading indicator with `role="status"`.
 *
 * The label is visually hidden text inside the status region rather than an
 * `aria-label` on an empty element, so assistive technology announces it when
 * the spinner appears.
 */
export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span className="wm-spinner" role="status">
      <span className="wm-visually-hidden">{label}</span>
    </span>
  )
}
