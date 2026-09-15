import { httpClient, toApiError } from './httpClient'
import type { CategoryTotal, DashboardCategory, DashboardExpense } from './types'

/** `GET /categories` — this user's full category list (spec §5). */
export const getCategories = async (): Promise<DashboardCategory[]> => {
  try {
    const { data } = await httpClient.get<DashboardCategory[]>('/categories')
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

/** `GET /expenses/summary?from=&to=` — total per category for the period,
 *  computed by the database (spec §5, aggregation). */
export const getSummary = async (from: string, to: string): Promise<CategoryTotal[]> => {
  try {
    const { data } = await httpClient.get<CategoryTotal[]>('/expenses/summary', { params: { from, to } })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}

/** `GET /expenses?from=&to=` — this period's expenses, for the recent list. */
export const getExpenses = async (from: string, to: string): Promise<DashboardExpense[]> => {
  try {
    const { data } = await httpClient.get<DashboardExpense[]>('/expenses', { params: { from, to } })
    return data
  } catch (error) {
    throw toApiError(error)
  }
}
