// Shared with DashboardPage and its extracted presentational pieces
// (DashboardTotals, CategoryBreakdown) — and with the "How to use" tutorial,
// which reuses those same pieces with scripted data instead of live data.
export const money = (amount: number) =>
  '₪ ' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
