import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingProvider } from './OnboardingProvider.js'
import { useOnboarding } from './useOnboarding.js'
import { SetupWizard } from './SetupWizard.js'
import { api } from '../api/client.js'

const GROUPS = [
  {
    key: 'home',
    title: 'Your home',
    hint: 'Renting is covered by the basics.',
    questions: [
      { situation: 'homeowner', label: 'I own my home', hint: 'Property taxes, repairs' },
      { situation: 'hoa', label: 'I pay HOA fees', hint: null },
    ],
  },
  {
    key: 'pets',
    title: 'Who else is in the picture',
    hint: null,
    questions: [{ situation: 'pets', label: 'I have pets', hint: null }],
  },
]

function status(onboardedAt: string | null, situations: string[] = []) {
  return { onboardedAt, situations, categoryCount: 0, groups: GROUPS }
}

let get: ReturnType<typeof vi.spyOn>
let post: ReturnType<typeof vi.spyOn>

function mount() {
  return render(
    <OnboardingProvider>
      <SetupWizard />
    </OnboardingProvider>,
  )
}

beforeEach(() => {
  get = vi.spyOn(api, 'get')
  post = vi.spyOn(api, 'post')
  post.mockImplementation(async (path: string) =>
    path === '/onboarding/preview' ? { total: 61, parents: 18, slugs: [] } : {},
  )
})
afterEach(() => { vi.restoreAllMocks() })

describe('when setup has never been run', () => {
  beforeEach(() => { get.mockResolvedValue(status(null)) })

  it('opens by itself on first entry', async () => {
    mount()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('I own my home')).toBeTruthy()
  })

  it('renders the questions the server sent, not a list of its own', async () => {
    mount()
    await screen.findByRole('dialog')
    // The web app has no catalog. A checkbox it invented would tick and create
    // nothing, which is why this asserts on the server's payload specifically.
    expect(screen.getByText('Step 1 of 2 · Your home')).toBeTruthy()
    expect(screen.getByText('Property taxes, repairs')).toBeTruthy()
  })

  it('walks forward through the steps and back again', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('I have pets')).toBeTruthy()
    // Last step offers the commit, not another Next.
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('I own my home')).toBeTruthy()
  })

  it('keeps answers when stepping between groups', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('dialog')

    await user.click(screen.getByLabelText(/I own my home/))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect((screen.getByLabelText(/I own my home/) as HTMLInputElement).checked).toBe(true)
  })

  it('shows a running total from the server rather than counting locally', async () => {
    mount()
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(screen.getByText('61 categories across 18 groups')).toBeTruthy()
    })
    expect(post).toHaveBeenCalledWith('/onboarding/preview', { situations: [] })
  })

  it('sends only the ticked situations when finishing', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('dialog')

    await user.click(screen.getByLabelText(/I own my home/))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Create categories' }))

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/onboarding/complete', { situations: ['homeowner'] })
    })
  })

  it('closes once setup reports as finished', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('dialog')

    get.mockResolvedValue(status('2026-09-16T00:00:00.000Z', ['always', 'homeowner']))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Create categories' }))

    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('can be put off, and says so rather than pretending to be permanent', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: 'Not now' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    // Nothing was written — the account is still un-onboarded, so a reload
    // brings it back. That is the behaviour the label promises.
    expect(post).not.toHaveBeenCalledWith('/onboarding/complete', expect.anything())
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the dialog by its heading and focuses the heading, once per step', async () => {
    const user = userEvent.setup()
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Set up your categories' })
    const heading = screen.getByRole('heading', { name: 'Set up your categories' })
    await waitFor(() => { expect(document.activeElement).toBe(heading) })
    expect(dialog.getAttribute('aria-label')).toBeNull()

    // Ticking a box must not pull focus back to the heading.
    const box = screen.getByLabelText(/I own my home/)
    await user.click(box)
    expect(document.activeElement).toBe(box)

    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => { expect(document.activeElement).toBe(heading) })
    expect(screen.getByText(/Step 2 of 2/)).toBeTruthy()
  })

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <OnboardingProvider>
        <button type="button">outside</button>
        <SetupWizard />
      </OnboardingProvider>,
    )
    const dialog = await screen.findByRole('dialog')
    const inside = () => dialog.contains(document.activeElement)
    for (let i = 0; i < 12; i++) { await user.tab(); expect(inside()).toBe(true) }
    for (let i = 0; i < 12; i++) { await user.tab({ shift: true }); expect(inside()).toBe(true) }
  })

  it('returns focus to the opener when it closes', async () => {
    const user = userEvent.setup()
    render(
      <OnboardingProvider>
        <button type="button">opener</button>
        <SetupWizard />
      </OnboardingProvider>,
    )
    // Focus the opener before the status resolves and the wizard opens itself.
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('while the questions are loading', () => {
  it('has an accessible name and holds focus', async () => {
    get.mockReturnValue(new Promise(() => {}))
    function Opener() {
      const { start } = useOnboarding()
      return <button type="button" onClick={start}>open setup</button>
    }
    const user = userEvent.setup()
    render(<OnboardingProvider><Opener /><SetupWizard /></OnboardingProvider>)
    await user.click(screen.getByRole('button', { name: 'open setup' }))
    const dialog = await screen.findByRole('dialog', { name: 'Setup' })
    expect(document.activeElement).toBe(dialog)
    await user.tab()
    expect(document.activeElement).toBe(dialog)
  })
})

describe('when setup has already been run', () => {
  it('stays shut', async () => {
    get.mockResolvedValue(status('2026-09-16T00:00:00.000Z', ['always']))
    mount()
    await waitFor(() => { expect(get).toHaveBeenCalledWith('/onboarding') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays shut for an account whose categories were all deleted', async () => {
    // The flag is the intent; an empty category list is a consequence. Treating
    // the consequence as the trigger reopens the wizard every time someone
    // tidies up.
    get.mockResolvedValue({ ...status('2026-09-16T00:00:00.000Z', ['always']), categoryCount: 0 })
    mount()
    await waitFor(() => { expect(get).toHaveBeenCalledWith('/onboarding') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('when the status cannot be read', () => {
  it('leaves the app usable instead of blocking on a modal', async () => {
    get.mockRejectedValue(new Error('network down'))
    mount()
    await waitFor(() => { expect(get).toHaveBeenCalledWith('/onboarding') })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
