import { useState } from 'react'
import type { AccountOption } from '../../../models/index.js'
import { today } from '../helpers/today.js'
import type { EntryFields } from '../state/EntryFields.js'

/**
 * Holds the fields common to both entry forms.
 *
 * @param accounts - The accounts on offer; until the user picks one, the first is the selection.
 * @returns The shared fields and their setters.
 */
export function useEntryFields(accounts: readonly AccountOption[]): EntryFields {
  const [accountId, setAccountId] = useState('')
  const [merchant, setMerchant] = useState('')
  const [date, setDate] = useState(today())

  return {
    accountId: accountId === '' ? (accounts[0]?.id ?? '') : accountId,
    setAccountId, merchant, setMerchant, date, setDate,
  }
}
