import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import { useLatestRequest } from '../../../hooks/useLatestRequest.js'
import type { Account, Category } from '../../../models/index.js'

/** What {@link useReferenceData} returns. */
export interface ReferenceData {
  /** The user's accounts. */
  readonly accounts: readonly Account[]
  /** Every category, including disabled ones. */
  readonly categories: readonly Category[]
  /** What a picker offers for a new choice: never a category the user has hidden. */
  readonly enabledCategories: readonly Category[]
}

/**
 * Loads the accounts and categories that the transaction pickers offer, once.
 *
 * @param status - Receives the message when the load fails.
 * @returns The accounts and categories, and the subset of categories a picker should offer.
 */
export function useReferenceData(status: ActionStatus): ReferenceData {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const { show } = status

  const latest = useLatestRequest()

  useEffect(() => {
    latest.run(
      (signal) => Promise.all([
        api.get<Account[]>('/accounts', { signal }),
        api.get<Category[]>('/categories', { signal }),
      ]),
      ([accs, cats]) => {
        setAccounts(accs)
        setCategories(cats)
      },
    ).catch((e: unknown) => {
      show(e instanceof Error ? e.message : 'Could not load transactions.')
    })
    return latest.cancel
  }, [show, latest])

  const enabledCategories = useMemo(() => categories.filter((c) => c.is_enabled), [categories])

  return { accounts, categories, enabledCategories }
}
