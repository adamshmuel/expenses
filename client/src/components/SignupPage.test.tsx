import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'
import * as authApi from '../api/authApi'

vi.mock('../api/authApi')

const user = { id: '1', username: 'adam', email: 'adam@example.com' }

const fillIn = async (values: { confirm?: string } = {}) => {
  await userEvent.type(await screen.findByLabelText(/username/i), 'adam')
  await userEvent.type(screen.getByLabelText(/email/i), 'adam@example.com')
  await userEvent.type(screen.getByLabelText(/^password$/i), 'password123')
  await userEvent.type(screen.getByLabelText(/confirm password/i), values.confirm ?? 'password123')
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
  })

  it('asks for a username, an email and the password twice', async () => {
    renderWithProviders(<App />, '/signup')
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
  })

  it('refuses to send when the two passwords differ', async () => {
    renderWithProviders(<App />, '/signup')
    await fillIn({ confirm: 'something-else' })
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    expect(authApi.register).not.toHaveBeenCalled()
  })

  it('sends the details when the form is valid', async () => {
    vi.mocked(authApi.register).mockResolvedValue({ user, accessToken: 'abc' })
    renderWithProviders(<App />, '/signup')
    await fillIn()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() =>
      expect(authApi.register).toHaveBeenCalledWith({
        username: 'adam',
        email: 'adam@example.com',
        password: 'password123',
      }),
    )
  })

  it('shows a server field error under the field it belongs to', async () => {
    vi.mocked(authApi.register).mockRejectedValue({
      message: 'Please fix the highlighted fields.',
      fieldErrors: { email: 'That email is already registered.' },
    })
    renderWithProviders(<App />, '/signup')
    await fillIn()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/that email is already registered/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('aria-invalid', 'true')
  })
})
