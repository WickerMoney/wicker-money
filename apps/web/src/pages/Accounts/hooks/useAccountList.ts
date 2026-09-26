import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { Account } from '../../../models/index.js'

/** What {@link useAccountList} returns. */
export interface AccountList {
  /** `null` until the first load completes. */
  readonly accounts: Account[] | null
  /** Whether archived accounts are included in the list. */
  readonly includeArchived: boolean
  /** Changes `includeArchived` and reloads. */
  readonly setIncludeArchived: (include: boolean) => void
  /** Re-reads the accounts. Failures are shown through the status rather than thrown. */
  readonly reload: () => Promise<void>
}

/**
 * Loads the user's accounts, optionally including archived ones.
 *
 * @param status - Receives the message when a load fails.
 * @returns The loaded accounts, the archived-visibility toggle and a reload function.
 */
export function useAccountList(status: ActionStatus): AccountList {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)
  const { show } = status

  const latest = useLatestRequest()

  const reload = useCallback(
    () =>
      latest.run(
        (signal) => api.get<Account[]>(`/accounts${includeArchived ? '?includeArchived=true' : ''}`, { signal }),
        setAccounts,
      ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load accounts.')),
    [includeArchived, show, latest],
  )

  useEffect(() => {
    void reload()
    return latest.cancel
  }, [reload, latest])

  return { accounts, includeArchived, setIncludeArchived, reload }
}
