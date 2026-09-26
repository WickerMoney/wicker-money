import type { EntryMode } from '../state/EntryMode.js'

/** Props for {@link EntryModeToggle}. */
export interface EntryModeToggleProps {
  /** The mode currently selected. */
  readonly mode: EntryMode
  /** Called with the mode the user picks. */
  readonly onChange: (mode: EntryMode) => void
}

/** The two-button switch between recording spending or income and recording a transfer. */
export function EntryModeToggle({ mode, onChange }: EntryModeToggleProps) {
  return (
    <div className="range" role="group" aria-label="What to record">
      <button
        type="button"
        className={`range__option${mode === 'spend' ? ' is-on' : ''}`}
        aria-pressed={mode === 'spend'}
        onClick={() => onChange('spend')}
      >
        Spending or income
      </button>
      <button
        type="button"
        className={`range__option${mode === 'transfer' ? ' is-on' : ''}`}
        aria-pressed={mode === 'transfer'}
        onClick={() => onChange('transfer')}
      >
        Transfer
      </button>
    </div>
  )
}
