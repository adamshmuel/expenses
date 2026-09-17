// Extracted from DashboardPage so the "How to use" tutorial (lesson 3,
// "Organise your categories", and lesson 4, "See where it went") can show the
// real category-row markup driven by scripted data instead of a second,
// hand-drawn copy of it.
import { money } from '../lib/dashboardFormat'

export interface CategorySub {
  id: string
  name: string
  amount: number
}

export interface CategoryGroup {
  id: string
  name: string
  amount: number
  subs: CategorySub[]
}

interface CategoryBreakdownProps {
  groups: CategoryGroup[]
  total: number
  openGroups: Record<string, boolean>
  onToggle: (id: string) => void
}

export const CategoryBreakdown = ({ groups, total, openGroups, onToggle }: CategoryBreakdownProps) => (
  <div className="dashboard-categories">
    {groups.map((g) => {
      const hasSubs = g.subs.length > 0
      const isOpen = hasSubs && !!openGroups[g.id]
      const share = total > 0 ? Math.round((g.amount / total) * 100) : 0
      return (
        <div key={g.id}>
          <button
            type="button"
            className="dashboard-category-row"
            aria-expanded={hasSubs ? isOpen : undefined}
            onClick={() => hasSubs && onToggle(g.id)}
          >
            <span className="dashboard-caret" aria-hidden="true">
              {hasSubs ? (isOpen ? '▾' : '▸') : ''}
            </span>
            <span className="dashboard-category-row__name">{g.name}</span>
            <span className="dashboard-leader" />
            <span className="dashboard-fig dashboard-category-row__share">{share}%</span>
            <span className="dashboard-fig dashboard-category-row__amount">{money(g.amount)}</span>
          </button>
          {isOpen && (
            <div className="dashboard-subcategories">
              {g.subs.map((s) => (
                <div key={s.id} className="dashboard-sub-row">
                  <span>{s.name}</span>
                  <span className="dashboard-leader dashboard-leader--sub" />
                  <span className="dashboard-fig">{money(s.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    })}
    <div className="dashboard-total-row">
      <span className="dashboard-eyebrow">Total</span>
      <span className="dashboard-leader" />
      <span className="dashboard-fig dashboard-total-row__figure">{money(total)}</span>
    </div>
  </div>
)
