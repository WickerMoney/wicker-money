import { EmptyState, SelectField, Surface, type FormErrors } from '@wickermoney/ui-kit'
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
  /** Why the account or the file was refused, keyed `accountId` or `csv`. */
  readonly errors?: FormErrors
}

/** Step one of the import: choose the destination account and the CSV file. */
export function FileAccountStep({
  accounts, accountId, onAccountChange, fileName, matchedSource, onFile, errors,
}: FileAccountStepProps) {
  const fileError = errors?.fields['csv']
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
            error={errors?.fields['accountId']}
            onChange={(e) => onAccountChange(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </SelectField>

          <div className="wm-field">
            <label className="wm-field__label" htmlFor="imp-file">CSV file</label>
            <input
              id="imp-file"
              className="wm-field__control"
              type="file"
              accept=".csv,text/csv"
              aria-invalid={fileError !== undefined}
              aria-describedby={fileError !== undefined ? 'imp-file-error' : undefined}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file !== undefined) onFile(file)
              }}
            />
            {fileName !== '' ? <span className="imp__hint">{fileName}</span> : null}
            {fileError !== undefined ? <span className="wm-field__error" id="imp-file-error">{fileError}</span> : null}
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
