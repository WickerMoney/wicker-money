import { Button, Field, SelectField } from '@wickermoney/ui-kit'
import type { ConditionType } from '../../../models/index.js'
import { CONDITION_TYPES } from '../helpers/conditionTypes.js'
import type { ConditionDraft } from '../state/ConditionDraft.js'

/** The fields of one condition row that can carry an error. */
export type ConditionErrors = Partial<Record<'textValue' | 'amountValue' | 'amountMin' | 'amountMax', string>>

/** Props for {@link ConditionRow}. */
export interface ConditionRowProps {
  /** The draft being edited. */
  readonly condition: ConditionDraft
  /** Position in the list; every row after the first is prefixed with "and". */
  readonly index: number
  /** `false` for the only remaining row, since a rule needs at least one condition. */
  readonly removable: boolean
  /** What is wrong with this row's values, by field. */
  readonly errors?: ConditionErrors
  /** Merges a partial edit into this row. */
  readonly onChange: (patch: Partial<ConditionDraft>) => void
  /** Called to delete this row. */
  readonly onRemove: () => void
}

/** One editable condition in the "Add a rule" form. The type picker swaps in the fields that type needs. */
export function ConditionRow({ condition: c, index, removable, errors = {}, onChange, onRemove }: ConditionRowProps) {
  return (
    <div className="rule-condition-row">
      {index > 0 ? <div className="rule-condition-row__and">and</div> : null}
      <div className="page__row">
        <SelectField label="Condition" value={c.conditionType}
                     onChange={(e) => onChange({ conditionType: e.target.value as ConditionType })}>
          {CONDITION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </SelectField>

        {c.conditionType === 'merchant_exact'
        || c.conditionType === 'merchant_contains'
        || c.conditionType === 'description_contains' ? (
          <>
            <Field label="Text" required value={c.textValue} error={errors.textValue}
                   onChange={(e) => onChange({ textValue: e.target.value })}
                   placeholder="GROCERY" />
            <label className="check rule-condition-row__case">
              <input type="checkbox" checked={c.isCaseSensitive}
                     onChange={(e) => onChange({ isCaseSensitive: e.target.checked })} />
              <span>Case-sensitive</span>
            </label>
          </>
        ) : null}

        {c.conditionType === 'amount_exact' ? (
          <>
            <SelectField label="Direction" value={c.direction}
                         onChange={(e) => onChange({ direction: e.target.value as 'in' | 'out' })}>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </SelectField>
            <Field label="Amount" required inputMode="decimal" value={c.amountValue} error={errors.amountValue}
                   onChange={(e) => onChange({ amountValue: e.target.value })}
                   placeholder="375.00" />
          </>
        ) : null}

        {c.conditionType === 'amount_range' ? (
          <>
            <SelectField label="Direction" value={c.direction}
                         onChange={(e) => onChange({ direction: e.target.value as 'in' | 'out' })}>
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </SelectField>
            <Field label="At least" inputMode="decimal" value={c.amountMin} error={errors.amountMin}
                   hint="Empty or 0 means no minimum."
                   onChange={(e) => onChange({ amountMin: e.target.value })}
                   placeholder="(no minimum)" />
            <Field label="At most" inputMode="decimal" value={c.amountMax} error={errors.amountMax}
                   hint="Empty means no maximum."
                   onChange={(e) => onChange({ amountMax: e.target.value })}
                   placeholder="(no maximum)" />
          </>
        ) : null}

        {removable ? <Button onClick={onRemove}>Remove</Button> : null}
      </div>
    </div>
  )
}
