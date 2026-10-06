/** The disclosure arrow. Points right; CSS turns it down while its button is `aria-expanded`. */
export function Chevron() {
  return (
    <svg
      className="disclosure__chevron" viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}
