import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'
import * as authApi from '../api/authApi'

vi.mock('../api/authApi')

const user = { id: '1', username: 'adam', email: 'adam@example.com' }

describe('LoginPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
  })

  it('shows a username field, a password field and a log in button', async () => {
    renderWithProviders(<App />, '/login')
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument()
  })

  it('sends what was typed to the server', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user, accessToken: 'abc' })
    renderWithProviders(<App />, '/login')

    await userEvent.type(await screen.findByLabelText(/username/i), 'adam')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() =>
      expect(authApi.login).toHaveBeenCalledWith({ username: 'adam', password: 'password123' }),
    )
  })

  it('shows one generic message when the credentials are wrong', async () => {
    vi.mocked(authApi.login).mockRejectedValue({
      message: 'Username or password is incorrect.',
      fieldErrors: {},
    })
    renderWithProviders(<App />, '/login')

    await userEvent.type(await screen.findByLabelText(/username/i), 'adam')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Username or password is incorrect.',
    )
  })

  it('takes the user to the chat once logged in', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ user, accessToken: 'abc' })
    renderWithProviders(<App />, '/login')

    await userEvent.type(await screen.findByLabelText(/username/i), 'adam')
    await userEvent.type(screen.getByLabelText(/password/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('heading', { name: /chat/i })).toBeInTheDocument()
  })
})
