# Test spec — cases from the 2026-09-17 exploratory session

Everything found by hand this round that is neither the tutorial (`HT-*`) nor
the extraction (`SC-*`) nor one of the thirteen fixes (`RG-*`).

**IDs:** `RT-01` … `RT-08` (routing and session), `CX-01` … `CX-06` (what the
user can see), `SD-01` … `SD-03` (the `store`/`description` split).
**Source:** `qa/field-notes-2026-09-17-exploratory.md`.
**Provenance:** exploratory. None of these appears in any bug report.

---

## 1. Routing and session — `RT-*`

### The defect these are written against

Reloading `/dashboard` while logged in lands you on `/home`. Traced, not
guessed. Sampling `location.pathname` through a cold load of `/dashboard`:

```
immediately → /login
~1s later   → /home
```

`authSlice`'s `initialState.status` is **`'idle'`**, not `'checking'`.
`ProtectedRoute` renders nothing only for `'checking'`, so on the first render
it sees `status === 'idle'` and `user === null` and fires
`<Navigate to="/login" replace />`. The `replace` destroys the history entry
for where the user was going. `restoreSession` then succeeds, `PublicOnlyRoute`
finds a logged-in user on `/login`, and sends them to `/home`. By then nothing
remembers `/dashboard`.

`ProtectedRoute`'s own comment describes this exact hazard and says the
`'checking'` branch exists to prevent it. The branch is right; the initial
value it keys on is wrong, so the branch never runs.

**This is not dashboard-specific. Every protected deep link and every reload
of a protected page loses its destination.** It looks harmless only because
there are two protected routes and the accidental landing spot is one of them.

Owner: `client/src/store/authSlice.ts` — Claude's, not Adam's.

### RT-01 — reloading the dashboard reloads the dashboard
- **Purpose:** the defect above, from the user's seat. Archetype A7.
- **Under test:** `authSlice` initial `status`, `ProtectedRoute`.
- **Method:** log in, navigate to `/dashboard` via the navbar, confirm the
  dashboard is rendered, then reload. Wait for the page to settle.
- **Expected:** final URL is `/dashboard` and the dashboard is rendered.
- **Environment:** fresh, and repeated on lived-in (`lv_steady`) so a slower
  first paint is exercised too.

### RT-02 — the path is never `/login` on the way there
- **Purpose:** the mechanism, so the case cannot be satisfied by a fix that
  merely restores the destination after a visible flash through the login
  screen.
- **Method:** logged in, cold-load `/dashboard`. Sample `location.pathname`
  every 50 ms from navigation until 4 s.
- **Expected:** every sample is `/dashboard`. The value `/login` never appears.
- **Environment:** fresh.
- **Note to implementer:** assert the **whole sequence**. An end-state check
  passes today on `/home` and would pass on a fix that still flashes. This is
  the case that distinguishes them.

### RT-03 — a bookmarked protected URL opens where it points
- **Method:** with a valid session cookie in the browser context, open
  `/dashboard` as the very first navigation of a fresh context.
- **Expected:** the dashboard.
- **Environment:** fresh.

### RT-04 — reloading `/home` still works
- **Purpose:** the neighbour check. `UJ-01` covers this today and must keep
  passing after `RT-01`'s fix.
- **Method:** as `RT-01`, on `/home`.
- **Expected:** final URL `/home`, chat rendered, session intact.
- **Environment:** fresh.
- **Note:** `UJ-01` is a **sample**, not coverage — it reloads the one route
  whose correct destination happens to be the bug's accidental destination, so
  it passes straight through the defect. Recorded as such in
  `qa/flow-analysis-2026-09-17.md`.

### RT-05 — a logged-out visitor on a protected URL still reaches `/login`
- **Purpose:** the opposite direction, which must not regress.
- **Method:** no session. Open `/dashboard`, then `/home`.
- **Expected:** both land on `/login` and stay there.
- **Environment:** none.
- **Proposed extension:** after logging in from that screen, the user should
  arrive at the page they originally asked for. **Nothing implements this
  today** and no spec requires it. Raised as a question for Adam, not written
  as a passing case — if he wants it, it is a separate change.

### RT-06 — an expired refresh cookie sends you to `/login`, once
- **Purpose:** the actor axis. `sessionExpired` sets `status` back to
  `'idle'`, which is the same value the bug above keys on — so the expired
  path deserves its own case rather than being assumed equivalent.
- **Method:** log in, delete the refresh cookie, then reload `/dashboard`.
- **Expected:** lands on `/login`, stays there, no redirect loop, and the path
  does not oscillate.
- **Environment:** fresh.

### RT-07 — two tabs, one logout
- **Purpose:** the actor axis, and the refresh rotation under `RG-09`.
- **Method:** log in. Open `/home` in tab A and `/dashboard` in tab B. Log out
  in tab A. Reload tab B.
- **Expected:** tab B lands on `/login`. No 500. No stranded half-rendered
  dashboard.
- **Environment:** fresh.

### RT-08 — `/` and an unknown path behave
- **Method:** load `/` logged out and logged in; load `/no-such-page` in both
  states.
- **Expected:** `/` → `/login` logged out, `/home` logged in. `/no-such-page`
  → the not-found page in both, with a working link back, and **no** redirect
  to `/login` when logged in.
- **Environment:** none, then fresh.

---

## 2. What the user can see — `CX-*`

### CX-01 — your own message appears when you send it
- **Purpose:** the implicit promise a chat makes by being a chat. Measured
  today: the sentence leaves the composer immediately and for **~3 seconds**
  the transcript still reads *"Nothing here yet. Try 'spent 50 at the
  supermarket.'"* while the button says "Sending…". The user's words are on
  screen nowhere, and on a fresh account the only text visible is an
  instruction to type the thing they have just typed.
- **Under test:** `client/src/store/chatSlice.ts` `sendChatMessage`,
  `HomePage`.
- **Method:** fresh account, real UI. Send `spent 50 at the supermarket` and
  sample the transcript every 50 ms from the click.
- **Expected:** the user's own message is in the transcript within
  **150 ms**, and stays there continuously until the reply arrives. The empty
  state is gone from that moment.
- **Environment:** fresh.
- **⚠ Proposed bar — Adam to confirm.** 150 ms, because this is local state
  and there is no reason to wait for the server at all. Nothing in any spec
  defines it.
- **Why this is the one I would fix first:** it is the app's single core flow,
  it happens on every message, and it is the moment a user decides whether the
  thing works.

### CX-02 — the user is told something is happening for the whole wait
- **Purpose:** the same gap, from the other side.
- **Method:** as `CX-01`. Measure from the click to the reply appearing, and
  assert a busy indicator is continuously present throughout.
- **Expected:** a visible indicator at every sample in the interval. Total
  round trip **≤ 6 s**.
- **Environment:** fresh, and once on `lv_sprawl` (32 categories make a larger
  prompt and a slower call).
- **⚠ Proposed bar — Adam to confirm.** Observed 3–5 s. The budget exists to
  catch a regression, not to praise the current number.

### CX-03 — the confirm card shows the date the expense will carry
- **Purpose:** the create-expense card shows amount, label and category and
  **no date**. The user is asked to confirm a write whose date they cannot
  see. The tutorial's *edit* card does show a date, so the two cards disagree
  about what matters.
- **Under test:** `ChatScreen`'s `create-expense` branch.
- **Method:** fresh account. Send `spent 50 at the supermarket`. Read the draft
  card.
- **Expected:** a date is shown.
- **Environment:** fresh.
- **Status:** **expected to FAIL.**
- **Why it matters more than it looks:** "no invented date" is one of the
  invariants in `qa/flow-analysis-2026-09-16.md` §4, and bug 4 of the
  2026-09-16 set was a wrong stored date. The stored dates are correct today —
  `RG-22` asserts that. But a correct value the user cannot see is a value
  they cannot catch being wrong, and the whole page-level promise is "confirm
  it before anything is saved". You cannot confirm what you are not shown.
- **And the sibling:** `yesterday` and `last Tuesday` are phrasings the
  tutorial itself advertises (`32.50 for gas yesterday`). Send that, and assert
  the card shows *yesterday's* date before Confirm — the case where a hidden
  date is most likely to be wrong and least likely to be noticed.

### CX-04 — the reply after confirming says what was saved
- **Purpose:** the reply is the single word *"Done."* — no amount, no
  category, no date. Combined with `CX-03`, the user confirms a card with no
  date and receives a confirmation with no content.
- **Method:** fresh account, confirm a two-expense draft.
- **Expected:** **proposed** — the reply names what was saved, at least the
  amounts and the categories.
- **Environment:** fresh.
- **⚠ Proposed, Adam to decide.** No spec requires it. It may be a deliberate
  choice to keep the chat terse. Raised because "Done." is the only feedback
  the app gives for its core action, and bug 1 in the findings is *the app
  saying it saved something it did not* — a reply that names what it saved is
  also the cheapest way for a user to catch that.

### CX-05 — the empty chat does not look unfinished
- **Purpose:** on a new account the "Chat" heading sits roughly 230 px down the
  page with nothing above it. The first screen a new account sees looks
  broken.
- **Method:** fresh account, `/home`, at 1440 px and 375 px. Measure the
  heading's offset from the top of the main content area.
- **Expected:** **proposed** — the heading sits at the top of the content area,
  within 32 px.
- **Environment:** fresh.
- **⚠ Proposed bar.** Cosmetic, and `docs/designs/Expenses Redesign.dc.html` is
  the source of truth for layout the specs do not pin. `qa-tester` should check
  the design file before implementing and assert against it instead of my
  number if it says anything about this.

### CX-06 — `->` does not reach the reader
- **Purpose:** the assistant writes *"Want me to add 50 under Food ->
  Groceries…"* — an ASCII arrow in prose a person reads. `prompt.js`'s own
  rule spells the example with a proper arrow (`under Food → Coffee`).
- **Method:** 10 replies across create, edit and category intents.
- **Expected:** no `->` in any `reply`. A `→` is fine.
- **Environment:** fresh and lived-in.
- **Note:** low severity, prompt-level, and will not be reliable at 100% —
  assert **≥ 9 of 10** and report the rate.

---

## 3. `store` versus `description` — `SD-*`

### The finding

One sentence — `spent 50 at the supermarket and 32.5 on gas` — produced two
expenses whose label landed in **two different fields**:

```
{ amount: 50,   store: "supermarket", ... }
{ amount: 32.5, description: "gas",   ... }
```

Defensible on the model's part: one is a place, the other is a thing. But the
confirm card rendered both identically, so the user cannot see the difference,
and anything downstream reading `store` finds one and not the other.

Which is what the dashboard then does: its Recent-expenses column is headed
**STORE** and prints `gas` under it — a value that is not a store and is not in
that field.

The findings already note that the prompt's store-versus-description rule "is
ambiguous enough that the model visibly agonises over it in production" — the
deliberation text behind bug 5 is the model arguing with itself about which
field to use. This is the same ambiguity, reaching the database quietly instead
of loudly.

### SD-01 — a column headed STORE does not print a description
- **Under test:** `DashboardPage`'s Recent-expenses table.
- **Method:** fresh account. Seed one expense with only `store` and one with
  only `description`. Load `/dashboard`.
- **Expected:** **proposed** — either the column header is not "Store", or the
  description row is visibly distinguished from a store row. Both rows must
  remain readable; neither may be blank.
- **Environment:** fresh.
- **⚠ Proposed.** No spec pins the header. The cheapest honest fix is
  relabelling the column; that is Adam's call.

### SD-02 — every saved expense carries a label in a field something reads
- **Purpose:** the invariant behind `RG-13`, extended across the whole history
  rather than the row just written.
- **Method:** across every expense in all four lived-in accounts, assert each
  has a non-empty `store` **or** a non-empty `description`, and that the
  dashboard renders a non-blank label for every one of them.
- **Expected:** no blank rows anywhere.
- **Environment:** lived-in (all four).
- **Why across the whole history:** bug 7's symptom was "a blank row on the
  dashboard, permanently". `RG-13` stops new ones. This one finds the ones
  already there, which `RG-13` cannot.

### SD-03 — an edit finds the expense whichever field holds its label
- **Purpose:** the downstream consequence, and the one that bites a real user.
- **Method:** fresh account. Create one expense whose label is in `store`
  (`spent 50 at the supermarket`) and one whose label is in `description`
  (`32.5 on gas`). Then, in the same conversation, `change the gas to 40` and
  `change the supermarket to 60`. Confirm each. 3 repetitions.
- **Expected:** in ≥ 2 of 3, each edit finds the right expense and the stored
  amounts end at 40 and 60 respectively. Critically, the `gas` edit must not
  fail to match merely because the search looks at `store`.
- **Environment:** fresh.
- **And at volume:** repeat on `lv_coffee`, where 40 near-identical coffees
  make a wrong match far likelier than a failed one.

---

## 4. Debt cleared from the 2026-09-17 findings

The findings name two items as `qa-lead`'s own, one of them explicitly as a
promise not kept. Both are here rather than left in a gap table.

### RT-09 — A6, the returner: a real case, not a tautology
- **The debt:** *"`LV-17` is a tautology: it asserts a Confirm button is absent
  on a fresh load, which is unconditionally true because no draft is ever
  persisted server-side. It passed and proved nothing. `qa-lead` owns this — it
  said it would rewrite the case and did not."*
- **Purpose:** what actually happens to a returner is that they come back cold
  and refer to something by memory. That is the risk, and it needs history.
- **Method:** `lv_corrector`, whose last message is 21 days old. Load `/home`.
  Then, with no other context, send `change that coffee to 19`.
- **Expected:** the transcript loads the old conversation. The assistant does
  **not** treat "that" as referring to anything in the 21-day-old tail — it
  either asks which expense, or matches on the word "coffee" against real
  expenses and offers a choice. It must not silently pick the most recent
  coffee, and it must not invent a match (`RG-08`'s class).
- **Environment:** lived-in (`lv_corrector`).
- **`LV-17` is deleted, not amended.** A case that cannot fail is worse than no
  case, because it occupies a row in the coverage table.

### RT-10 — A5, the corrector: unblock before re-running
- **The debt:** *"`LV-04`/`LV-05` ran against ambiguity clusters the seeder
  built wrong — generic filler leaked into the curated clusters. Both cases are
  **unverified**, not passing."*
- **Method:** before re-running either case, assert the seeded corpus matches
  `qa/specs/env-lived-in.md` §3: `lv_corrector` has exactly six clusters of 3–5
  expenses, and no generic filler expense falls inside a cluster's
  amount/description/date envelope.
- **Expected:** the assertion holds; then `LV-04`/`LV-05` run and their result
  means something.
- **Environment:** lived-in (`lv_corrector`).
- **Note:** this is a fixture fault, not a product fault, and it belongs to
  `qa-tester`. It is listed here so that A5 stops being reported as covered.

### CX-07 — `FR-01`: confirm by hand that Enter sends
- **The debt:** the findings correct the 2026-09-16 record — *"pressing Enter
  **does** work"*; the original observation "came through a different
  automation layer and was a tool artefact recorded as a product defect.
  **Worth five seconds of confirming by hand.**"
- **What happened this session:** I hit the same trap and caught it. Enter
  appeared to do nothing in the composer — and so did Backspace, `cmd+a`, and
  `End`. No special key reached the page at all, and a listener attached to the
  form recorded `submit` events: **zero**. That is an automation-layer
  limitation, not a product defect. What I *can* confirm structurally: the
  composer is a real `<form>` containing one `<button type="submit">` that is
  not disabled, so native implicit submission applies.
- **Method:** `qa-tester` must run this through a layer that genuinely
  dispatches key events — Playwright's `keyboard.press('Enter')` — and assert
  the POST fires. **Do not** implement it through a layer whose key handling is
  unverified, and if Enter appears not to work, first prove the harness can
  press a key at all before filing anything.
- **Expected:** Enter in the composer sends the message.
- **Environment:** fresh.
- **Why it stays in the spec although it is believed fine:** it has now been
  mis-reported once and nearly mis-reported twice. A case is cheaper than a
  third round of this.
