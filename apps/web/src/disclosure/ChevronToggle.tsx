import { Chevron } from './Chevron.js'

/** Props for {@link ChevronToggle}. */
export interface ChevronToggleProps {
  /** Whether the rows it controls are showing. */
  readonly expanded: boolean
  /** Called on click. */
  readonly onToggle: () => void
  /** What it does right now, e.g. "Show 3 subcategories of Housing". Required: it has no text. */
  readonly label: string
}

/** An arrow-only toggle for a row that owns other rows, such as a parent category. */
export function ChevronToggle({ expanded, onToggle, label }: ChevronToggleProps) {
  return (
    <button
      type="button" className="disclosure disclosure--icon"
      aria-expanded={expanded} aria-label={label} title={label} onClick={onToggle}
    >
      <Chevron />
    </button>
  )
}
