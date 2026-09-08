import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'
import * as authApi from '../api/authApi'

vi.mock('../api/authApi')

const user = { id: '1', username: 'adam', email: 'adam@example.com' }

describe('NavBar', () => {
  beforeEach(() => vi.resetAllMocks())

  it('offers log in and sign up when nobody is logged in', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/login')

    const navbar = within(await screen.findByRole('banner'))
    expect(navbar.getByRole('link', { name: /log in/i })).toBeInTheDocument()
    expect(navbar.getByRole('link', { name: /sign up/i })).toBeInTheDocument()
    expect(navbar.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
  })

  it('shows the username and the app links once logged in', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ user, accessToken: 'abc' })
    renderWithProviders(<App />, '/home')

    const navbar = within(await screen.findByRole('banner'))
    expect(await navbar.findByText('adam')).toBeInTheDocument()
    expect(navbar.getByRole('link', { name: /home/i })).toBeInTheDocument()
    expect(navbar.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(navbar.getByRole('button', { name: /log out/i })).toBeInTheDocument()
  })

  it('returns to the login screen after logging out', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ user, accessToken: 'abc' })
    vi.mocked(authApi.logout).mockResolvedValue(undefined)
    renderWithProviders(<App />, '/home')

    await userEvent.click(await screen.findByRole('button', { name: /log out/i }))

    expect(await screen.findByRole('button', { name: /log in/i })).toBeInTheDocument()
  })
})
