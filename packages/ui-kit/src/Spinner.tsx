/** Props for {@link Spinner}. */
export interface SpinnerProps {
  /** Accessible name announced by screen readers. Defaults to `"Loading"`. */
  readonly label?: string
}

/** An inline loading indicator with `role="status"`. */
export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return <span className="fio-spinner" role="status" aria-label={label} />
}
