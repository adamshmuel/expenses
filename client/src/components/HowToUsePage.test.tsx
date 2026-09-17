import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'
import * as authApi from '../api/authApi'

vi.mock('../api/authApi')

const ANIMATED_CAPTIONS = [
  /type a sentence like/i,
  /say .change the coffee to 22./i,
  /say .add a subcategory called pets under home./i,
]

const DASHBOARD_LESSON_TEXT = /dashboard shows.*total.*category breakdown/i

describe('HowToUsePage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('renders at /how-to-use for a visitor with no account, no token and no data', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    expect(await screen.findByRole('heading', { name: /how to use expenses/i })).toBeInTheDocument()
  })

  it('shows all three animated lesson captions', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    await screen.findByRole('heading', { name: /how to use expenses/i })
    for (const caption of ANIMATED_CAPTIONS) {
      expect(screen.getByText(caption)).toBeInTheDocument()
    }
  })

  it('has exactly three Replay controls — the fourth lesson has nothing to replay', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    await screen.findByRole('heading', { name: /how to use expenses/i })
    expect(screen.getAllByRole('button', { name: /replay/i })).toHaveLength(3)
  })

  it('the fourth lesson explains what the dashboard does and links to it, logged out', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    await screen.findByRole('heading', { name: /see where it went/i })
    expect(screen.getByText(DASHBOARD_LESSON_TEXT)).toBeInTheDocument()
    const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
    expect(dashboardLink).toHaveAttribute('href', '/dashboard')
  })

  it('lists example sentences the parser handles', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    expect(await screen.findByText(/spent 45 on groceries at shufersal/i)).toBeInTheDocument()
  })

  it('closes with a link to sign up when logged out', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    const page = within(await screen.findByRole('main'))
    expect(page.getByRole('link', { name: /sign up/i })).toHaveAttribute('href', '/signup')
  })

  it('closes with a link to the chat when logged in', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({
      user: { id: '1', username: 'adam', email: 'adam@example.com' },
      accessToken: 'abc',
    })
    renderWithProviders(<App />, '/how-to-use')

    expect(await screen.findByRole('link', { name: /go to the chat/i })).toHaveAttribute('href', '/home')
  })

  it('still shows every lesson\'s caption under prefers-reduced-motion, with no empty box', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')

    await screen.findByRole('heading', { name: /how to use expenses/i })
    for (const caption of ANIMATED_CAPTIONS) {
      expect(screen.getByText(caption)).toBeInTheDocument()
    }
    expect(screen.getByText(DASHBOARD_LESSON_TEXT)).toBeInTheDocument()
    // The final frame of "Record an expense" is a saved conversation, not an
    // empty composer.
    expect(screen.getAllByText('Done.').length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it('under reduced motion, "Record an expense" and "Fix a mistake" show the confirm step and the final state together, not just "Done."', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')
    await screen.findByRole('heading', { name: /how to use expenses/i })

    // The draft-and-Confirm control is what's missing from the final frame
    // alone (its pending card is gone by then) — showing it stacked above
    // "Done." is the actual fix, not just repeating the assistant's message,
    // which (being part of the cumulative thread) is already in both frames.
    // The animation stage is aria-hidden (the caption carries its meaning
    // for assistive tech), so this reads by visible text, like the rest of
    // this suite, not by role.
    const recordLesson = within(screen.getByRole('heading', { name: /^record an expense$/i }).closest('article')!)
    expect(recordLesson.getByText('Confirm', { exact: true })).toBeInTheDocument()
    expect(recordLesson.getAllByText('Done.').length).toBeGreaterThan(0)

    const fixLesson = within(screen.getByRole('heading', { name: /fix a mistake/i }).closest('article')!)
    expect(fixLesson.getByText('Confirm', { exact: true })).toBeInTheDocument()
    expect(fixLesson.getAllByText('Done.').length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it('hides Replay under reduced motion — nothing animates, so there is nothing to replay', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')
    await screen.findByRole('heading', { name: /how to use expenses/i })

    expect(screen.queryAllByRole('button', { name: /replay/i })).toHaveLength(0)

    vi.unstubAllGlobals()
  })

  it('gives each waiting lesson its own resting placeholder, not lesson 1\'s example sentence', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/how-to-use')
    await screen.findByRole('heading', { name: /how to use expenses/i })

    // Lesson 1 plays first (sequencer auto-plays the first registered lesson
    // in this test environment); lessons 2 and 3 wait their turn and must not
    // show lesson 1's "spent 50 at the supermarket" placeholder while they do.
    const fixLesson = within(screen.getByRole('heading', { name: /fix a mistake/i }).closest('article')!)
    expect(fixLesson.getAllByText(/nothing here yet\. try .change the coffee to 22\./i).length).toBeGreaterThan(0)
    expect(fixLesson.queryAllByText(/spent 50 at the supermarket/i)).toHaveLength(0)

    const categoriesLesson = within(screen.getByRole('heading', { name: /organise your categories/i }).closest('article')!)
    expect(
      categoriesLesson.getAllByText(/nothing here yet\. try .add a subcategory called pets under home\./i).length,
    ).toBeGreaterThan(0)
    expect(categoriesLesson.queryAllByText(/spent 50 at the supermarket/i)).toHaveLength(0)
  })

  it('gives every composer instance a unique DOM id — no duplicate ids on the page', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    const { container } = renderWithProviders(<App />, '/how-to-use')
    await screen.findByRole('heading', { name: /how to use expenses/i })

    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id)
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })
})
