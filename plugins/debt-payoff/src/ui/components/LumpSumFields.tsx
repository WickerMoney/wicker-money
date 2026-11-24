import { Field } from '@wickermoney/ui-kit'
import { partField } from '../helpers/checkLumpSumDraft.js'
import type { Debt, LumpSumDraft } from '../models/index.js'

/** Props for {@link LumpSumFields}. */
export interface LumpSumFieldsProps {
  readonly draft: LumpSumDraft
  /** The debts a part can be aimed at: the ones that are not archived. */
  readonly debts: readonly Debt[]
  /** The problem on a field by name, as `useFormErrors` keeps them. */
  readonly error: (field: string) => string | undefined
  readonly onChange: (patch: Partial<LumpSumDraft>, field?: string) => void
  /** Whether to show the note (a what-if has none). */
  readonly withNote: boolean
}

/**
 * The fields a lump sum is typed into: when, how much, an optional note, and an
 * optional amount for each debt. Whatever is not aimed at a debt follows the
 * strategy, like the extra payment does.
 */
export function LumpSumFields({ draft, debts, error, onChange, withNote }: LumpSumFieldsProps) {
  return (
    <>
      <Field
        label="Date paid"
        hint="The day the money goes to your debts. A date that has passed is ignored by the plan."
        type="date"
        value={draft.onDate}
        error={error('onDate')}
        onChange={(e) => onChange({ onDate: e.target.value }, 'onDate')}
      />
      <Field
        label="Amount"
        hint="The whole lump sum, such as a bonus or a tax refund."
        inputMode="decimal"
        autoComplete="off"
        value={draft.amount}
        error={error('amount')}
        onChange={(e) => onChange({ amount: e.target.value }, 'amount')}
      />
      {withNote ? (
        <Field
          label="Note (optional)"
          hint="What it is, such as Tax refund."
          autoComplete="off"
          value={draft.note}
          error={error('note')}
          onChange={(e) => onChange({ note: e.target.value }, 'note')}
        />
      ) : null}
      {debts.length > 0 ? (
        <fieldset className="dp-parts">
          <legend>Aim part of it at one debt (optional)</legend>
          <p className="dp-muted">
            Anything you do not aim goes where the strategy points: the debt it would pay next.
          </p>
          {debts.map((d) => (
            <Field
              key={d.id}
              label={`To ${d.name}`}
              inputMode="decimal"
              autoComplete="off"
              value={draft.allocations[d.id] ?? ''}
              error={error(partField(d.id))}
              onChange={(e) => onChange({ allocations: { ...draft.allocations, [d.id]: e.target.value } }, partField(d.id))}
            />
          ))}
        </fieldset>
      ) : null}
    </>
  )
}
