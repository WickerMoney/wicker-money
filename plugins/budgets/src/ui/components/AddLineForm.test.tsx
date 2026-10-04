import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NO_FORM_ERRORS } from '@wickermoney/ui-kit'
import { AddLineForm } from './AddLineForm.js'

const categories = [{ id: 'c1', name: 'Groceries', parent_id: null }]

describe('AddLineForm', () => {
  it("puts the server's refusal on the category picker", async () => {
    const onAdd = vi.fn().mockResolvedValue({ fields: { categoryId: 'Choose a category.' }, form: null })
    render(<AddLineForm categories={categories} lines={[]} busy={false} onAdd={onAdd} />)

    fireEvent.click(screen.getByText('Add line'))

    await vi.waitFor(() => {
      const select = screen.getByLabelText('Add a category')
      expect(select.getAttribute('aria-invalid')).toBe('true')
      expect(document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Choose a category.')
    })
  })

  it('shows nothing when the line is added', async () => {
    const onAdd = vi.fn().mockResolvedValue(NO_FORM_ERRORS)
    render(<AddLineForm categories={categories} lines={[]} busy={false} onAdd={onAdd} />)

    fireEvent.click(screen.getByText('Add line'))

    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledWith('c1'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
