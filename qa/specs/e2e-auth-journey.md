# Test spec — client + server auth journeys (e2e)

**Under test:** the real React app (Vite dev server) driving the real running
server, over real HTTP — no mocked `httpClient`, no mocked API responses.
**Governing spec:** `docs/specs/01-ai-chat.md` §1, §4; `docs/specs/03-api-contract.md`
§1; `docs/specs/05-user-layers.md` §4, §6.
**Level:** e2e — Playwright, one browser (Chromium), against a real backend
(`node backend/index.js`, test DB `expenses_qa_test`, port 3100) and a real
client (`vite`, port 5174, `VITE_API_URL=http://localhost:3100`).
**Automation:** `qa/e2e/tests/auth-journey.spec.ts`.

These are the two journeys named "worth automating now" in
`docs/reference/testing-reference/2026-09-11-client-testable.md` — every screen
they touch (`LoginPage`, `SignupPage`, `NavBar`, `HomePage` placeholder,
`ProtectedRoute`/`PublicOnlyRoute`) is built. The chat and dashboard journeys in
that same table are **not** automated here because the screens they need
(`HomePage` chat UI, `DashboardPage`) are still placeholders — see "Not covered,
accepted" in `qa/test-roadmap.md`.

---

### UJ-01 — sign up, land logged in, survive a reload, log out

- **Purpose:** proves the cookie/token wiring end to end — the piece no unit or
  API test can see, because each side is tested separately everywhere else.
  Specifically: the access token lives only in memory (never `localStorage`),
  a page reload loses it but the `refreshToken` cookie silently restores the
  session, and logging out actually ends it (not just a client-side redirect).
- **Under test:** `SignupPage` → `authSlice.register` → `POST /users/signup`;
  `App`'s mount-time `restoreSession()` → `POST /users/refresh`; `NavBar`'s
  logged-in state; `NavBar`'s logout → `POST /users/logout` → redirect.
- **Method:**
  1. Generate a fresh user with `makeUser()` (same factory the API tests use —
     unique username/email per run).
  2. Navigate to `/signup`. Fill username, email, password, confirm password
     (matching). Submit.
  3. Wait for the URL to become `/home`.
  4. Assert the `NavBar` shows the username and a "Log out" button (logged-in
     state), and that `/login`/`/signup` links are gone.
  5. Assert `window.localStorage` has no key containing the access token or
     the word "token" anywhere in its values (the access token must live only
     in the Redux store, in memory).
  6. Reload the page.
  7. Assert the app returns to `/home` still logged in (`NavBar` still shows
     the username) — this only works if `restoreSession()` successfully used
     the `refreshToken` cookie, since the in-memory access token is gone after
     a reload.
  8. Click "Log out".
  9. Assert the URL becomes `/login` and `NavBar` shows "Log in"/"Sign up"
     (logged-out state).
  10. Try to navigate directly to `/home`.
- **Expected result:** step 3 lands on `/home` (not `/login`, not an error
  banner). Step 4 confirms the logged-in `NavBar`. Step 5 finds no token in
  `localStorage`. Step 7 confirms the session survived the reload via the
  cookie alone. Step 9 confirms logout actually cleared the session
  client-side. Step 10: `/home` redirects back to `/login` (`ProtectedRoute`
  correctly sees no user — the server-side logout worked, not just the UI).

### UJ-02 — wrong password shows the generic message, then the right one works

- **Purpose:** the UI must not leak which field was wrong (mirrors `LI-07` at
  the API layer, but proves the *browser* actually renders the generic message
  rather than a more specific one swallowed somewhere in the client).
- **Under test:** `LoginPage` → `authSlice.login` → `POST /users/login`; the
  `error` banner rendering; retry with correct credentials.
- **Method:**
  1. Sign up a fresh user directly via the API (`signup()` from
     `qa/fixtures/factories.ts`) — this test only needs an *existing* account,
     not to exercise signup again.
  2. Navigate to `/login`. Fill the known username with a wrong password.
     Submit.
  3. Read the `role=alert` banner text.
  4. Clear the password field, fill the correct password, submit.
  5. Wait for the URL to become `/home`.
- **Expected result:** step 3's banner text is exactly
  `"Username or password is incorrect."` — the same generic sentence the API
  returns for both "unknown user" and "wrong password" (no hint which). Step 5
  succeeds once the correct password is used — the earlier failure did not
  leave the form, the store, or the rate limiter in a state that blocks a
  legitimate retry.

---

## Known environment notes (not blockers)

- The e2e client runs on port **5174**, not Adam's dev port 5173, and the e2e
  backend runs on port **3100**, not his dev port 3000 — so this suite never
  collides with `npm run dev` if he has it open. The backend instance for this
  suite is started with `CLIENT_ORIGIN=http://localhost:5174` so CORS still
  matches exactly (spec `03` §0 requires an exact origin, not `*`).
- Same test-DB isolation as the rest of `qa/`: `expenses_qa_test`, dropped
  before and after the run (`qa/e2e/globalSetup.ts`, reusing
  `qa/harness/db.ts`).
