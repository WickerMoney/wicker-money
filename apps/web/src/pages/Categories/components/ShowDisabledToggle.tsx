/** Props for {@link ShowDisabledToggle}. */
export interface ShowDisabledToggleProps {
  /** How many categories are disabled; the toggle is hidden when there are none. */
  readonly count: number
  /** Whether disabled categories are listed. */
  readonly checked: boolean
  /** Called when the checkbox changes. */
  readonly onChange: (checked: boolean) => void
}

/** A checkbox that reveals disabled categories, shown only when some exist. */
export function ShowDisabledToggle({ count, checked, onChange }: ShowDisabledToggleProps) {
  if (count === 0) return null
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>Show {count} disabled {count === 1 ? 'category' : 'categories'}</span>
    </label>
  )
}
