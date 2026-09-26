import { Button, CategoryOptions, SelectField } from '@wickermoney/ui-kit'
import { useState } from 'react'
import { api } from '../../../api/client.js'
import type { ActionStatus } from '../../../hooks/useActionStatus.js'
import type { Category } from '../../../models/index.js'

/** Props for {@link TriageBar}. */
export interface TriageBarProps {
  /** Whether the list is filtered to uncategorized transactions. */
  readonly onlyUncategorized: boolean
  /** Called when the filter checkbox changes. */
  readonly onOnlyUncategorizedChange: (checked: boolean) => void
  /** Ids of the transactions a bulk action applies to. */
  readonly selectedIds: ReadonlySet<string>
  /** Categories offered for bulk assignment. */
  readonly enabledCategories: readonly Category[]
  /** Busy flag and error message shared with the page. */
  readonly status: ActionStatus
  /** Called after a bulk change succeeds, so the selection can be cleared and the list re-read. */
  readonly onApplied: () => Promise<void>
}

/**
 * Controls for working through a backlog of uncategorized transactions.
 *
 * A fresh import leaves everything uncategorized unless a rule matched. Rules
 * cover the bulk of it; this bar handles the tail that no rule fits, by
 * filtering to the uncategorized rows and filing a selection into one category.
 */
export function TriageBar({
  onlyUncategorized, onOnlyUncategorizedChange, selectedIds, enabledCategories, status, onApplied,
}: TriageBarProps) {
  const [bulkCategoryId, setBulkCategoryId] = useState('')

  const assignSelected = async () => {
    status.begin()
    try {
      const r = await api.post<{ updated: number }>('/transactions/categorize', {
        transactionIds: [...selectedIds],
        categoryId: bulkCategoryId === '' ? null : bulkCategoryId,
      })
      await onApplied()
      status.show(`${r.updated} transaction${r.updated === 1 ? '' : 's'} updated.`)
    } catch (e) {
      status.show(e instanceof Error ? e.message : 'Could not update those transactions.')
    } finally { status.end() }
  }

  return (
    <div className="page__actions">
      <label className="check">
        <input type="checkbox" checked={onlyUncategorized}
               onChange={(e) => onOnlyUncategorizedChange(e.target.checked)} />
        <span>Only uncategorized</span>
      </label>

      {selectedIds.size > 0 ? (
        <>
          <SelectField label={`Set ${selectedIds.size} to`} value={bulkCategoryId}
                       onChange={(e) => setBulkCategoryId(e.target.value)}>
            <CategoryOptions
              categories={enabledCategories}
              placeholder={{ value: '', label: '— clear category —' }}
            />
          </SelectField>
          <Button variant="primary" disabled={status.busy} onClick={() => void assignSelected()}>
            {status.busy ? 'Applying…' : 'Apply'}
          </Button>
        </>
      ) : null}
    </div>
  )
}
