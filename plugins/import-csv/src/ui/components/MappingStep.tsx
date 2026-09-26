import { Alert, Field, SelectField, Surface } from '@wickermoney/ui-kit'
import type { AmountStyle, ColumnMap, DateFormat, MapResult } from '../../shared/index.js'
import { ColumnSelect } from './ColumnSelect.js'

/** Props for {@link MappingStep}. */
export interface MappingStepProps {
  readonly headers: readonly string[]
  readonly columns: ColumnMap
  readonly onColumns: (next: ColumnMap) => void
  readonly dateFormat: DateFormat
  readonly onDateFormat: (next: DateFormat) => void
  readonly dateFormats: readonly DateFormat[]
  readonly amountStyle: AmountStyle
  readonly onAmountStyle: (next: AmountStyle) => void
  readonly invertAmount: boolean
  readonly onInvertAmount: (next: boolean) => void
  readonly sourceName: string
  readonly onSourceName: (next: string) => void
  readonly preview: MapResult | null
  readonly formatMoney: (value: string) => string
}

/**
 * Column mapping, date format and the parse preview, on one screen.
 *
 * The preview is not decoration. `03/04/2026` is a valid date under two formats
 * and means different months in each, so the only way to resolve it is to show
 * the user what their choice produced and let them look. Changing the format
 * re-renders the table immediately, which makes a wrong choice obvious at a
 * glance rather than months later.
 */
export function MappingStep(p: MappingStepProps) {
  const set = (patch: Partial<ColumnMap>) => p.onColumns({ ...p.columns, ...patch })
  const rows = p.preview?.rows.slice(0, 8) ?? []
  const errors = p.preview?.errors ?? []

  return (
    <Surface title="2 · Columns and formats">
      <div className="imp__grid">
        <ColumnSelect label="Date" headers={p.headers} value={p.columns.date}
                      onChange={(v) => set({ date: v })} required />
        <ColumnSelect label="Description" headers={p.headers} value={p.columns.merchant}
                      onChange={(v) => set({ merchant: v })} required />

        <SelectField
          label="Date format *"
          value={p.dateFormat}
          onChange={(e) => p.onDateFormat(e.target.value as DateFormat)}
        >
          {p.dateFormats.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </SelectField>

        <SelectField
          label="Amount columns"
          value={p.amountStyle}
          onChange={(e) => p.onAmountStyle(e.target.value as AmountStyle)}
        >
          <option value="signed">One signed amount column</option>
          <option value="debit-credit">Separate debit and credit columns</option>
        </SelectField>

        {p.amountStyle === 'signed' ? (
          <ColumnSelect label="Amount" headers={p.headers} value={p.columns.amount}
                        onChange={(v) => set({ amount: v })} required />
        ) : (
          <>
            <ColumnSelect label="Debit (money out)" headers={p.headers} value={p.columns.debit}
                          onChange={(v) => set({ debit: v })} />
            <ColumnSelect label="Credit (money in)" headers={p.headers} value={p.columns.credit}
                          onChange={(v) => set({ credit: v })} />
          </>
        )}

        <ColumnSelect label="Notes" headers={p.headers} value={p.columns.notes}
                      onChange={(v) => set({ notes: v })} />
        <ColumnSelect label="Transaction ID" headers={p.headers} value={p.columns.externalId}
                      onChange={(v) => set({ externalId: v })} />

        <Field label="Remember as" value={p.sourceName}
               onChange={(e) => p.onSourceName(e.target.value)}
               placeholder="e.g. Chase Checking" />
      </div>

      <label className="imp__check">
        <input type="checkbox" checked={p.invertAmount}
               onChange={(e) => p.onInvertAmount(e.target.checked)} />
        <span>
          Flip every sign — use this when the file shows spending as a positive number
        </span>
      </label>

      {p.columns.externalId === '' || p.columns.externalId === undefined ? (
        <p className="imp__hint">
          No transaction ID column mapped. Duplicates will be matched on amount, description
          and date instead, and anything that matches will be shown for review rather than
          skipped automatically.
        </p>
      ) : null}

      {p.preview === null ? (
        <p className="imp__hint">Choose a date and description column to see a preview.</p>
      ) : (
        <>
          <h3 className="imp__subhead">
            Preview — first {rows.length} of {p.preview.rows.length} readable rows
          </h3>
          <table className="imp__table">
            <thead>
              <tr><th>Row</th><th>Date</th><th>Description</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNumber}>
                  <td className="imp__muted">{r.rowNumber}</td>
                  <td>{r.date}</td>
                  <td>{r.merchant}</td>
                  <td className={`num ${r.amount.startsWith('-') ? 'imp__out' : 'imp__in'}`}>
                    {p.formatMoney(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {errors.length > 0 ? (
            <Alert>
              {errors.length} row{errors.length === 1 ? '' : 's'} could not be read and will be
              skipped. First: row {errors[0]?.rowNumber} — {errors[0]?.field}: {errors[0]?.reason}
            </Alert>
          ) : null}
        </>
      )}
    </Surface>
  )
}
