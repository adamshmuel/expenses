// The dashboard — spec docs/specs/02-dashboard.md. Read-only: every number
// here comes from GET /expenses/summary rolled up against GET /categories
// (design: docs/designs/Expenses Redesign.dc.html, "Dashboard" artboard).
// Nothing on this page ever writes — all changes happen in the chat on /home.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCategories, getExpenses, getSummary } from '../api/dashboardApi'
import type { CategoryTotal, DashboardCategory, DashboardExpense } from '../api/types'
import { money } from '../lib/dashboardFormat'
import { DashboardTotals } from './DashboardTotals'
import { CategoryBreakdown } from './CategoryBreakdown'

type Period = 'today' | 'week' | 'month' | 'pick' | 'custom'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'pick', label: 'Pick a month' },
  { key: 'custom', label: 'Custom' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getDate())} ${d.toLocaleDateString('en-GB', { month: 'short' })}`
}
const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const monthLabel = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

const startOfWeek = (d: Date) => {
  const s = new Date(d)
  s.setDate(s.getDate() - s.getDay())
  return s
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)

/** Every period option feeds the same from/to range into GET
 *  /expenses/summary — purely a client-side choice (spec §"What it shows"). */
const computeRange = (period: Period, pickMonth: string, customFrom: string, customTo: string) => {
  const today = new Date()
  switch (period) {
    case 'today':
      return { from: toISODate(today), to: toISODate(today) }
    case 'week':
      return { from: toISODate(startOfWeek(today)), to: toISODate(today) }
    case 'pick': {
      const [y, m] = pickMonth.split('-').map(Number)
      const d = new Date(y, m - 1, 1)
      return { from: toISODate(startOfMonth(d)), to: toISODate(endOfMonth(d)) }
    }
    case 'custom':
      return { from: customFrom, to: customTo }
    case 'month':
    default:
      return { from: toISODate(startOfMonth(today)), to: toISODate(today) }
  }
}

const describePeriod = (period: Period, from: string, to: string, pickMonth: string) => {
  const fromDate = new Date(from)
  const toDate = new Date(to)
  switch (period) {
    case 'today':
      return { title: 'Today', range: longDate(toDate) }
    case 'week':
      return { title: 'This week', range: `${longDate(fromDate)} – ${longDate(toDate)}` }
    case 'pick': {
      const [y, m] = pickMonth.split('-').map(Number)
      return { title: monthLabel(new Date(y, m - 1, 1)), range: `${longDate(fromDate)} – ${longDate(toDate)}` }
    }
    case 'custom':
      return { title: 'Custom range', range: `${longDate(fromDate)} – ${longDate(toDate)}` }
    case 'month':
    default:
      return { title: 'This month', range: `${longDate(fromDate)} – ${longDate(toDate)}` }
  }
}

interface CategoryNode {
  id: string
  name: string
  amount: number
  subs: { id: string; name: string; amount: number }[]
}

/** The client-side join the design calls for: GET /categories gives the tree
 *  shape, GET /expenses/summary gives each leaf's total. A main category's
 *  own amount is its direct total plus its subcategories'. */
const buildGroups = (categories: DashboardCategory[], summary: CategoryTotal[]): CategoryNode[] => {
  const totals = new Map(summary.map((s) => [s._id, s.total]))
  const mains = categories.filter((c) => !c.parent)

  const groups = mains.map((main) => {
    const subs = categories
      .filter((c) => c.parent === main._id)
      .map((sub) => ({ id: sub._id, name: sub.name, amount: totals.get(sub._id) ?? 0 }))
      .filter((sub) => sub.amount > 0)
    const direct = totals.get(main._id) ?? 0
    const amount = direct + subs.reduce((sum, s) => sum + s.amount, 0)
    return { id: main._id, name: main.name, amount, subs }
  })

  return groups.filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount)
}

type Status = 'loading' | 'error' | 'ready'

export const DashboardPage = () => {
  const [period, setPeriod] = useState<Period>('month')
  const [pickMonth, setPickMonth] = useState(() => toISODate(new Date()).slice(0, 7))
  const [customFrom, setCustomFrom] = useState(() => toISODate(startOfMonth(new Date())))
  const [customTo, setCustomTo] = useState(() => toISODate(new Date()))
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const [status, setStatus] = useState<Status>('loading')
  const [categories, setCategories] = useState<DashboardCategory[]>([])
  const [summary, setSummary] = useState<CategoryTotal[]>([])
  const [expenses, setExpenses] = useState<DashboardExpense[]>([])
  const [reloadToken, setReloadToken] = useState(0)

  const { from, to } = useMemo(() => computeRange(period, pickMonth, customFrom, customTo), [
    period,
    pickMonth,
    customFrom,
    customTo,
  ])

  useEffect(() => {
    let cancelled = false
    Promise.all([getCategories(), getSummary(from, to), getExpenses(from, to)])
      .then(([categoriesResult, summaryResult, expensesResult]) => {
        if (cancelled) return
        setCategories(categoriesResult)
        setSummary(summaryResult)
        setExpenses(expensesResult)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [from, to, reloadToken])

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c._id, c])), [categories])
  const groups = useMemo(() => buildGroups(categories, summary), [categories, summary])
  const total = useMemo(() => groups.reduce((sum, g) => sum + g.amount, 0), [groups])
  const recent = useMemo(
    () => [...expenses].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10),
    [expenses],
  )
  const { title, range } = describePeriod(period, from, to, pickMonth)
  const isEmpty = status === 'ready' && total === 0

  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))

  // Every one of these changes the from/to range (or forces a retry) — flip
  // to loading right from the event that caused it, rather than inside the
  // fetch effect.
  const changePeriod = (next: Period) => {
    setStatus('loading')
    setPeriod(next)
  }
  const changePickMonth = (value: string) => {
    setStatus('loading')
    setPickMonth(value)
  }
  const changeCustomFrom = (value: string) => {
    setStatus('loading')
    setCustomFrom(value)
  }
  const changeCustomTo = (value: string) => {
    setStatus('loading')
    setCustomTo(value)
  }
  const retry = () => {
    setStatus('loading')
    setReloadToken((n) => n + 1)
  }

  return (
    <main className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <div className="dashboard-eyebrow">Statement</div>
          <h1 className="dashboard-title">{title}</h1>
          <p className="dashboard-subtitle">{range} · read-only. Every change is made in the chat.</p>
        </div>
        <div className="dashboard-period">
          <div className="dashboard-period__tabs" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="dashboard-period__tab"
                aria-pressed={period === p.key}
                onClick={() => changePeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === 'pick' && (
            <div className="dashboard-period__range">
              <label htmlFor="dashboard-pick-month">Month</label>
              <input
                id="dashboard-pick-month"
                className="input"
                type="month"
                value={pickMonth}
                onChange={(e) => changePickMonth(e.target.value)}
              />
            </div>
          )}
          {period === 'custom' && (
            <div className="dashboard-period__range">
              <label htmlFor="dashboard-custom-from">From</label>
              <input
                id="dashboard-custom-from"
                className="input"
                type="date"
                value={customFrom}
                onChange={(e) => changeCustomFrom(e.target.value)}
              />
              <span>to</span>
              <label htmlFor="dashboard-custom-to" className="dashboard-sr-only">
                To
              </label>
              <input
                id="dashboard-custom-to"
                className="input"
                type="date"
                value={customTo}
                onChange={(e) => changeCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {status === 'loading' && (
        <div className="dashboard-panel" role="status">
          <span className="dashboard-panel__eyebrow">Loading</span>
          <div className="dashboard-panel__bars" aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
          <p className="dashboard-panel__text">Totting up…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="dashboard-panel" role="alert">
          <span className="dashboard-panel__eyebrow dashboard-panel__eyebrow--error">Failed</span>
          <p className="dashboard-panel__headline">The statement could not be fetched.</p>
          <p className="dashboard-panel__text">The server did not answer. Nothing has been lost.</p>
          <button type="button" className="dashboard-btn dashboard-btn--primary" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="dashboard-panel">
          <span className="dashboard-panel__eyebrow">Empty</span>
          <p className="dashboard-panel__headline">Nothing filed in this period.</p>
          <p className="dashboard-panel__text">Record your first expense in the chat and it will appear here.</p>
          <Link to="/home" className="dashboard-btn dashboard-btn--primary">
            Go to the chat
          </Link>
        </div>
      )}

      {status === 'ready' && !isEmpty && (
        <>
          <DashboardTotals total={total} expensesCount={expenses.length} categoriesUsedCount={summary.length} />

          <div className="dashboard-body">
            <section className="dashboard-section" aria-label="By category">
              <div className="dashboard-section__head">
                <h2>By category</h2>
                <span className="dashboard-hint">Tap a category for its subcategories</span>
              </div>
              <CategoryBreakdown groups={groups} total={total} openGroups={openGroups} onToggle={toggleGroup} />
            </section>

            <section className="dashboard-section" aria-label="Recent expenses">
              <div className="dashboard-section__head">
                <h2>Recent expenses</h2>
                <span className="dashboard-hint">Newest first</span>
              </div>
              <div className="dashboard-table-scroll">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th className="dashboard-table__date">Date</th>
                    {/* Bug 5: this column shows store OR description — never
                        both — so it is headed "Details", not "Store", which
                        was only ever true for half the rows. */}
                    <th>Details</th>
                    <th>Category</th>
                    <th className="dashboard-table__amount">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((e) => (
                    <tr key={e._id}>
                      <td className="dashboard-fig dashboard-table__date">{shortDate(e.date)}</td>
                      <td>{e.store ?? e.description ?? 'Expense'}</td>
                      <td className="dashboard-table__category">{categoriesById.get(e.category)?.name ?? 'Other'}</td>
                      <td className="dashboard-fig dashboard-table__amount">{money(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p className="dashboard-note">
                To change or remove any of these, say so in the <Link to="/home">chat</Link>. The dashboard never
                writes.
              </p>
            </section>
          </div>
        </>
      )}
    </main>
  )
}
