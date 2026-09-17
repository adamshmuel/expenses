import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import App from '../App'
import { renderWithProviders } from '../test/renderWithProviders'
import * as authApi from '../api/authApi'
import * as dashboardApi from '../api/dashboardApi'

vi.mock('../api/authApi')
vi.mock('../api/dashboardApi')

const user = { id: '1', username: 'adam', email: 'adam@example.com' }

describe('ProtectedRoute', () => {
  beforeEach(() => vi.resetAllMocks())

  it('sends a logged-out visitor to the login screen', async () => {
    vi.mocked(authApi.refresh).mockRejectedValue({ message: 'No session.', fieldErrors: {} })
    renderWithProviders(<App />, '/home')

    expect(await screen.findByRole('button', { name: /log in/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /chat/i })).not.toBeInTheDocument()
  })

  it('lets a logged-in visitor through', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ user, accessToken: 'abc' })
    renderWithProviders(<App />, '/home')

    expect(await screen.findByRole('heading', { name: /chat/i })).toBeInTheDocument()
  })

  it('reloading a deep link like /dashboard while logged in stays on /dashboard', async () => {
    vi.mocked(authApi.refresh).mockResolvedValue({ user, accessToken: 'abc' })
    vi.mocked(dashboardApi.getCategories).mockResolvedValue([])
    vi.mocked(dashboardApi.getSummary).mockResolvedValue([])
    vi.mocked(dashboardApi.getExpenses).mockResolvedValue([])
    renderWithProviders(<App />, '/dashboard')

    // Before restoreSession resolves, the app must not bounce through /login —
    // that flash is what destroys the /dashboard history entry (replace).
    expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument()

    expect(await screen.findByRole('group', { name: /period/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /chat/i })).not.toBeInTheDocument()
  })
})
