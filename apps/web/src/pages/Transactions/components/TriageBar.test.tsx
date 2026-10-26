import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { errorOf } from '../../../testing/errorOf.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { renderWithToasts } from '../../../testing/renderWithToasts.js'
import { shownToasts } from '../../../testing/shownToasts.js'
import { TriageBar } from './TriageBar.js'

afterEach(() => { vi.restoreAllMocks() })

describe('TriageBar', () => {
  it("shows the server's refusal of a bulk change on the picker, not in the page banner", async () => {
    vi.spyOn(api, 'post').mockRejectedValue(validationFailed([['categoryId'], 'Category not found.']))
    const status = makeStatus()
    renderWithToasts(
      <TriageBar
        onlyUncategorized selectedIds={new Set(['t-1'])} enabledCategories={[makeCategory()]}
        status={status} onOnlyUncategorizedChange={() => {}} onApplied={async () => {}}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => { expect(errorOf('Set 1 to')).toBe('Category not found.') })
    expect(status.show).not.toHaveBeenCalled()
  })

  it.each([[12, '12 transactions updated.'], [1, '1 transaction updated.']])(
    'says how many were updated (%i) in a toast and not in the page banner', async (updated, text) => {
      vi.spyOn(api, 'post').mockResolvedValue({ updated })
      const status = makeStatus()
      const onApplied = vi.fn(async () => {})
      renderWithToasts(
        <TriageBar
          onlyUncategorized selectedIds={new Set(['t-1'])} enabledCategories={[makeCategory()]}
          status={status} onOnlyUncategorizedChange={() => {}} onApplied={onApplied}
        />,
      )

      await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }))

      await waitFor(() => { expect(shownToasts()).toEqual([text]) })
      expect(onApplied).toHaveBeenCalled()
      expect(status.show).not.toHaveBeenCalled()
    },
  )
})
