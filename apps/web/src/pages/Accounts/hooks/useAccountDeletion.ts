import { useState } from 'react'
import { NO_FORM_ERRORS, formErrorsFrom, type FormErrors } from '@wickermoney/ui-kit'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { Account, AccountUsage, MigrationPlan, RecurringItemList } from '../../../models/index.js'
import { describeUsage } from '../helpers/describeUsage.js'
import type { DeleteResolution } from '../state/DeleteResolution.js'

/** What {@link useAccountDeletion} returns. */
export interface AccountDeletion {
  /** Set once a delete has found that the account has history; `null` otherwise. */
  readonly resolving: DeleteResolution | null
  /** The account chosen to receive the history when moving it. */
  readonly migrateTargetId: string
  /** The server's preview of the move, or `null` until one is requested. */
  readonly migratePlan: MigrationPlan | null
  /** Active accounts the history could be moved to. */
  readonly migrateTargets: readonly Account[]
  /**
   * Why the last step in the panel was refused: `fields.toAccountId` for the
   * chosen target, `form` for anything else. Shown in the panel, where the
   * buttons are, not in the page banner.
   */
  readonly errors: FormErrors
  /** Hides the resolution panel without doing anything. */
  readonly dismiss: () => void
  /** Picks the account to move history into, and discards any earlier preview. */
  readonly chooseTarget: (id: string) => void
  /** Archives an account: hides it but keeps everything it has. */
  readonly archive: (account: Account) => Promise<void>
  /** Starts a delete. Deletes at once if nothing uses the account, otherwise opens the resolution panel. */
  readonly startDelete: (account: Account) => Promise<void>
  /** Deletes the account together with its history. */
  readonly deleteWithHistory: () => Promise<void>
  /** Asks the server what moving the history would do. */
  readonly previewMigrate: () => Promise<void>
  /** Moves the history into the chosen account, then deletes the emptied one. */
  readonly commitMigrate: () => Promise<void>
}

/**
 * State and actions for deleting an account.
 *
 * Three genuinely different outcomes are offered once an account is found to
 * have history: archive (keep the account and everything on it), delete with
 * history (remove the account and its ledger rows together), and move (keep the
 * ledger rows by relocating them into another account first).
 *
 * @param status - Busy flag and error message shared with the page.
 * @param accounts - The loaded accounts, used to offer move targets.
 * @param reload - Re-reads the accounts after a successful change.
 * @param showNotice - Shows or clears the success message.
 * @returns The resolution state and the archive, delete and move actions.
 */
export function useAccountDeletion(
  status: ActionStatus,
  accounts: readonly Account[] | null,
  reload: () => Promise<void>,
  showNotice: (message: string | null) => void,
): AccountDeletion {
  const [resolving, setResolving] = useState<DeleteResolution | null>(null)
  const [migrateTargetId, setMigrateTargetId] = useState('')
  const [migratePlan, setMigratePlan] = useState<MigrationPlan | null>(null)
  const [errors, setErrors] = useState<FormErrors>(NO_FORM_ERRORS)

  const migrateTargets = (accounts ?? []).filter(
    (a) => a.id !== resolving?.account.id && a.archivedAt === null,
  )

  const latestPreview = useLatestRequest()

  const dismiss = () => { latestPreview.cancel(); setResolving(null); setMigratePlan(null); setErrors(NO_FORM_ERRORS) }

  const chooseTarget = (id: string) => {
    latestPreview.cancel(); setMigrateTargetId(id); setMigratePlan(null); setErrors(NO_FORM_ERRORS)
  }

  const archive = async (a: Account) => {
    status.begin(); showNotice(null)
    try {
      await api.post(`/accounts/${a.id}/archive`, {})
      setResolving(null)
      await reload()
      showNotice(`'${a.name}' is archived. It's hidden from pickers, and every transaction it has keeps it.`)
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not archive that account.')
    } finally { status.end() }
  }

  /** Checks usage before deleting, so the user finds out before the click rather than after. */
  const startDelete = async (a: Account) => {
    status.begin(); showNotice(null)
    try {
      const usage = await api.get<AccountUsage>(`/accounts/${a.id}/usage`)
      if (usage.total === 0) {
        if (!window.confirm(`Delete '${a.name}'? Nothing is using it, so this is safe.`)) return
        await api.del(`/accounts/${a.id}`)
        await reload()
        return
      }
      // Only asked for when something recurring uses the account, so a plain
      // account with transactions costs one request, as before.
      const recurring = usage.by.some((u) => u.table === 'core.recurring_item_legs')
        ? (await api.get<RecurringItemList>(`/recurring-items?accountId=${a.id}&includeEnded=true`)).items
        : []
      latestPreview.cancel()
      setResolving({ account: a, usage, recurringItems: recurring })
      setMigrateTargetId('')
      setMigratePlan(null)
      setErrors(NO_FORM_ERRORS)
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not check that account.')
    } finally { status.end() }
  }

  const deleteWithHistory = async () => {
    if (resolving === null) return
    const { account, usage } = resolving
    if (!window.confirm(
      `Delete '${account.name}' AND ${describeUsage(usage)}? This cannot be undone.`,
    )) return
    status.begin(); setErrors(NO_FORM_ERRORS)
    try {
      const result = await api.post<{ deletedTransactions: number; deletedRecurringItems: number }>(
        `/accounts/${account.id}/delete-with-history`, { confirmCount: usage.total },
      )
      setResolving(null)
      await reload()
      showNotice(
        `Deleted '${account.name}', ${result.deletedTransactions} transaction` +
          `${result.deletedTransactions === 1 ? '' : 's'} and ${result.deletedRecurringItems} recurring item` +
          `${result.deletedRecurringItems === 1 ? '' : 's'} with it.`,
      )
    } catch (e) {
      setErrors(formErrorsFrom(e, [], 'Could not delete that account.'))
    } finally { status.end() }
  }

  const previewMigrate = async () => {
    if (resolving === null || migrateTargetId === '') return
    status.begin(); setMigratePlan(null); setErrors(NO_FORM_ERRORS)
    try {
      await latestPreview.run(
        (signal) => api.post<MigrationPlan>(
          `/accounts/${resolving.account.id}/migrate/preview`, { toAccountId: migrateTargetId }, { signal },
        ),
        setMigratePlan,
      )
    } catch (e) {
      setErrors(formErrorsFrom(e, ['toAccountId'], 'Could not preview that move.'))
    } finally { status.end() }
  }

  const commitMigrate = async () => {
    if (resolving === null || migratePlan === null || migrateTargetId === '') return
    const targetName = accounts?.find((a) => a.id === migrateTargetId)?.name ?? 'that account'
    if (!window.confirm(
      `Move ${resolving.usage.total} row${resolving.usage.total === 1 ? '' : 's'} of history from ` +
        `'${resolving.account.name}' into '${targetName}', then delete '${resolving.account.name}'?`,
    )) return
    status.begin(); setErrors(NO_FORM_ERRORS)
    try {
      await api.post(`/accounts/${resolving.account.id}/migrate`, {
        toAccountId: migrateTargetId,
        confirmCount: migratePlan.totalAffected,
      })
      const from = resolving.account.name
      setResolving(null)
      setMigratePlan(null)
      await reload()
      showNotice(`Moved '${from}''s history into '${targetName}' and deleted '${from}'.`)
    } catch (e) {
      setErrors(formErrorsFrom(e, ['toAccountId'], 'Could not complete that move.'))
    } finally { status.end() }
  }

  return {
    resolving, migrateTargetId, migratePlan, migrateTargets, errors,
    dismiss, chooseTarget, archive, startDelete, deleteWithHistory, previewMigrate, commitMigrate,
  }
}
