import { useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Account, BalancePreview } from '../../../models/index.js'

/** What {@link useOpeningBalanceFix} returns. */
export interface OpeningBalanceFix {
  /** The account whose opening balance is being corrected, or `null` when the panel is closed. */
  readonly fixing: Account | null
  /** The opening balance as typed. */
  readonly balanceInput: string
  /** The server's preview of the typed value, or `null` until one arrives. */
  readonly balancePreview: BalancePreview | null
  /** Opens the panel for an account, pre-filled with its current opening balance. */
  readonly open: (account: Account) => void
  /** Closes the panel without saving. */
  readonly cancel: () => void
  /** Records the typed value and requests a preview of its effect. */
  readonly preview: (value: string) => Promise<void>
  /** Saves the previewed opening balance. */
  readonly apply: () => Promise<void>
}

/**
 * State and actions for correcting an account's opening balance.
 *
 * This is a separate flow from ordinary editing because the balance is derived
 * (`initial_balance + SUM(transactions.amount)`): changing the opening figure
 * moves every historical balance the account has ever reported. That deserves
 * its own preview and its own explicit "Apply" rather than sharing the Save
 * button of a rename.
 *
 * @param status - Busy flag and error message shared with the page.
 * @param reload - Re-reads the accounts after a successful change.
 * @param showNotice - Shows a success message.
 * @returns The account being corrected, its preview, and the open, preview and apply actions.
 */
export function useOpeningBalanceFix(
  status: ActionStatus,
  reload: () => Promise<void>,
  showNotice: (message: string | null) => void,
): OpeningBalanceFix {
  const [fixing, setFixing] = useState<Account | null>(null)
  const [balanceInput, setBalanceInput] = useState('')
  const [balancePreview, setBalancePreview] = useState<BalancePreview | null>(null)

  const latest = useLatestRequest()

  const open = (a: Account) => {
    latest.cancel()
    setFixing(a); setBalanceInput(a.initialBalance); setBalancePreview(null)
  }

  const cancel = () => { latest.cancel(); setFixing(null); setBalancePreview(null) }

  const preview = async (value: string) => {
    if (fixing === null) return
    setBalanceInput(value)
    setBalancePreview(null)
    // An empty field must also drop a reply still in flight for the old text.
    latest.cancel()
    if (value.trim() === '') return
    try {
      // Typing fires a preview per keystroke and replies can overtake each
      // other; only the answer to the latest value may be shown.
      await latest.run(
        (signal) => api.post<BalancePreview>(
          `/accounts/${fixing.id}/initial-balance/preview`, { initialBalance: value }, { signal },
        ),
        setBalancePreview,
      )
    } catch {
      // A half-typed number is expected while the field is still being edited.
      // Apply stays disabled until a preview lands, so waiting for a valid
      // value is enough.
    }
  }

  const apply = async () => {
    if (fixing === null || balancePreview === null) return
    latest.cancel()
    status.begin()
    try {
      await api.post(`/accounts/${fixing.id}/initial-balance`, { initialBalance: balanceInput })
      const accountName = fixing.name
      const { currentBalance, newBalance } = balancePreview
      setFixing(null)
      setBalancePreview(null)
      await reload()
      showNotice(
        `'${accountName}''s balance moved from ${formatMoney(currentBalance)} to ${formatMoney(newBalance)}, throughout its history.`,
      )
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not update that opening balance.')
    } finally { status.end() }
  }

  return { fixing, balanceInput, balancePreview, open, cancel, preview, apply }
}
