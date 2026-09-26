import { EmptyState, SelectField, Surface } from '@wickermoney/ui-kit'
import type { ImportAccount } from '../models/index.js'

/** Props for {@link FileAccountStep}. */
export interface FileAccountStepProps {
  readonly accounts: readonly ImportAccount[]
  readonly accountId: string
  readonly onAccountChange: (id: string) => void
  /** Name of the file currently chosen, or an empty string. */
  readonly fileName: string
  /** Name of the saved mapping applied to the file, if one matched. */
  readonly matchedSource: string | null
  /** Called with the file the user picked. */
  readonly onFile: (file: File) => void
}

/** Step one of the import: choose the destination account and the CSV file. */
export function FileAccountStep({
  accounts, accountId, onAccountChange, fileName, matchedSource, onFile,
}: FileAccountStepProps) {
  return (
    <Surface title="1 · File and account">
      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          hint="Add an account first — an import has to land somewhere."
        />
      ) : (
        <div className="imp__row">
          <SelectField
            label="Import into"
            value={accountId}
            onChange={(e) => onAccountChange(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </SelectField>

          <div className="fio-field">
            <label className="fio-field__label" htmlFor="imp-file">CSV file</label>
            <input
              id="imp-file"
              className="fio-field__control"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file !== undefined) onFile(file)
              }}
            />
            {fileName !== '' ? <span className="imp__hint">{fileName}</span> : null}
            {matchedSource !== null ? (
              <span className="imp__hint">
                Using your saved mapping for <strong>{matchedSource}</strong>.
              </span>
            ) : null}
          </div>
        </div>
      )}
    </Surface>
  )
}
