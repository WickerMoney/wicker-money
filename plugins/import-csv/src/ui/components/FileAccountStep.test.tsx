import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportAccount } from '../models/index.js'
import type { UploadStatus } from '../hooks/useImportFlow.js'
import { FileAccountStep } from './FileAccountStep.js'
import { ImportDoneStep } from './ImportDoneStep.js'

const ACCOUNTS = [{ id: 'a1', name: 'Checking' }] as unknown as ImportAccount[]
const upload = (over: Partial<UploadStatus>): UploadStatus => ({ phase: 'idle', sent: 0, total: 0, message: null, ...over })

function step(over: { upload?: UploadStatus; notice?: string | null; fileName?: string } = {}) {
  return render(
    <FileAccountStep
      accounts={ACCOUNTS} accountId="a1" onAccountChange={() => undefined} fileName={over.fileName ?? ''}
      matchedSource={null} onFile={() => undefined} upload={over.upload ?? upload({})} notice={over.notice ?? null}
    />,
  )
}

afterEach(() => { vi.restoreAllMocks() })

describe('FileAccountStep upload note', () => {
  it('says nothing before a file is chosen', () => {
    step()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('names the upload and shows how far it is while it runs, with a bar that has a name', () => {
    step({ fileName: 'big.csv', upload: upload({ phase: 'uploading', sent: 12, total: 36 }) })
    expect(screen.getByRole('status').textContent).toMatch(/Sending your file to the server/)
    const bar = screen.getByRole('progressbar', { name: 'Sending your file to the server' })
    expect(bar.getAttribute('value')).toBe('12')
    expect(bar.getAttribute('max')).toBe('36')
  })

  it('does not change its words from one chunk to the next, so a screen reader is not read 36 messages', () => {
    const { rerender } = step({ upload: upload({ phase: 'uploading', sent: 1, total: 36 }) })
    const before = screen.getByRole('status').textContent
    rerender(
      <FileAccountStep accounts={ACCOUNTS} accountId="a1" onAccountChange={() => undefined} fileName=""
        matchedSource={null} onFile={() => undefined} upload={upload({ phase: 'uploading', sent: 30, total: 36 })} notice={null} />,
    )
    expect(screen.getByRole('status').textContent).toBe(before)
  })

  it('says when the file is on the server', () => {
    step({ upload: upload({ phase: 'ready', sent: 36, total: 36 }) })
    expect(screen.getByRole('status').textContent).toBe('Your file is on the server.')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('shows a failure as an alert inside the section and scrolls it into view by the least', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    step({ notice: 'Other uploads are using all the space for staged files right now. Try again in about 30 seconds.' })
    expect(screen.getByRole('alert').textContent).toMatch(/Try again in about 30 seconds/)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })
})

describe('ImportDoneStep', () => {
  it('scrolls the result into view, because it replaces a review that may have been far from the window', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<ImportDoneStep result={{ imported: 5, skipped: 1, flagged: 0, failed: 0 }} onReset={() => undefined} />)
    expect(screen.getByRole('status').textContent).toMatch(/5.*transactions imported, 1 already present/)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
