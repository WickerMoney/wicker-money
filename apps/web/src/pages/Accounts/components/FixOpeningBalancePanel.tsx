import { Button, Field, Surface } from '@wickermoney/ui-kit'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Account, BalancePreview } from '../../../models/index.js'

/** Props for {@link FixOpeningBalancePanel}. */
export interface FixOpeningBalancePanelProps {
  /** The account being corrected. */
  readonly account: Account
  /** The opening balance as typed. */
  readonly balanceInput: string
  /** `null` until the server has previewed the typed value. */
  readonly preview: BalancePreview | null
  /** `true` while a request is in flight; disables the controls. */
  readonly busy: boolean
  /** Called as the typed value changes. */
  readonly onInputChange: (value: string) => void
  /** Called to save the previewed opening balance. */
  readonly onApply: () => void
  /** Called to close the panel without saving. */
  readonly onCancel: () => void
}

/**
 * The panel for correcting an account's opening balance.
 *
 * Shows the effect of the typed value before it can be applied, because
 * changing the opening figure moves every balance the account has ever reported.
 */
export function FixOpeningBalancePanel({
  account, balanceInput, preview, busy, onInputChange, onApply, onCancel,
}: FixOpeningBalancePanelProps) {
  return (
    <Surface title={`Fix opening balance for '${account.name}'`}>
      <p className="form-hint">
        The balance shown everywhere is derived as opening balance + everything recorded since,
        recomputed on every read. Changing the opening number here moves <strong>every balance
        this account has ever reported</strong> -- past and present -- which is exactly what you
        want when the opening number was wrong to begin with, so it gets its own preview rather
        than living in the ordinary edit above.
      </p>
      <Field
        label="New opening balance" inputMode="decimal" autoFocus
        value={balanceInput}
        onChange={(e) => onInputChange(e.target.value)}
      />
      {preview !== null ? (
        <div className="preview">
          Balance moves from <strong>{formatMoney(preview.currentBalance, account.currencyCode)}</strong> to{' '}
          <strong>{formatMoney(preview.newBalance, account.currencyCode)}</strong>
          {' '}({Number(preview.delta) >= 0 ? '+' : ''}{formatMoney(preview.delta, account.currencyCode)}),
          throughout this account's history.
        </div>
      ) : null}
      <div className="page__actions">
        <Button variant="primary" disabled={busy || preview === null} onClick={onApply}>
          {busy ? 'Applying…' : 'Apply'}
        </Button>
        <Button disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </Surface>
  )
}
