# Client testable surface — reference

Not a spec. A living inventory of **what exists in `client/` right now and can
be tested**, so the `qa` agent has a starting map instead of guessing. This file
covers the client only — see
[`docs/reference/testing-reference/`](../testing-reference) for the server
counterpart and any other area added later.

Created 2026-09-11. The `qa` agent reads every file in
`docs/reference/testing-reference/` **on every run, in full** — that is cheap,
it's an inventory, not source code. Whether it also **re-derives** this file
(re-opening the actual `client/` source and re-checking every row) is gated by
the Derivation state below, so an unrelated change elsewhere doesn't cost a
full re-scan of the client.

## Derivation state

| Covers | Last derived against | Notes |
|---|---|---|
| `client/src/` (all of it — `components/`, `store/`, `api/`, `App.tsx`) | commit `e48ce5b` | Full first derivation, 2026-09-11. |

Before re-deriving, diff this commit against the current tree for the covered
paths (`git diff --stat e48ce5b -- client/src`). No changes → this file is
still current: read it, don't re-derive it. Changes → re-derive the affected
rows and bump the commit.

## How to read this

- Each row names something concrete that exists: a component, a store slice, an
  API module, a route.
- The **"invites"** column is a prompt for the QA agent's judgement about the
  cheapest test level and the properties worth asserting — **not** a
  prescription.
- "Governed by" points at the spec section that fixes the intended behaviour.
- **"Existing coverage"** says what already has a Vitest test in `client/src/`
  — the `qa` agent does not duplicate that, only notes gaps and, where useful,
  covers the same code from the *server-integrated* angle (a real backend
  instead of a mock) as an API or E2E test.

Claude writes and tests this code (`.claude/rules/ownership.md`); TDD applies
(`.claude/rules/tdd.md`). Tests query by role/label/visible text, never CSS
class or test id (`.claude/agents/builder.md`).

---

## Routes (`client/src/App.tsx`)

React Router, one `<Routes>` tree. `restoreSession()` runs once on mount (asks
the server if the refresh cookie is still valid) before routing decisions
matter.

| Route | Guard | Renders | Governed by |
|---|---|---|---|
| `/` | — | redirects to `/home` | `01-ai-chat.md` §1 |
| `/login` | `PublicOnlyRoute` — logged-in users are redirected away | `LoginPage` | `01` §1, §4 |
| `/signup` | `PublicOnlyRoute` | `SignupPage` | `01` §1, §3 |
| `/home` | `ProtectedRoute` — logged-out users are redirected to `/login` | `HomePage` (**placeholder** — chat not built) | `01` §1, §6 |
| `/dashboard` | `ProtectedRoute` | `DashboardPage` (**placeholder** — not built) | `02` (draft) |
| `*` | — | `PageNotFound` | — |

Invites: route-guard behaviour (logged-out → `/home` bounces to `/login` and
back; logged-in → `/login` bounces to `/home`) and the on-mount
`restoreSession` call are the two properties worth testing at this layer, and
both already are (see ProtectedRoute below).

---

## Components (`client/src/components/`)

| Component | Does | Existing coverage | Invites | Governed by |
|---|---|---|---|---|
| `LoginPage.tsx` | username + password form, submits `login` thunk, shows field/general errors | `LoginPage.test.tsx` | gap check only — confirm it still covers: empty-field validation, wrong-credential message, redirect on success | `01` §4 |
| `SignupPage.tsx` | username + email + password + confirm form, client-side "passwords match" check, submits `register` thunk | `SignupPage.test.tsx` | gap check: mismatched-password case caught before a request is sent (per `01` §7 "Auth" table); server-side field errors rendered under the right input | `01` §3, §7 |
| `NavBar.tsx` | shows app name + Login/Signup when logged out; Home/Dashboard links + username + Logout when logged in; logout dispatches the thunk and navigates to `/login` | `NavBar.test.tsx` | gap check: both visual states; logout clears the session and redirects | `01` §5 |
| `ProtectedRoute.tsx` (exports `ProtectedRoute` **and** `PublicOnlyRoute`) | redirect logic described in the Routes table above | `ProtectedRoute.test.tsx` | gap check: both directions, and the "still checking session" transient state (see `authSlice.status === 'checking'`) don't flash the wrong screen | `01` §1 |
| `FormField.tsx` | shared input + label + error-message wrapper used by Login/Signup | none dedicated — exercised indirectly via the two forms above | a unit render test (label associates with input, error text shows/hides) would close a real gap | — |
| `HomePage.tsx` | **placeholder only** — static text, proves the route + gate work | none needed yet | nothing to test beyond "the route renders" (covered by ProtectedRoute tests) until chat (`01` §6) is built | `01` §6 (not yet implemented) |
| `DashboardPage.tsx` | **placeholder only** | none needed yet | same as HomePage | `02` (not yet implemented) |
| `LedgerSlip.tsx` | presentational only, not wired into a route yet (grep confirms no importer as of this scan) | none | dead code or gets a test once it's mounted — recheck each run | — |
| `PageNotFound.tsx` | static 404 page | none | trivial; low priority | — |
| `icons.tsx` | SVG icon components (e.g. `Mark` used in NavBar) | none dedicated | presentational only, not worth a unit test on its own | — |

---

## API layer (`client/src/api/`)

| Module | Does | Existing coverage | Invites | Governed by |
|---|---|---|---|---|
| `authApi.ts` | thin wrappers: `login`, `register`, `refresh`, `logout` — each posts to the matching `/users/*` path | `authApi.test.ts` | already solid (path + body per call); a **real-server** variant (hitting the actual running backend instead of a mocked `httpClient`) belongs in the server/API test suite, not duplicated here — it's the same contract from the other side | `03-api-contract.md` §1 |
| `httpClient.ts` | axios instance; attaches `Authorization: Bearer`; on a 401, refreshes once and retries the original request; maps `errors[]` to field errors | `httpClient.refresh.test.ts`, `httpClient.baseUrl.test.ts` | gap check: the "refresh also fails → session cleared, logged out" path (`03` §1 point 2); base URL fallback to `http://localhost:3000` when `VITE_API_URL` is unset | `03` §0, §1 |
| `tokenStore.ts` | holds the access token in memory only (never `localStorage`) | none dedicated — implicitly exercised through `authSlice`/`httpClient` tests | a direct unit test (`set`/`get`/`clear`, and that nothing touches `window.localStorage`) would close a real gap and is cheap | `01` §4 |
| `types.ts` | shared TS types (`User`, `AuthResponse`, `LoginCredentials`, `RegisterDetails`, `ApiError`) | type-checked at compile time only | no runtime test needed; a schema-conformance test (client type vs. actual server response shape) is better done as a **cross-cutting API test** against real server output, not here | `03` §1 |

---

## Store (`client/src/store/`)

| Module | Does | Existing coverage | Invites | Governed by |
|---|---|---|---|---|
| `authSlice.ts` | thunks `login`, `register`, `restoreSession`, `logout`; reducers `setAccessToken`, `clearErrors`, `sessionExpired`; tracks `status` (`idle`/`checking`/`loading`/`succeeded`/`failed`), `error`, `fieldErrors` | `authSlice.test.ts` | gap check: every thunk's rejected-branch → `fieldErrors` populated correctly from `ApiError`; `sessionExpired` resets `user`+`accessToken`+`status` together (never partially) | `01` §4, §7 |
| `hooks.ts` | typed `useAppDispatch`/`useAppSelector` | none needed — pure typing wrappers, no behaviour | — | — |
| `store.ts` | Redux store setup | none needed — no branching logic | — | — |

---

## Not yet built (client side)

| Area | Where it will live | Spec |
|---|---|---|
| Chat UI (message list, input, draft confirmation) | `HomePage.tsx` (replacing the placeholder) | `01` §6, §7 |
| Dashboard charts/stats | `DashboardPage.tsx` (replacing the placeholder) | `02` |
| Category management screen | a new route or a panel in `/home` | `01` §10 |
| `chat`/`expenses` API modules | `client/src/api/` | `03` §3 |
| `chat`/`expenses` store slices | `client/src/store/` | — |

When any of these ship, add rows above; the `qa` agent also picks them up by
re-scanning `client/src/`.

---

## Cross-cutting: client + server together (E2E candidates)

Nothing here is built as an E2E suite yet — this section names the **journeys**,
not tests, so the `qa` agent (or a future run) can pick the ones that have
become worth automating.

| Journey | Worth automating when | Notes |
|---|---|---|
| Sign up → land on `/home` logged in → refresh the page → still logged in → log out → redirected to `/login` | now — every piece exists | the cheapest real E2E candidate today: drives the actual React app against the actual running server, proving the cookie/token wiring end to end, not just each side in isolation |
| Log in with wrong password → see the one generic error message → fix it → succeeds | now | same auth surface, negative path |
| Access-token expiry mid-session → silent refresh → original action completes | needs a way to force/shorten expiry in an E2E context (see the server file's note on token TTL) | currently only proven at the API layer (`qa/specs/` refresh tests) and the client unit layer (`httpClient.refresh.test.ts`) separately, never as one browser-driven flow |
| Type an expense in chat → see AI-drafted expense(s) → confirm → see it reflected on the dashboard | once chat (`01`) and dashboard (`02`) are built | the flagship journey for this app — worth a dedicated E2E test the day it exists |

Governed by: `03-api-contract.md` (the contract both sides agree to),
`01-ai-chat.md` §6–§7 (the chat journey), `05-user-layers.md` (the auth journey).

---

## Maintenance

The `qa` agent re-derives this document against the real client code at the
start of every run and updates it if it has drifted. You can also edit it by
hand when you add a feature — keep it a plain inventory: what exists, what it's
governed by, what it invites, what already has coverage. No test counts, no
pass/fail, no strategy prose.
