import { Button } from '@wickermoney/ui-kit'

/** Props for {@link CheckDuplicatesAction}. */
export interface CheckDuplicatesActionProps {
  /** Whether the file has at least one row to check. */
  readonly hasRows: boolean
  readonly busy: boolean
  /** Whether no account has been chosen yet. */
  readonly accountMissing: boolean
  readonly onCheck: () => void
}

/** The button that moves from column mapping to duplicate review; renders nothing until there are rows. */
export function CheckDuplicatesAction({ hasRows, busy, accountMissing, onCheck }: CheckDuplicatesActionProps) {
  if (!hasRows) return null
  return (
    <div className="imp__actions">
      <Button variant="primary" disabled={busy || accountMissing} onClick={onCheck}>
        {busy ? 'Checking…' : 'Check for duplicates'}
      </Button>
    </div>
  )
}
