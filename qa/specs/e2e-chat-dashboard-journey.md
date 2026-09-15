# Test spec — chat → dashboard journeys (E2E, browser)

**Under test:** the flagship journey named in `docs/reference/testing-reference/2026-09-11-client-testable.md`'s E2E-candidates table and confirmed newly-possible (both halves now exist, chat committed / dashboard uncommitted) by `2026-09-15-client-additions-testable.md`. Real Chromium (headed, so it can be watched — see `qa/e2e/playwright.config.ts`), real Vite client, real server, same `expenses_qa_test` isolation as the rest of `qa/`.
**Governing spec:** `docs/specs/01-ai-chat.md` §6-§7 (chat); `docs/specs/02-dashboard.md` (dashboard, re-read in full for this pass since it was just edited).
**Design reference:** `docs/designs/Expenses Redesign.dc.html` (Dashboard + chat artboards) — checked by eye alongside the functional assertions below; see the run report's design-conformance note.
**Automation:** `qa/e2e/tests/chat-dashboard-journey.spec.ts`.

Two tests, split by cost/determinism:

- **FJ-01** drives the real chat UI with a real, minimal (one-call) Gemini request — the only place in this whole QA pass that calls the real AI, deliberately kept to one call. Proves the actual user-facing loop: type free text → see an AI-drafted expense → confirm → it is really saved. Assertions are loose on the AI's own wording (non-deterministic) and strict on the structural/behavioural parts (a draft appears, confirming saves a real expense).
- **DJ-01** seeds its expenses via a direct `POST /chat/confirm` call (same as `qa/specs/api-chat-confirm.md`'s CC-02, no AI, fully deterministic) and only drives the browser for the dashboard side, so the dashboard's own correctness is tested without also depending on AI non-determinism.

---

### FJ-01 — type an expense in chat, confirm, it is really saved
- **Method:** sign up a fresh user through the UI (lands on `/home`). Type `"I spent 42.5 at the supermarket today"` into the chat input and send. Wait for a pending confirmation card to appear. Click **Confirm**.
- **Expected:** a draft/confirmation card appears after sending (proves request one — parse — completed and returned a `create-expense` intent, not `unknown`, for this unambiguous message). After confirming, the pending card disappears and a `GET /expenses` call (made directly from the test, with the same session's credentials) shows at least one expense with `amount === 42.5`. The typed text and the AI's reply both appear in the message thread.

### DJ-01 — expenses recorded via chat are reflected on the dashboard
- **Method:** sign up a user via the API. Create two expenses via `POST /chat/confirm` `create-expense` (no AI): one on "Food" (30), one on "Transport" (20) — both dated today (the default when a draft carries no explicit date), so they fall inside the dashboard's default "This month" period. Log in through the UI (establishes a real browser session/cookie). Navigate to `/dashboard`.
- **Expected, per spec 02:** the empty state is **not** shown; "Total spent" reads **₪ 50.00**; the "Expenses" stat tile reads **2**; the "By category" section lists "Food" and "Transport" with their respective amounts; the recent-expenses table lists both. **Known finding** (see `qa/specs/api-expenses-categories.md` ER-08/09 and the run report): `GET /expenses/summary` currently always returns `[]` because of a string-vs-ObjectId bug in `expenseRepository.getExpenseTotalByCategory`, which makes `DashboardPage.tsx`'s `total` always `0` and therefore **always renders the empty state**, regardless of real data. This test asserts the spec's correct behaviour and is expected to **fail** until that bug is fixed — the failure is the point: it is the clearest possible demonstration that the bug is not just a data-shape detail but breaks the whole Dashboard screen for every real user.
