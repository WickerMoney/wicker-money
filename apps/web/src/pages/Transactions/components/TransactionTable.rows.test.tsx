import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category, Transaction } from '../../../models/index.js'
import { makeTransaction } from '../../../testing/makeTransaction.js'
import { TransactionTable } from './TransactionTable.js'

/**
 * Rows are memoized: a state change that does not touch a row (selecting
 * another row, typing in the edit dialog) must not re-render it. A category
 * cell calls `categoryOptionsFor` once per render, so the calls are the count.
 */

const ROWS = 25
const items: Transaction[] = Array.from({ length: ROWS }, (_, i) =>
  makeTransaction({ id: `t${i}`, merchant: `Merchant ${i}`, amount: '-5.00' }))

/** The page passes `list.reload`, which keeps its identity between renders. */
const onChanged = async () => undefined
const onToggleAll = () => undefined

function Harness({ optionsFor }: { optionsFor: (currentId: string | null) => readonly Category[] }) {
  const status = useActionStatus()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  return (
    <TransactionTable
      items={items} selected={selected} onlyUncategorized={false} categoryOptionsFor={optionsFor} status={status}
      onToggleSelected={(id) => setSelected((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })}
      onToggleAllSelected={onToggleAll}
      onChanged={onChanged}
    />
  )
}

describe('TransactionTable row rendering', () => {
  it('does not re-render the rows when a selection changes', async () => {
    const optionsFor = vi.fn((): readonly Category[] => [])
    render(<Harness optionsFor={optionsFor} />)
    expect(optionsFor).toHaveBeenCalledTimes(ROWS)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Merchant 3' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Merchant 4' }))

    expect((screen.getByRole('checkbox', { name: 'Select Merchant 3' }) as HTMLInputElement).checked).toBe(true)
    expect(optionsFor).toHaveBeenCalledTimes(ROWS)
  })

  it('does not re-render the rows while typing in the edit dialog', async () => {
    const optionsFor = vi.fn((): readonly Category[] => [])
    render(<Harness optionsFor={optionsFor} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    const afterOpen = optionsFor.mock.calls.length

    await userEvent.type(screen.getByRole('textbox', { name: /merchant/i }), 'abc')

    expect(optionsFor).toHaveBeenCalledTimes(afterOpen)
  })
})
