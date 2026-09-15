import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardPage } from './DashboardPage'
import { renderWithProviders } from '../test/renderWithProviders'
import * as dashboardApi from '../api/dashboardApi'

vi.mock('../api/dashboardApi')

const categories = [
  { _id: 'home', name: 'Home' },
  { _id: 'rent', name: 'Rent', parent: 'home' },
  { _id: 'utilities', name: 'Utilities', parent: 'home' },
  { _id: 'health', name: 'Health' },
]

const summary = [
  { _id: 'rent', total: 3800 },
  { _id: 'utilities', total: 312.4 },
  { _id: 'health', total: 260 },
]

const expenses = [
  { _id: 'e1', amount: 3800, store: 'Landlord', date: '2026-09-05', category: 'rent' },
  { _id: 'e2', amount: 260, store: 'Super-Pharm', date: '2026-09-10', category: 'health' },
  { _id: 'e3', amount: 312.4, store: 'Bezeq', date: '2026-09-12', category: 'utilities' },
]

const mockLoaded = () => {
  vi.mocked(dashboardApi.getCategories).mockResolvedValue(categories)
  vi.mocked(dashboardApi.getSummary).mockResolvedValue(summary)
  vi.mocked(dashboardApi.getExpenses).mockResolvedValue(expenses)
}

describe('DashboardPage', () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-15T12:00:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a loading state before the data arrives', async () => {
    vi.mocked(dashboardApi.getCategories).mockReturnValue(new Promise(() => {}))
    vi.mocked(dashboardApi.getSummary).mockReturnValue(new Promise(() => {}))
    vi.mocked(dashboardApi.getExpenses).mockReturnValue(new Promise(() => {}))
    renderWithProviders(<DashboardPage />, '/dashboard')

    expect(screen.getByText(/totting up/i)).toBeInTheDocument()
  })

  it('shows an error with a retry button when the request fails', async () => {
    vi.mocked(dashboardApi.getCategories).mockRejectedValue({ message: 'Cannot reach the server.', fieldErrors: {} })
    vi.mocked(dashboardApi.getSummary).mockResolvedValue([])
    vi.mocked(dashboardApi.getExpenses).mockResolvedValue([])
    renderWithProviders(<DashboardPage />, '/dashboard')

    expect(await screen.findByText(/could not be fetched/i)).toBeInTheDocument()

    mockLoaded()
    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('shows an empty state when nothing was spent in the period', async () => {
    vi.mocked(dashboardApi.getCategories).mockResolvedValue(categories)
    vi.mocked(dashboardApi.getSummary).mockResolvedValue([])
    vi.mocked(dashboardApi.getExpenses).mockResolvedValue([])
    renderWithProviders(<DashboardPage />, '/dashboard')

    expect(await screen.findByText(/nothing filed in this period/i)).toBeInTheDocument()
  })

  it('shows the total and the category breakdown from live data', async () => {
    mockLoaded()
    renderWithProviders(<DashboardPage />, '/dashboard')

    expect((await screen.findAllByText('₪ 4,372.40')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /health/i })).toBeInTheDocument()
  })

  it('expands a main category to show its subcategories on click, and collapses on a second click', async () => {
    mockLoaded()
    renderWithProviders(<DashboardPage />, '/dashboard')

    const category = await screen.findByRole('region', { name: /by category/i })
    const homeRow = within(category).getByRole('button', { name: /home/i })
    expect(within(category).queryByText('Rent')).not.toBeInTheDocument()

    await user.click(homeRow)
    expect(within(category).getByText('Rent')).toBeInTheDocument()
    expect(within(category).getByText('Utilities')).toBeInTheDocument()

    await user.click(homeRow)
    expect(within(category).queryByText('Rent')).not.toBeInTheDocument()
  })

  it('lists recent expenses with their resolved category name', async () => {
    mockLoaded()
    renderWithProviders(<DashboardPage />, '/dashboard')

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    // header + 3 expenses
    expect(rows).toHaveLength(4)
    expect(within(table).getByText('Landlord')).toBeInTheDocument()
    expect(within(table).getByText('Rent')).toBeInTheDocument()
  })

  it('shows the expenses and categories-used stat tiles, computed client-side', async () => {
    vi.mocked(dashboardApi.getCategories).mockResolvedValue(categories)
    vi.mocked(dashboardApi.getSummary).mockResolvedValue(summary) // 3 rows -> 3 categories used
    vi.mocked(dashboardApi.getExpenses).mockResolvedValue([
      ...expenses,
      { _id: 'e4', amount: 50, store: 'Extra', date: '2026-09-13', category: 'rent' },
    ]) // 4 expenses, still 3 categories used
    renderWithProviders(<DashboardPage />, '/dashboard')

    await screen.findByText('Home')

    const expensesTile = screen.getByText('Expenses').closest('div')
    expect(within(expensesTile!).getByText('4')).toBeInTheDocument()

    const categoriesTile = screen.getByText('Categories used').closest('div')
    expect(within(categoriesTile!).getByText('3')).toBeInTheDocument()
  })

  it('does not show a "largest single expense" stat tile', async () => {
    mockLoaded()
    renderWithProviders(<DashboardPage />, '/dashboard')

    await screen.findByText('Home')
    expect(screen.queryByText(/largest/i)).not.toBeInTheDocument()
  })

  it('rolls up a main category with both direct and subcategory spend, and shows each row\'s % share', async () => {
    const cats = [
      { _id: 'home', name: 'Home' },
      { _id: 'rent', name: 'Rent', parent: 'home' },
      { _id: 'health', name: 'Health' },
      { _id: 'dental', name: 'Dental', parent: 'health' },
    ]
    // Health has both a direct total (260) and subcategory spend (dental, 140).
    const sum = [
      { _id: 'rent', total: 3600 },
      { _id: 'health', total: 260 },
      { _id: 'dental', total: 140 },
    ]
    vi.mocked(dashboardApi.getCategories).mockResolvedValue(cats)
    vi.mocked(dashboardApi.getSummary).mockResolvedValue(sum)
    vi.mocked(dashboardApi.getExpenses).mockResolvedValue([])
    renderWithProviders(<DashboardPage />, '/dashboard')

    const category = await screen.findByRole('region', { name: /by category/i })
    const healthRow = within(category).getByRole('button', { name: /health/i })
    // rolled-up total = 260 + 140 = 400 of a 4000 period total = 10%
    expect(within(healthRow).getByText('₪ 400.00')).toBeInTheDocument()
    expect(within(healthRow).getByText('10%')).toBeInTheDocument()

    await user.click(healthRow)
    expect(within(category).getByText('Dental')).toBeInTheDocument()
    expect(within(category).getByText('₪ 140.00')).toBeInTheDocument()
  })

  it('refetches with a different date range when the period changes', async () => {
    mockLoaded()
    renderWithProviders(<DashboardPage />, '/dashboard')
    await screen.findByText('Home')

    expect(dashboardApi.getSummary).toHaveBeenCalledWith('2026-09-01', '2026-09-15')

    await user.click(screen.getByRole('button', { name: /^today$/i }))

    await waitFor(() => expect(dashboardApi.getSummary).toHaveBeenCalledWith('2026-09-15', '2026-09-15'))
  })
})
