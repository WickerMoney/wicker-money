import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionNotice } from './SectionNotice.js'

describe('SectionNotice', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('shows nothing without a message', () => {
    const { container } = render(<SectionNotice message={null} />)
    expect(container.textContent).toBe('')
  })

  it('shows the message as an alert', () => {
    render(<SectionNotice message="Could not remove that line." />)
    expect(screen.getByRole('alert').textContent).toBe('Could not remove that line.')
  })

  it('scrolls itself into view, by the least that shows it, when a message appears', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = render(<SectionNotice message={null} />)
    expect(scroll).not.toHaveBeenCalled()

    rerender(<SectionNotice message="3 lines carried over from May 2026." />)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })

    rerender(<SectionNotice message={null} />)
    expect(scroll).toHaveBeenCalledTimes(1)
    // @ts-expect-error jsdom does not implement it; leave the prototype as it was found
    delete Element.prototype.scrollIntoView
  })
})
