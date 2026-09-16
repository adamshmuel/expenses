# Client additions since the last QA pass — reference

Not a spec. Everything added to `client/src/` since the last QA run derived
`2026-09-11-client-testable.md` against commit `e48ce5b`. That file is **not
edited** here — per `.claude/rules/testing-reference.md`, every update from
Claude goes into a new dated file, never an edit to an existing one.

Two batches, different commit states — see each section's own note.

**Design reference exists — check against it, not just the spec.**
`docs/designs/Expenses Redesign.dc.html` is a design-canvas mockup (untracked,
added alongside the uncommitted dashboard work) covering at least the
Dashboard artboard; `docs/designs/Current UI.dc.html` is the prior state for
comparison. Neither `docs/specs/02-dashboard.md` nor `docs/specs/01-ai-chat.md`
fully specifies visual layout — the design file is the source of truth for
that. When testing/reviewing `DashboardPage.tsx` (Part B below) and
`HomePage.tsx` (Part A above), check markup and behavior against the mockup's
intent (structure, states shown, copy), not only against functional spec
text. This is a visual/structural conformance check, not something asserted
by a DOM test — open the `.dc.html` file (or its rendered artifact, if
published) and compare by eye.

## Part A — Chat UI (committed)

### Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `client/src/api/chatApi.ts`, `client/src/store/chatSlice.ts`, `client/src/components/HomePage.tsx` (was a placeholder, now the real chat screen), `client/src/store/store.ts` (chat reducer wired in) | commit `60c12e2` | Committed, safe to test as-is. |

### `api/chatApi.ts`

| Export | Does | Existing coverage |
|---|---|---|
| `sendMessage(text)` | `POST /chat/messages` | `chatApi.test.ts`: posts the typed text |
| `getHistory(limit=50)` | `GET /chat/messages?limit=` | `chatApi.test.ts`: default limit 50 |
| `confirmChat(payload)` | `POST /chat/confirm` | `chatApi.test.ts`: create-expense and edit-with-id-and-changes payload shapes; failed-request → `ApiError` |

Already has solid direct coverage (4 tests). Gap worth a look: **only 2 of
the 7 confirm-request shapes are exercised** (`create-expense`,
`edit-expense`) — `create-category`, `delete-expense`, `edit-category`,
`delete-category`, `reset-categories` request shapes are untested at this
layer (though covered indirectly through `chatSlice.test.ts`'s
`toConfirmRequest` exercising, and `HomePage.test.tsx`'s end-to-end paths).
Low priority since the shape is a trivial passthrough.

Governed by: `docs/specs/03-api-contract.md` §3 (if a chat section exists there — cross-check), `docs/specs/01-ai-chat.md` §6, §9.

### `store/chatSlice.ts`

| Piece | Does | Existing coverage |
|---|---|---|
| `buildPending(result)` *(private)* | turns a `/chat/messages` result into a `PendingAction` or `null` per intent — the core branching logic of the whole chat flow | exercised indirectly through `sendChatMessage.fulfilled` tests: create-expense with/without amount, edit/delete with 0/1/many matches, reset-categories. **Not exercised directly**: `create-category` when `result.draft` is present vs. absent (`chatSlice.test.ts` has no row for this intent at all) |
| `toConfirmRequest(pending)` *(private)* | inverse of the above, for the confirm POST | exercised indirectly: create-expense, edit-expense (with id+changes), reset-categories, cancel. **Not exercised**: `create-category`, `delete-expense`, `delete-category`, `edit-category` confirm-request construction |
| `loadChatHistory` (thunk) | maps history to `{id, role, text}` | `chatSlice.test.ts`: loads oldest-first; empty history |
| `sendChatMessage` (thunk) | appends user+assistant bubbles, sets `pending` via `buildPending` | `chatSlice.test.ts`: plain reply, create-expense (present/missing amount), edit-expense (0/1/many matches), reset-categories, network failure |
| `confirmChatAction` (thunk) | reads `pending` from state, posts, clears `pending`, pushes a "Done." bubble | `chatSlice.test.ts`: create-expense confirm, edit-expense confirm, cancel (no request sent) |
| `selectMatch`/`cancelPending`/`clearChatError` (reducers) | pick a match id; clear pending; clear error | `selectMatch` exercised via the auto-select tests; `cancelPending` has a dedicated test; `clearChatError` has none |

**Real gaps, worth closing:**
- `create-category` intent — neither `buildPending` nor `toConfirmRequest` has
  a direct test. It's the only intent besides `reset-categories` with no
  match-list branching, so it's cheap to add.
- `delete-expense`/`delete-category`/`edit-category` confirm-request shapes —
  same pattern as `edit-expense`, likely low-risk, but untested.
- `clearChatError` reducer alone.

Governed by: `docs/specs/01-ai-chat.md` §6, §7.

### `components/HomePage.tsx`

Real chat screen now (was a placeholder in the 09-11 inventory).

| Piece | Does | Existing coverage |
|---|---|---|
| History load on mount | `useEffect` dispatches `loadChatHistory` once | `HomePage.test.tsx`: loads and shows history on entering |
| Message thread + empty state | renders bubbles, or a hint when `messages.length === 0` | covered |
| Send form | text input, submit dispatches `sendChatMessage`, clears input on success, **keeps typed text on failure** | covered (error path explicitly asserted) |
| `renderPending` | one render branch per intent (7), including the "still choosing a match" sub-branch for edit/delete expense/category | covered for: create-expense (multi-draft), edit-expense (no-match message via 0 matches, auto-confirm on 1 match, pick-then-confirm on many), reset-categories, cancel. **Not covered directly in HomePage tests**: `create-category` render, `edit-category`/`delete-category` render (though `describeChanges`/category-match rendering shares code with the expense path, so risk is lower) |
| `isReadyToConfirm` | hides the Confirm button while a multi-match pick is still open | covered indirectly through the "asks the user to pick" test |
| Error banner | shows `error` from state, doesn't clear on its own | covered (the unreachable-server test) |

Gap: **`create-category` and `edit-category`/`delete-category` render paths
have no dedicated HomePage test**, even though `chatSlice` supports them.
Same risk level as the chatSlice gap above — likely the same underlying
cause (category intents were probably deprioritized together).

Governed by: `docs/specs/01-ai-chat.md` §6, §7.

---

## Part B — Dashboard (UNCOMMITTED — in progress)

**Caution:** `client/src/components/DashboardPage.tsx`, `client/src/api/dashboardApi.ts`,
and the `types.ts`/`index.css` dashboard additions are sitting in the working
tree, not committed. `docs/specs/02-dashboard.md` was also just edited. This
material may still change before Adam commits it — treat automation written
against it now as provisional, and re-check against the spec's current text
(not a cached read) before relying on it.

### Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `client/src/api/dashboardApi.ts` (new), `client/src/components/DashboardPage.tsx` (was a placeholder, now real), `client/src/api/types.ts` dashboard section | commit `2d0d99e` | Now committed ("Build the dashboard: category breakdown, period selector, and recent expenses"). Rows below re-checked against this commit; no behaviour change from the working-tree version this file originally derived against. |

### `api/dashboardApi.ts` — new

| Export | Does | Existing coverage |
|---|---|---|
| `getCategories()` | `GET /categories` | `dashboardApi.test.ts`: request path |
| `getSummary(from, to)` | `GET /expenses/summary?from=&to=` | `dashboardApi.test.ts`: request path + params |
| `getExpenses(from, to)` | `GET /expenses?from=&to=` | `dashboardApi.test.ts`: request path + params |

All three plus the failed-request → `ApiError` case are covered (4 tests). No
gap here — thin wrappers, fully exercised.

Governed by: `docs/specs/02-dashboard.md` §5 (or wherever the API calls are specified — re-check current section numbering since the spec was just edited).

### `components/DashboardPage.tsx` — real screen now

Read-only page: joins `GET /categories` (tree shape) with `GET /expenses/summary`
(leaf totals) client-side, plus `GET /expenses` for the recent list. Never
writes — all changes happen in chat.

| Piece | Does | Existing coverage |
|---|---|---|
| `computeRange(period, ...)` | pure function, 5 period modes → `{from, to}` ISO dates: today, week, month, pick-a-month, custom | not unit-tested directly — only observed through `DashboardPage.test.tsx`'s "refetches with a different date range" test, which exercises one transition. **Gap**: the 5 branches (especially `pick` and `custom`, which parse a `YYYY-MM` string and free-form date inputs) are cheap to unit-test in isolation and are the kind of date-math code that silently drifts |
| `buildGroups(categories, summary)` | pure function: joins category tree + totals, computes each main's amount as direct + subs' sum, **filters out zero-amount groups/subs**, sorts descending | `DashboardPage.test.tsx` covers the roll-up (main + subcategory spend) and % share row. **Not directly unit-tested**: the zero-filtering behavior itself (a category with 0 spend should not appear at all — implied by "shows an empty state when nothing was spent" but not isolated as a `buildGroups` unit test), and the descending sort order across 3+ categories |
| Data loading (`useEffect` on `[from, to, reloadToken]`) | `Promise.all` of all three GETs; a stale-closure guard (`cancelled`) so a superseded fetch doesn't clobber state | loading/error/ready states covered. **Gap**: the `cancelled` guard itself — i.e., rapidly changing the period twice in succession should not let the first (now-stale) response overwrite the second's data. Race-condition-shaped, easy to regress, not obviously covered by the existing "refetches" test (which doesn't assert ordering) |
| Period tabs + pick-month/custom-range inputs | switches `period`, shows conditional date inputs for `pick`/`custom` | month/week/today implicitly covered via the refetch test; **`pick` and `custom` input rendering and their effect on the fetched range have no dedicated test** |
| Category rows: expand/collapse | toggles `openGroups[id]`, caret only shown when a group has subs | covered |
| Stat tiles (Total spent, Expenses count, Categories used) | computed client-side from `groups`/`expenses`/`summary` lengths, not separate endpoints | covered (explicit test + explicit "no largest-single-expense tile" negative test) |
| Recent-expenses table | sorts `expenses` client-side by date descending, slices to 10, resolves `category` id → name via `categoriesById` (falls back to `'Other'` if not found) | covered for the happy path. **Gap**: the `?? 'Other'` fallback when a category id has no match in `categoriesById` (e.g. a deleted category still referenced by an old expense) — no test forces that fallback path |
| Error/retry | `status === 'error'` panel with a "Try again" button that bumps `reloadToken` to force a re-fetch | covered |
| Empty state | `status === 'ready' && total === 0`, with a link back to `/home` | covered |

**Real gaps, worth closing before/alongside writing full automation:**
1. `computeRange`'s `pick` and `custom` branches, isolated.
2. `buildGroups`'s zero-filtering and sort order, isolated.
3. The stale-fetch race guard (`cancelled`) under rapid period changes.
4. The recent-expenses table's `'Other'` fallback for an orphaned category id.

Governed by: `docs/specs/02-dashboard.md` — re-read in full before writing
specs; it was edited in this same uncommitted batch (+45 lines) so its
current text may cover some of the above explicitly (e.g. the fallback
behavior) in a way a cached reading would miss.

### `api/types.ts` — dashboard section (new)

`DashboardCategory`, `CategoryTotal`, `DashboardExpense` — plain response
shapes, type-checked at compile time only. No runtime test needed directly;
same reasoning as the existing note on `ChatMessageResult` et al. in the
09-11 client file.

---

## Not covered here (deliberately)

- **`backend/ai/`** — own file, `2026-09-15-ai-testable.md`.
- **Server additions** (chat/expense/category routes, services, models) —
  see `2026-09-15-server-additions-testable.md`.
- **The flagship end-to-end journey** (type an expense in chat → confirm →
  see it on the dashboard) — both halves now exist (chat committed,
  dashboard uncommitted). Worth flagging as newly *possible* to automate,
  same as the 09-11 client file's E2E-candidates table anticipated, but not
  writing that row here since the dashboard side isn't committed yet — wait
  for it to land, or confirm with Adam that uncommitted code is fair game
  for E2E before investing in it.

---

## Maintenance

Not re-derived automatically. Claude writes this folder directly (see
`.claude/rules/testing-reference.md`) and does not invoke `qa` to update it.
When the dashboard work is committed, or more client material ships, add
another new dated file — don't edit this one or the 09-11 file.
