import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Dialog } from './index.js'

describe('Dialog', () => {
  it('is named by its title and shows its content', () => {
    render(<Dialog title="Edit transaction" onClose={() => {}}><p>body</p></Dialog>)

    expect(screen.getByRole('dialog', { name: 'Edit transaction' })).toBeDefined()
    expect(screen.getByText('body')).toBeDefined()
  })

  it('puts the cursor in the first field rather than on the close button', () => {
    render(<Dialog title="T" onClose={() => {}}><input aria-label="First" /><input aria-label="Second" /></Dialog>)

    expect(document.activeElement).toBe(screen.getByLabelText('First'))
  })

  it('closes from the close button', () => {
    const onClose = vi.fn()
    render(<Dialog title="T" onClose={onClose}>x</Dialog>)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a click on the backdrop but not on a click inside', () => {
    const onClose = vi.fn()
    render(<Dialog title="T" onClose={onClose}><button type="button">inside</button></Dialog>)
    const dialog = screen.getByRole('dialog')

    fireEvent.mouseDown(screen.getByText('inside')); fireEvent.click(screen.getByText('inside'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(dialog); fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a drag that started inside and ended on the backdrop', () => {
    const onClose = vi.fn()
    render(<Dialog title="T" onClose={onClose}><input aria-label="f" /></Dialog>)

    fireEvent.mouseDown(screen.getByLabelText('f'))
    fireEvent.click(screen.getByRole('dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('gives focus back to what opened it when it goes away', () => {
    const opener = document.createElement('button')
    document.body.append(opener); opener.focus()
    const { unmount } = render(<Dialog title="T" onClose={() => {}}><input aria-label="f" /></Dialog>)
    expect(document.activeElement).not.toBe(opener)

    unmount()

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
