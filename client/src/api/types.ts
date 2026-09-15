export interface User {
  id: string
  username: string
  email: string
}

export interface AuthResponse {
  user: User
  accessToken: string
}

export interface LoginCredentials {
  username: string
  password: string
}

export interface RegisterDetails {
  username: string
  email: string
  password: string
}

/** What every failed request is turned into, whatever the server sent. */
export interface ApiError {
  message: string
  fieldErrors: Record<string, string>
}

// ---------------------------------------------------------------------------
// Chat (docs/specs/01-ai-chat.md §6, §8)
// ---------------------------------------------------------------------------

export type ChatIntent =
  | 'create-expense'
  | 'edit-expense'
  | 'delete-expense'
  | 'create-category'
  | 'edit-category'
  | 'delete-category'
  | 'reset-categories'
  | 'unknown'

/** A proposed new expense. `amount` is missing when the AI could not find one
 *  in the text — spec: never invent it, ask instead. */
export interface DraftExpense {
  amount?: number
  store?: string
  description?: string
  date?: string
  category?: string
}

export interface DraftCategory {
  name: string
  parent?: string | null
}

/** An existing expense the server found via `searchFilters`. `category` is
 *  whatever the server sent back for it (currently a raw id — see the report). */
export interface ExpenseMatch {
  _id: string
  amount: number
  store?: string
  description?: string
  date: string
  category?: string
}

export interface CategoryMatch {
  _id: string
  name: string
  parent?: string | null
}

/** Response to `POST /chat/messages`. Only the fields for the returned
 *  `intent` are actually present. */
export interface ChatMessageResult {
  reply: string
  intent: ChatIntent
  drafts?: DraftExpense[]
  draft?: DraftCategory
  matches?: ExpenseMatch[] | CategoryMatch[]
  /** New field values for edit-expense/edit-category (spec §6, §8). */
  changes?: Record<string, unknown>
}

/** One saved message, as `GET /chat/messages` returns it (spec §5). */
export interface ChatHistoryMessage {
  _id: string
  text: string
  role: 'user' | 'assistant'
  author: string
  createdAt: string
  updatedAt: string
}

/** Body for `POST /chat/confirm` — shape depends on the intent. */
export type ChatConfirmRequest =
  | { intent: 'create-expense'; drafts: DraftExpense[] }
  | { intent: 'create-category'; draft: DraftCategory }
  | { intent: 'edit-expense' | 'edit-category'; id: string; changes: Record<string, unknown> }
  | { intent: 'delete-expense' | 'delete-category'; id: string }
  | { intent: 'reset-categories' }

export interface ChatConfirmResult {
  changed: unknown
}

// ---------------------------------------------------------------------------
// Dashboard (docs/specs/02-dashboard.md) — read-only.
// ---------------------------------------------------------------------------

/** `GET /categories` — a main category has no `parent`; a subcategory's
 *  `parent` is its main category's id. */
export interface DashboardCategory {
  _id: string
  name: string
  parent?: string | null
}

/** One entry of `GET /expenses/summary`: a Mongo `$group`/`$sum` per
 *  category id, main or sub. */
export interface CategoryTotal {
  _id: string
  total: number
}

/** One entry of `GET /expenses?from=&to=` — the recent-expenses list. */
export interface DashboardExpense {
  _id: string
  amount: number
  store?: string
  description?: string
  date: string
  category: string
}
