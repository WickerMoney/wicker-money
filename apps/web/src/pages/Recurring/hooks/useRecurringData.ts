import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { Account, Category, RecurringItemList } from '../../../models/index.js'

/** What {@link useRecurringData} returns. */
export interface RecurringData {
  /** `null` until the first load completes. */
  readonly list: RecurringItemList | null
  /** Every account, archived included, so a leg on an archived account still has a name. */
  readonly accounts: readonly Account[]
  readonly categories: readonly Category[]
  /** Whether ended series and past one-offs are listed. */
  readonly includeEnded: boolean
  readonly setIncludeEnded: (include: boolean) => void
  /** Re-reads everything. Failures are shown through the status rather than thrown. */
  readonly reload: () => Promise<void>
}

/**
 * Loads the recurring items (with the server's today and monthly summary),
 * the accounts their legs name and the categories the form offers.
 *
 * @param status - Receives the message when a load fails.
 * @returns The data, the ended-items toggle and a reload function.
 */
export function useRecurringData(status: ActionStatus): RecurringData {
  const [list, setList] = useState<RecurringItemList | null>(null)
  const [accounts, setAccounts] = useState<readonly Account[]>([])
  const [categories, setCategories] = useState<readonly Category[]>([])
  const [includeEnded, setIncludeEnded] = useState(false)
  const { show } = status
  const latest = useLatestRequest()

  const reload = useCallback(
    () =>
      latest.run(
        (signal) => Promise.all([
          api.get<RecurringItemList>(`/recurring-items${includeEnded ? '?includeEnded=true' : ''}`, { signal }),
          api.get<Account[]>('/accounts?includeArchived=true', { signal }),
          api.get<Category[]>('/categories', { signal }),
        ]),
        ([items, accts, cats]) => { setList(items); setAccounts(accts); setCategories(cats) },
      ).catch((e: unknown) => show(e instanceof Error ? e.message : 'Could not load recurring items.')),
    [includeEnded, show, latest],
  )

  useEffect(() => {
    void reload()
    return latest.cancel
  }, [reload, latest])

  return { list, accounts, categories, includeEnded, setIncludeEnded, reload }
}
