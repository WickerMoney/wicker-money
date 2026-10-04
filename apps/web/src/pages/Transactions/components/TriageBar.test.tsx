import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../api/client.js'
import { errorOf } from '../../../testing/errorOf.js'
import { makeCategory } from '../../../testing/makeCategory.js'
import { makeStatus } from '../../../testing/makeStatus.js'
import { validationFailed } from '../../../testing/validationFailed.js'
import { TriageBar } from './TriageBar.js'

afterEach(() => { vi.restoreAllMocks() })

describe('TriageBar', () => {
  it("shows the server's refusal of a bulk change on the picker, not in the page banner", async () => {
    vi.spyOn(api, 'post').mockRejectedValue(validationFailed([['categoryId'], 'Category not found.']))
    const status = makeStatus()
    render(
      <TriageBar
        onlyUncategorized selectedIds={new Set(['t-1'])} enabledCategories={[makeCategory()]}
        status={status} onOnlyUncategorizedChange={() => {}} onApplied={async () => {}}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => { expect(errorOf('Set 1 to')).toBe('Category not found.') })
    expect(status.show).not.toHaveBeenCalled()
  })
})
