import type { RecurringItem } from '../../../models/index.js'
import { recurringFate, type RecurringFate } from '../helpers/recurringFate.js'

/** Props for {@link RecurringAffectedNote}. */
export interface RecurringAffectedNoteProps {
  readonly accountName: string
  readonly items: readonly RecurringItem[]
  /** The move target once one is chosen; each item then says what happens to it. */
  readonly moveTo: { readonly id: string; readonly name: string } | null
}

const FATE_TEXT: Readonly<Record<RecurringFate, (target: string) => string>> = {
  moved: (target) => `moves to ${target}`,
  combined: (target) => `combined into ${target}`,
  removed: () => 'removed (it would move money from an account to itself)',
}

/**
 * Names the recurring items an account delete or move affects.
 *
 * Deleting with history removes each item whole, including a split paycheck's
 * leg on another account: a forecast silently paying less is harder to notice
 * than an item that is gone. So the panel lists them before anything happens.
 */
export function RecurringAffectedNote({ accountName, items, moveTo }: RecurringAffectedNoteProps) {
  if (items.length === 0) return null
  return (
    <div className="preview">
      <strong>Recurring items using '{accountName}'</strong>
      <ul className="preview__list">
        {items.map((item) => (
          <li key={item.id}>
            {item.name}
            {item.legs.length > 1 && moveTo === null ? <span className="wm-muted"> (also uses another account)</span> : null}
            {moveTo !== null ? <span className="wm-muted"> — {FATE_TEXT[recurringFate(item, moveTo.id)](moveTo.name)}</span> : null}
          </li>
        ))}
      </ul>
      {moveTo === null ? (
        <p className="form-hint">
          Deleting the history removes each of these entirely, even one that also pays into another account.
        </p>
      ) : null}
    </div>
  )
}
