// Extracted from DashboardPage so the "How to use" tutorial (lesson 4, "See
// where it went") can show the real totals markup driven by scripted numbers
// instead of a second, hand-drawn copy of it.
import { money } from '../lib/dashboardFormat'

interface DashboardTotalsProps {
  total: number
  expensesCount: number
  categoriesUsedCount: number
}

export const DashboardTotals = ({ total, expensesCount, categoriesUsedCount }: DashboardTotalsProps) => (
  <div className="dashboard-totals">
    <div className="dashboard-totals__main">
      <span className="dashboard-eyebrow">Total spent</span>
      <span className="dashboard-fig dashboard-totals__figure">{money(total)}</span>
    </div>
    <div className="dashboard-stats">
      <div className="dashboard-stat">
        <span className="dashboard-eyebrow">Expenses</span>
        <span className="dashboard-fig dashboard-stat__figure">{expensesCount}</span>
      </div>
      <div className="dashboard-stat">
        <span className="dashboard-eyebrow">Categories used</span>
        <span className="dashboard-fig dashboard-stat__figure">{categoriesUsedCount}</span>
      </div>
    </div>
  </div>
)
