import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'
import * as authApi from '../api/authApi'
import * as chatApi from '../api/chatApi'

vi.mock('../api/authApi')
vi.mock('../api/chatApi')

const user = { id: '1', username: 'adam', email: 'adam@example.com' }

const send = async (text: string) => {
  await userEvent.type(await screen.findByLabelText(/message/i), text)
  await userEvent.click(screen.getByRole('button', { name: /^send$/i }))
}

describe('HomePage chat', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authApi.refresh).mockResolvedValue({ user, accessToken: 'abc' })
    vi.mocked(chatApi.getHistory).mockResolvedValue([])
  })

  it('shows an empty state before anything is typed', async () => {
    renderWithProviders(<App />, '/home')
    expect(await screen.findByText(/nothing here yet/i)).toBeInTheDocument()
  })

  it('loads and shows the chat history on entering the page', async () => {
    vi.mocked(chatApi.getHistory).mockResolvedValue([
      {
        _id: 'm1',
        text: 'spent 50 at the supermarket',
        role: 'user',
        author: 'u1',
        createdAt: '2026-09-14',
        updatedAt: '2026-09-14',
      },
      { _id: 'm2', text: 'Added.', role: 'assistant', author: 'u1', createdAt: '2026-09-14', updatedAt: '2026-09-14' },
    ])
    renderWithProviders(<App />, '/home')

    expect(await screen.findByText('spent 50 at the supermarket')).toBeInTheDocument()
    expect(screen.getByText('Added.')).toBeInTheDocument()
    expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument()
  })

  it('shows the reply once the server answers', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({ reply: 'Not sure what you mean.', intent: 'unknown' })
    renderWithProviders(<App />, '/home')

    await send('asdkjh')

    expect(chatApi.sendMessage).toHaveBeenCalledWith('asdkjh')
    expect(await screen.findByText('Not sure what you mean.')).toBeInTheDocument()
    expect(screen.getByText('asdkjh')).toBeInTheDocument()
  })

  it('asks for the amount and shows no confirm button when it is missing', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'How much did you spend at the supermarket?',
      intent: 'create-expense',
      drafts: [{ store: 'Supermarket', category: 'Groceries' }],
    })
    renderWithProviders(<App />, '/home')

    await send('spent something at the supermarket')

    expect(await screen.findByText(/how much did you spend/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
  })

  it('shows one confirm button for several drafts in one message', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add both of these?',
      intent: 'create-expense',
      drafts: [
        { amount: 50, store: 'Supermarket', category: 'Groceries', date: '2026-09-15' },
        { amount: 32, store: 'Gas station', category: 'Fuel', date: '2026-09-15' },
      ],
    })
    vi.mocked(chatApi.confirmChat).mockResolvedValue({ changed: {} })
    renderWithProviders(<App />, '/home')

    await send('spent 50 at the supermarket and 32 on gas')

    const drafts = within(await screen.findByRole('list', { name: /expenses to add/i }))
    expect(drafts.getByText(/supermarket/i)).toBeInTheDocument()
    expect(drafts.getByText(/gas station/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^confirm$/i })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: /^confirm$/i }))
    await waitFor(() =>
      expect(chatApi.confirmChat).toHaveBeenCalledWith({
        intent: 'create-expense',
        drafts: [
          { amount: 50, store: 'Supermarket', category: 'Groceries', date: '2026-09-15' },
          { amount: 32, store: 'Gas station', category: 'Fuel', date: '2026-09-15' },
        ],
      }),
    )
  })

  it('says so and shows nothing to confirm when an edit matches no expense', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'No expense matches that.',
      intent: 'edit-expense',
      matches: [],
    })
    renderWithProviders(<App />, '/home')

    await send('change the coffee expense to 20')

    expect(await screen.findByText(/no expense matches that/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
  })

  it('confirms straight away when exactly one expense matches', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Change it to 20?',
      intent: 'edit-expense',
      matches: [{ _id: 'e1', amount: 12, store: 'Cafe', date: '2026-09-14' }],
      changes: { amount: 20 },
    })
    vi.mocked(chatApi.confirmChat).mockResolvedValue({ changed: {} })
    renderWithProviders(<App />, '/home')

    await send('change the coffee to 20')

    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))
    await waitFor(() =>
      expect(chatApi.confirmChat).toHaveBeenCalledWith({ intent: 'edit-expense', id: 'e1', changes: { amount: 20 } }),
    )
  })

  it('asks the user to pick when an edit matches several expenses, then confirms the pick', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Which one?',
      intent: 'edit-expense',
      matches: [
        { _id: 'e1', amount: 12, store: 'Cafe', date: '2026-09-14' },
        { _id: 'e2', amount: 8, store: 'Cafe', date: '2026-09-10' },
      ],
      changes: { amount: 20 },
    })
    vi.mocked(chatApi.confirmChat).mockResolvedValue({ changed: {} })
    renderWithProviders(<App />, '/home')

    await send('change the cafe expense to 20')

    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
    const options = await screen.findAllByRole('button', { name: /cafe/i })
    expect(options).toHaveLength(2)

    await userEvent.click(options[1])
    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))

    await waitFor(() =>
      expect(chatApi.confirmChat).toHaveBeenCalledWith({ intent: 'edit-expense', id: 'e2', changes: { amount: 20 } }),
    )
  })

  it('confirms reset-categories with just the intent', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'This resets every category. Continue?',
      intent: 'reset-categories',
    })
    vi.mocked(chatApi.confirmChat).mockResolvedValue({ changed: {} })
    renderWithProviders(<App />, '/home')

    await send('reset my categories')
    await userEvent.click(await screen.findByRole('button', { name: /^confirm$/i }))

    await waitFor(() => expect(chatApi.confirmChat).toHaveBeenCalledWith({ intent: 'reset-categories' }))
  })

  it('cancels without calling confirm', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Add this?',
      intent: 'create-expense',
      drafts: [{ amount: 50, category: 'Groceries', date: '2026-09-15' }],
    })
    renderWithProviders(<App />, '/home')

    await send('spent 50 on groceries')
    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument()
    expect(chatApi.confirmChat).not.toHaveBeenCalled()
  })

  it('falls back to "Expense" when a match store name looks like a leaked JSON/HTML fragment', async () => {
    vi.mocked(chatApi.sendMessage).mockResolvedValue({
      reply: 'Which one?',
      intent: 'delete-expense',
      matches: [
        {
          _id: 'e1',
          amount: 12,
          store: 'supermarket", "category": "Groceries" } ] }</body></html>',
          date: '2026-09-14',
        },
        { _id: 'e2', amount: 8, store: 'Cafe', date: '2026-09-10' },
      ],
    })
    renderWithProviders(<App />, '/home')

    await send('delete one of these')

    expect(await screen.findByRole('button', { name: /^expense —/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cafe/i })).toBeInTheDocument()
  })

  it('shows an error and keeps the typed text when the server is unreachable', async () => {
    vi.mocked(chatApi.sendMessage).mockRejectedValue({
      message: 'Cannot reach the server. Check that it is running.',
      fieldErrors: {},
    })
    renderWithProviders(<App />, '/home')

    await send('spent 50 at the supermarket')

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i)
    expect(screen.getByLabelText(/message/i)).toHaveValue('spent 50 at the supermarket')
  })
})
