import { describe, expect, it, vi, beforeEach } from 'vitest'
import { httpClient } from './httpClient'
import { getCategories, getExpenses, getSummary } from './dashboardApi'

describe('dashboardApi request paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the category list from /categories', async () => {
    const categories = [{ _id: 'c1', name: 'Food' }]
    vi.spyOn(httpClient, 'get').mockResolvedValue({ data: categories })
    const result = await getCategories()
    expect(httpClient.get).toHaveBeenCalledWith('/categories')
    expect(result).toEqual(categories)
  })

  it('loads the category breakdown from /expenses/summary with the date range', async () => {
    const summary = [{ _id: 'c1', total: 96 }]
    vi.spyOn(httpClient, 'get').mockResolvedValue({ data: summary })
    const result = await getSummary('2026-09-01', '2026-09-15')
    expect(httpClient.get).toHaveBeenCalledWith('/expenses/summary', {
      params: { from: '2026-09-01', to: '2026-09-15' },
    })
    expect(result).toEqual(summary)
  })

  it('loads the recent-expenses list from /expenses with the date range', async () => {
    const expenses = [{ _id: 'e1', amount: 96, date: '2026-09-15', category: 'c1' }]
    vi.spyOn(httpClient, 'get').mockResolvedValue({ data: expenses })
    const result = await getExpenses('2026-09-01', '2026-09-15')
    expect(httpClient.get).toHaveBeenCalledWith('/expenses', {
      params: { from: '2026-09-01', to: '2026-09-15' },
    })
    expect(result).toEqual(expenses)
  })

  it('turns a failed request into an ApiError', async () => {
    vi.spyOn(httpClient, 'get').mockRejectedValue({ isAxiosError: false })
    await expect(getCategories()).rejects.toEqual({
      message: 'Something went wrong.',
      fieldErrors: {},
    })
  })
})
