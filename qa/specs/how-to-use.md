# Test spec — `/how-to-use`, the public tutorial

**Area:** `client/src/components/HowToUsePage.tsx`, `TutorialLesson.tsx`,
`hooks/useTutorialSequencer.tsx`, `hooks/useTypedText.ts`,
`hooks/usePrefersReducedMotion.ts`, the `/how-to-use` route in `App.tsx`, the
navbar link in `NavBar.tsx`.
**Governing spec:** `docs/specs/12-how-to-use.md` (§ references below).
**Design file:** `docs/designs/Expenses Redesign.dc.html`.
**IDs:** `HT-01` … `HT-34`.
**Levels:** component (Vitest + RTL, in `qa/`), browser (Playwright, headed).

> **Read before implementing.** The working tree moved while this spec was
> being written: `useTutorialSequencer.tsx`, the `ReplayIcon`, and the navbar
> CSS were all edited at 14:41 on 2026-09-17 by a parallel session, which
> closed `HT-05` and `HT-09` as live defects. They stay in this spec as
> regression cases — the point of a case is that it fails if the fix is
> reverted, and these two fixes are minutes old and uncommitted.

## Environments

| Environment | Used by | Why |
|---|---|---|
| **none** — no account, no session, no cookie | most `HT-*` | The page is public. Archetype A0 meets this page before any database row exists, and asserting from a genuinely never-signed-up state is the only way to prove §1's "must not assume a user, a token, or any stored data". A *cleared* session is not the same thing and must not be substituted. |
| **fresh** — one signup, logged in | `HT-03`, `HT-12`, `HT-25` | The CTA branch and the parent-re-render path (`HT-25`) only exist for a logged-in visitor. |

No lived-in environment applies: §5 forbids the page from reading user data at
all, so account history cannot change its behaviour. `HT-13` is the case that
proves that claim rather than assuming it.

---

## 1. Route, access and navigation

### HT-01 — the page renders for a visitor who has never signed up
- **Purpose:** proves §1's public-access rule from the state it is actually
  written about, not from a logged-out-after-logout state.
- **Under test:** the `/how-to-use` route outside `ProtectedRoute`.
- **Method:** a browser context with no cookies and no `localStorage`. Go
  straight to `/how-to-use` as the first navigation of the context.
- **Expected:** HTTP 200 and a rendered page. The `<h1>` reads "How to use
  Expenses". Four lesson headings present: "Record an expense", "Fix a
  mistake", "Organise your categories", "See where it went". No redirect: the
  final URL is `/how-to-use`.
- **Environment:** none.

### HT-02 — the navbar carries the link in both auth states
- **Purpose:** §1's "a link in **both** navbar states". The `.navbar__links`
  block previously rendered only when logged in; the fix moved the link
  outside the `user &&` guard.
- **Under test:** `NavBar.tsx`.
- **Method:** load `/login` logged out; then sign up and load `/home`.
- **Expected:** logged out, the nav contains exactly one link "How to use" and
  no "Home"/"Dashboard". Logged in, it contains "Home", "Dashboard" and "How
  to use". In both, the link's `href` is `/how-to-use`.
- **Environment:** none, then fresh.
- **Fails if reverted:** yes — restoring the `user &&` wrapper removes the
  link from the logged-out nav.

### HT-03 — the closing CTA differs by auth state, and nothing else does
- **Purpose:** §8 keeps the CTA; §1 says "same page, same content, in both
  states — there is no logged-in-only section". Both claims at once.
- **Under test:** `HowToUsePage`'s `user` branch.
- **Method:** capture the page's full visible text logged out, then logged in.
- **Expected:** logged out — "Ready to try it yourself?" and a link to
  `/signup`. Logged in — "Ready to try it with your own expenses?" and a link
  to `/home`. Diffing the two texts yields **only** that CTA block: the hero,
  all four lesson headings, all four captions, and all six example sentences
  are byte-identical.
- **Environment:** none, then fresh.

### HT-04 — direct entry does not bounce through `/login`
- **Purpose:** the public route must not be caught by the destination-losing
  redirect chain that `RT-01` documents for protected routes.
- **Under test:** `App.tsx` routing + `ProtectedRoute`.
- **Method:** logged out, and again logged in, load `/how-to-use` cold and
  sample `location.pathname` every 100 ms for 3 s.
- **Expected:** every sample reads `/how-to-use`. The path never takes the
  value `/login` or `/home` at any point.
- **Environment:** none, then fresh.
- **Note to implementer:** assert the *whole sequence*, not the end state. The
  `/dashboard` bug is invisible to an end-state check — see `RT-01`.

---

## 2. The animations

### HT-05 — only one animation plays at a time
- **Purpose:** §4's strongest motion rule, stated there as "a failure, not a
  detail".
- **Under test:** `useTutorialSequencer.tsx`.
- **Method:** desktop viewport 1440×900, where several lessons are partly on
  screen at once (§4 calls this "the normal case, not an edge case"). Load the
  page and sample every lesson's stage text every 100 ms for 20 s, scrolling
  slowly from top to bottom over that period. A lesson counts as "playing" at
  a sample if its stage text differs from the previous sample.
- **Expected:** at no sample do two lessons both differ from their own previous
  value. At least one sample exists in which a lesson is mid-play (so the case
  cannot pass by nothing ever animating).
- **Environment:** none.
- **Fails if reverted:** yes — this was the observed behaviour before the
  14:41 sequencer landed: lessons 2 and 3 both showed "Sending…" in the same
  frame, recorded in `qa/field-notes-2026-09-17-exploratory.md` §2.

### HT-06 — a lesson that has not played waits at its first frame, not off-screen
- **Purpose:** §4's "never starts off-screen and never plays to nobody".
- **Under test:** the sequencer's election.
- **Method:** load the page and do not scroll. After 12 s, read lesson 4's
  stage.
- **Expected:** lesson 4's stage is still at its first frame (the "Totting up…"
  loading panel). It has not advanced.
- **Environment:** none.

### HT-07 — replaying one lesson does not strand another mid-animation
- **Purpose:** the interaction the sequencer introduces. `claim()` adds the
  claiming lesson to `played` and seizes `activeId`; the interrupted lesson's
  stepping effect returns early, never calls `notifyDone`, and is **already**
  in `played` — so `electLeader` will never elect it again. Its `step` state is
  untouched, leaving it frozen part-way for good.
- **Under test:** `useTutorialSequencer.tsx` `claim`/`electLeader`/`played`,
  and `TutorialLesson`'s stepping effect.
- **Method:** load the page. 1.4 s in — while lesson 1 is mid-sequence — click
  lesson 2's Replay. Wait 15 s. Read lesson 1's stage.
- **Expected:** lesson 1 reaches its final frame (its transcript ends with
  "Done." and shows no Confirm button). It must not be left showing a draft
  card or "Sending…".
- **Environment:** none.
- **Status:** **derived from reading the code, not reproduced end to end** —
  the working tree was being edited under this session and a clean run could
  not be completed. Implement it as written; if it passes, say so and this
  entry is retired rather than quietly dropped.
- **Why it matters beyond the mechanism:** the frame lesson 1 freezes on is
  most often the draft card with Confirm and Cancel — so a page whose thesis is
  "nothing is saved until you confirm" is left displaying an unconfirmed draft
  that never resolves.

### HT-08 — Replay restarts the lesson it names, and only that one
- **Purpose:** §4's Replay contract.
- **Under test:** `TutorialLesson.replay`.
- **Method:** let all four lessons play out. Record all four final stage texts.
  Click lesson 3's Replay. Sample every 100 ms for 8 s.
- **Expected:** lesson 3's stage returns to its first frame and advances again
  to its final frame. Lessons 1, 2 and 4 hold their final text unchanged at
  every sample.
- **Environment:** none.

### HT-09 — Replay looks like a control before it is hovered or focused
- **Purpose:** §4 — "a visible affordance — a border, an icon, or both — so it
  reads as something to press before it is hovered or focused, and is never
  mistaken for a line of body text"; and "says what it will replay, not just
  'Replay'".
- **Under test:** `.lesson__replay` in `index.css`, `TutorialLesson`'s markup.
- **Method:** for each of the four Replay buttons, in the resting state (no
  hover, no focus), read the computed border width, whether the button contains
  an `<svg>`, and its visible text.
- **Expected:** border width is non-zero **or** an `<svg>` child is present
  (§4 accepts either; today both hold). Visible text names the lesson — e.g.
  `Replay "Record an expense"` — not the bare word "Replay". The resting text
  colour differs from the adjacent `.lesson__caption` colour.
- **Environment:** none.
- **Fails if reverted:** yes. Before 14:41 this was `className="button
  button--plain"` with `background: none`, no border, no icon, `color:
  var(--muted)` — the same grey as the caption directly above it — and the
  visible text was the bare word "Replay".

### HT-10 — Replay meets the 44×44 target
- **Purpose:** §6, and consistency with FR-38's navbar bar.
- **Method:** measure each Replay button's bounding box at 1440 px and at
  375 px.
- **Expected:** height ≥ 44 px and width ≥ 44 px at both widths.
- **Environment:** none.

### HT-11 — the draft card is on screen long enough to read
- **Purpose:** §2 — "the confirm rule is the spine of the page, not a
  footnote", and §4's "every lesson that changes data shows the draft appearing
  and the user pressing Confirm". A frame nobody can read has not taught it.
- **Under test:** the `durations` arrays in `HowToUsePage`.
- **Method:** for lessons 1, 2 and 3, sample the stage every 50 ms through one
  full play and measure the wall-clock interval during which a Confirm control
  is present in the stage.
- **Expected:** **≥ 3500 ms** for each of the three.
- **Environment:** none.
- **⚠ Proposed bar — Adam to confirm.** No spec, design file or rule defines
  it. Measured today: lesson 1 holds it 1696 ms → 3876 ms = **2.18 s**. The
  card carries four facts plus two buttons; 2.2 s is under a comfortable read
  for that. **If Adam rejects the bar, delete this case** rather than lowering
  the number until it always passes.

### HT-12 — typing runs at a human cadence, not a metronome
- **Purpose:** §4 — "roughly the speed of someone typing the sentence, with
  small variation between keystrokes rather than a fixed metronome. Text that
  appears faster than a person could type reads as a machine filling a field".
- **Under test:** `hooks/useTypedText.ts`.
- **Method:** component level, fake timers. Render `useTypedText` with the
  42-character sentence `add a subcategory called Pets under Home`, record the
  length of the returned string at every timer tick, and derive (a) total
  elapsed time, (b) characters revealed per tick, (c) the variance of the
  inter-tick intervals.
- **Expected:** total elapsed ≥ 1800 ms for a 42-character sentence (≈ 1400
  chars/min, a fast but human typing speed); no single tick reveals more than 2
  characters; inter-tick intervals are not all identical.
- **Environment:** none (pure hook).
- **Status:** **expected to FAIL against the current code, deliberately.**
  `useTypedText` runs `steps = 12` over `durationMs = 700` — a fixed
  `setInterval`, ~3.5 characters per tick, the whole sentence in 0.7 s
  (≈ 3600 chars/min). That is a fixed metronome, faster than a person can
  type, which is the thing §4 names and rejects.
- **⚠ Also report to Adam, separately from the failure:** the hook's docstring
  attributes to spec §4 the sentence *"Typing is fast enough not to be a wait —
  the point is 'text goes in', not a typing-speed simulation."* **That sentence
  does not appear in `docs/specs/12-how-to-use.md`, or anywhere under
  `docs/`** (checked by grep). The code cites a rule the spec does not contain
  and implements the opposite of the rule it does contain. Whoever reads that
  comment will believe the code complies. Either the spec was revised after the
  code and the comment was never updated, or the requirement was invented; per
  `sdd.md` the spec wins, so the hook is wrong — but Adam should decide which
  of the two happened before it is changed.

### HT-13 — the page shows the same fixed content whatever the account holds
- **Purpose:** §5 — "No user data. The animations use fixed invented content,
  identical for everyone. The page never reads the logged-in user's expenses,
  even when one is logged in." Asserted, not assumed.
- **Under test:** `HowToUsePage`'s lesson data.
- **Method:** capture the full visible text of all four lesson stages at their
  final frames, logged out. Repeat logged in as `lv_steady` (180 expenses, 32
  categories, two months of history).
- **Expected:** identical, character for character, apart from the CTA block
  of `HT-03`. In particular lesson 4 shows ₪3800 Rent / ₪612.40 Groceries /
  ₪260 Fuel — the invented figures — and never a real total.
- **Environment:** none, then lived-in (`lv_steady`).

### HT-14 — the page issues no request of its own
- **Purpose:** §5's "No server. No new API route, no request".
- **Under test:** the whole page.
- **Method:** logged out, record every network request from navigation until
  20 s after load, with all four lessons played and each replayed once.
- **Expected:** no request to the API origin **except** the single
  `POST /users/refresh` that `App.tsx`'s `restoreSession` fires on every route.
  Zero requests to `/chat/*`, `/expenses/*`, `/categories`.
- **Environment:** none.
- **Finding to record either way:** that `restoreSession` call returns 401 and
  logs two console errors on the first page a stranger ever sees. It is not a
  §5 violation (it belongs to `App`, not the page) but it is noise on the
  public front door, and `RT-06` covers whether the page survives it failing.

### HT-15 — nothing on the page can be typed into or submitted
- **Purpose:** §5's no-server rule, from the visitor's side rather than the
  network's.
- **Method:** logged out, for each of the three demo composers: assert
  `readOnly`, assert the Send button is `disabled`, then attempt a real click
  on Send and a real typed character into the field.
- **Expected:** `readOnly` true and Send `disabled` for all three; the field's
  value is unchanged after typing; no network request results from either
  attempt.
- **Environment:** none.

---

## 3. The person watching

### HT-16 — no horizontal scroll at 375 px, and nothing cut off inside it
- **Purpose:** §5's "the page itself must have no horizontal scroll at 375px",
  and the trap that the obvious form of that assertion hides.
- **Under test:** the tutorial layout in `index.css`.
- **Method:** at 375×812, with every lesson played out, assert both:
  (a) `document.documentElement.scrollWidth === clientWidth`; **and**
  (b) for every element in the page, `getBoundingClientRect().right <=
  clientWidth + 0.5` — including elements inside `overflow-x` scrollers.
- **Expected:** both hold.
- **Environment:** none.
- **Why (b) is not redundant:** on `/dashboard` today, (a) passes at 375 px
  while the Recent-expenses table reaches 384 px inside its own scroller —
  measured, `qa/field-notes-2026-09-17-exploratory.md` §6. A suite carrying
  only (a) would report that route clean. `LV-15` in
  `qa/specs/regression-2026-09-17.md` carries the same pair for the same
  reason.

### HT-17 — the navbar wrap does not break a label mid-phrase
- **Purpose:** §5's "a fifth item must keep working inside that wrap", and §8's
  claim that the longer label "costs nothing at phone width".
- **Method:** at 375 px and at 320 px, logged in (five items) and logged out
  (three), measure each nav item's bounding box.
- **Expected:** no nav link's box is taller than 1.6× the line height — i.e.
  no single link has wrapped onto two lines. Items may wrap onto a second
  *row*; a label may not wrap within itself.
- **Environment:** none, then fresh.
- **Status:** **expected to FAIL today.** At 375 px logged in, "How to use"
  renders as "How to / use" across two lines while "Home" and "Dashboard" stay
  on one. That is the cost §8 says the label does not have. Not a blocker,
  but §8's stated reasoning does not currently hold and Adam should know.

### HT-18 — reduced motion still teaches the confirm step
- **Purpose:** §4 — "the lesson must still be complete and understandable
  without any motion at all. It is not acceptable for a reduced-motion user to
  get an empty box" — read together with §2's "every lesson that changes data
  shows the draft appearing and the user pressing Confirm".
- **Under test:** `TutorialLesson`'s `visibleStep` and `usePrefersReducedMotion`.
- **Method:** browser context with `reducedMotion: 'reduce'`. Load the page,
  wait 5 s, read all four stages.
- **Expected:** lessons 1, 2 and 3 each show a draft card with a visible
  Confirm control in their static frame.
- **Environment:** none.
- **Status:** **expected to FAIL, and the conflict is in the spec, not only
  the code.** §4 says reduced motion shows "the **final frame**"; the
  implementation does exactly that (`visibleStep = frameCount - 1`). But the
  final frame of lessons 1 and 2 is the transcript ending in "Done." — the
  draft card is gone by then. So the reduced-motion reader is shown the
  outcome and never the mechanism, and the one thing §2 calls the spine of the
  page is the one thing they cannot see. **This is a spec decision for Adam,
  not a bug to hand to a builder:** either §4's "final frame" becomes "a
  composed still that includes the draft card", or §2's spine rule carves out
  reduced motion. Whichever he picks, this case is rewritten to it.

### HT-19 — Replay is not a dead control under reduced motion
- **Purpose:** a button that does nothing is worse than no button.
- **Method:** with `reducedMotion: 'reduce'`, click each Replay and sample the
  stage for 5 s.
- **Expected:** either the stage changes, or the button is not rendered.
- **Environment:** none.
- **Status:** **expected to FAIL.** `play()` runs and bumps `playToken`, but
  `visibleStep` ignores `step` entirely in that mode, so nothing observable
  changes. Four visible, focusable, correctly-labelled buttons that do nothing.

### HT-20 — no focusable control sits inside an `aria-hidden` subtree
- **Purpose:** §6's accessibility rules; a standing WCAG requirement that no
  spec has to restate.
- **Under test:** `TutorialLesson`'s `<div className="lesson__stage"
  aria-hidden="true">`.
- **Method:** for every element matching
  `input, button, a, select, textarea, [tabindex]`, walk its ancestors and
  check for `aria-hidden="true"`.
- **Expected:** no matches.
- **Environment:** none.
- **Status:** **expected to FAIL.** The three demo composers are `readOnly`
  (not `disabled`) and so remain `tabIndex 0`, and each Send button sits in the
  same subtree. A keyboard user tabs through three text fields and three
  buttons that assistive technology has been told do not exist. `HT-15`'s
  `readOnly` is the right call for safety; the tab order is the part that was
  missed.

### HT-21 — the whole page is reachable and sensible by keyboard alone
- **Purpose:** §6, and the A0 archetype who never touches a mouse.
- **Method:** logged out, Tab from the document start to the end, recording
  the accessible name of each focused element in order.
- **Expected:** the order is: nav links, then per lesson its Replay button,
  then the CTA link. Every stop has a non-empty accessible name. No stop lands
  on a demo composer or a demo Send button.
- **Environment:** none.

### HT-22 — the lesson's waiting state does not instruct the reader wrongly
- **Purpose:** §4 says an unplayed lesson "waits, silently and at its first
  frame". It does not say the first frame may contradict the lesson.
- **Under test:** `ChatScreen`'s empty state, as reused by lessons 2 and 3.
- **Method:** load the page and do not scroll. Read lesson 2's and lesson 3's
  stage text before either has been elected.
- **Expected:** neither stage instructs the reader to type a sentence that
  belongs to a different lesson.
- **Environment:** none.
- **Status:** **expected to FAIL.** Both show `ChatScreen`'s real empty state:
  *"Nothing here yet. Try 'spent 50 at the supermarket.'"* On the lesson titled
  **Fix a mistake**, whose subject is "change the coffee to 22", the panel
  tells the reader to type something else entirely.
- **Note on ordering:** the 14:41 sequencer fix makes this **worse**, not
  better. Lessons now wait at frame 0 until elected, so the wrong copy is on
  screen longer than it was before. A fix that increases the exposure of a
  neighbouring defect is still the same round's work — `bug-flow.md` §4.

### HT-23 — lesson 3 ends on a category tree, not a panel of zeros
- **Purpose:** §4's table: lesson 3's final state is "the category list shows
  it nested".
- **Method:** read lesson 3's final frame.
- **Expected:** "Home" and "Pets" are shown, nested. **Proposed:** no money
  figure or percentage is displayed.
- **Environment:** none.
- **Status:** currently renders the real `CategoryBreakdown` with `amount: 0`
  throughout, so it reads `Home 0% ₪0.00 / Pets ₪0.00 / TOTAL ₪0.00` — a
  dashboard saying the reader has spent nothing, on the page whose job is to
  make the app look worth using. **⚠ The "no money figure" half is my
  proposal, not a spec rule** — §4 says what must be shown, not what must not.
  Adam to confirm; if he is happy with the zeros, that half is deleted and the
  case keeps only the nesting assertion.

### HT-24 — lesson 2 shows the row updating
- **Purpose:** §4's table: "Confirm → **the row updates**".
- **Method:** read lesson 2's final frame.
- **Expected:** the updated expense is visible at ₪22.00.
- **Environment:** none.
- **Status:** **expected to FAIL.** Lesson 2's last frame is the transcript
  ending "Done."; no row is shown. Lesson 1 has the same shape and §4 describes
  its ending as "the card settles into the saved state", which is also not what
  happens. Minor, but it is the spec's own sequence table.

---

## 4. The moment, and the actor

### HT-25 — the animation does not restart when the parent re-renders
- **Purpose:** `HowToUsePage` passes `durations={[1000, 500, 1600, 600, 0]}` as
  an **inline array literal**, and `TutorialLesson` lists `durations` in the
  dependency array of its stepping effect. A new array identity on every parent
  render re-runs that effect, resetting its local `index` to 0 and rescheduling
  from the start while `step` keeps its current value — the sequence jumps
  backwards.
- **Under test:** `TutorialLesson`'s stepping effect dependencies.
- **Method:** component level, fake timers, deterministic. Render
  `HowToUsePage` inside a wrapper that can force a re-render. Advance timers to
  put lesson 1 at step 2. Force one parent re-render. Continue advancing and
  record the full sequence of `step` values.
- **Expected:** the recorded sequence is monotonically non-decreasing —
  `0,1,2,3,4`. It never revisits a lower step.
- **Environment:** none.
- **Why component level and not browser:** the parent re-renders exactly once
  per load, when `restoreSession` resolves and `state.auth.user` changes —
  which happens **only for a logged-in visitor** (logged out, `user` stays
  `null` and reference equality suppresses the render). Locally the refresh
  resolves inside frame 0, where a restart is indistinguishable from normal
  play; I could not make it visible by hand. On a slow connection it lands
  mid-sequence and the reader sees the lesson jump. A browser test would be
  a coin flip; this one is not.
- **Note:** the dependency array now also contains `sequencer?.activeId`,
  which gives the effect a second reason to re-run. The fix is to hoist the
  four `durations` arrays to module constants — the same fix either way.

### HT-26 — timers and observers are torn down on unmount
- **Purpose:** the leak the testable-surface file flags: "a test that unmounts
  mid-animation is the one that finds a leak".
- **Method:** component level, fake timers. Mount `HowToUsePage`, advance to
  mid-animation, unmount. Assert no pending timers remain and that
  `IntersectionObserver.prototype.disconnect` was called for every observer
  constructed. Then advance timers 30 s and assert no state-update warning is
  emitted.
- **Expected:** all hold.
- **Environment:** none.

### HT-27 — navigating away mid-animation and back replays cleanly
- **Purpose:** the "interrupt the middle" axis at the router level.
- **Method:** load `/how-to-use`, wait 1.5 s (mid-lesson-1), click "Log in" in
  the nav, then navigate back to `/how-to-use`. Wait 10 s.
- **Expected:** lesson 1 plays from its first frame and reaches its final
  frame. No console error at any point.
- **Environment:** none.

### HT-28 — a reload mid-animation restarts the page cleanly
- **Method:** load, wait 2 s, reload. Wait 10 s.
- **Expected:** lesson 1 reaches its final frame; the page is complete; no
  console error.
- **Environment:** none.

### HT-29 — two tabs on the page do not interfere
- **Purpose:** the "actor" axis. The sequencer holds module-free per-provider
  state, so two tabs should be independent; asserted rather than assumed.
- **Method:** open `/how-to-use` in two tabs. Replay lesson 2 in tab A.
- **Expected:** tab B's lessons are unaffected.
- **Environment:** none.

### HT-30 — an expired session does not change the page
- **Purpose:** the "actor" axis, and §1's public rule under a *failing* auth
  state rather than a missing one.
- **Method:** log in, then delete the refresh cookie from the browser context
  so `restoreSession` will 401. Load `/how-to-use`.
- **Expected:** the full page renders. The CTA shows the logged-out branch. No
  redirect. No error surfaced to the reader.
- **Environment:** fresh, cookie removed.

### HT-31 — the page works with the API unreachable
- **Purpose:** §5's "No server … All content is in the client bundle" is a
  promise about a dependency, and the only way to test a dependency claim is to
  remove the dependency.
- **Method:** route every request to the API origin to a connection failure
  (Playwright `page.route` → `route.abort()`). Load `/how-to-use` logged out.
  Play and replay all four lessons.
- **Expected:** the page renders completely, all four animations run, both
  navbar states behave, the CTA links work. Nothing is blank, no error banner,
  no unhandled rejection.
- **Environment:** none.
- **Why it earns its place:** this is the page Adam would send someone to. It
  is also the only page in the app that has no reason to need a server, and
  "has no reason to" is not evidence.

---

## 5. Input, and the axis that does not apply

### HT-32 — the example sentences are ones the app actually handles
- **Purpose:** §3's "real examples the user can copy, covering phrasings the
  parser handles". A tutorial that prints a sentence the parser rejects teaches
  a falsehood, which is the failure §4 exists to prevent.
- **Under test:** the six strings in `EXAMPLE_SENTENCES`, against the real
  chat.
- **Method:** on a fresh logged-in account, send each of the six sentences
  through the real UI, one per conversation, 3 repetitions each (the model is
  probabilistic — see `RG-04`). Read the resulting intent and draft.
- **Expected:** each sentence yields a non-`unknown` intent matching what the
  tutorial implies, and a draft the reader could confirm, in **≥ 2 of 3**
  repetitions. Specifically: `"32.50 for gas yesterday"` must draft a date of
  *yesterday*, not today; `"delete the coffee expense from this morning"` on an
  account with no coffee must **refuse**, not invent a match (this is `BD-01`'s
  defect, and the tutorial advertises the phrasing).
- **Environment:** fresh, plus one run on lived-in `lv_coffee` for the delete
  sentence so it has something real to match.
- **Note:** this is the one place the tutorial's fixed content is checked
  against the live product. §4's whole argument is that the page cannot drift
  from the app; that argument covers the *components*, and nothing currently
  covers the *sentences*.

### HT-33 — the hardcoded demo date is not presented as recent
- **Purpose:** lesson 2's card reads `2026-09-12`, fixed in the bundle. It
  drifts further into the past every day the project lives.
- **Method:** read lesson 2's draft card date; compare to today.
- **Expected:** **proposed** — either the date is computed relative to today,
  or it is absent, or the spec accepts a fixed date and says so.
- **Environment:** none.
- **⚠ Proposed, low priority.** Nothing in the spec requires it. Adam may
  reasonably say a fixed demo date is fine for a six-day project; if so, delete
  this case. Raised because it is invisible today and embarrassing in March.

### Input axis — why it does not apply to most of this page
`HT-15` establishes that the page accepts no input at all: three `readOnly`
composers, three disabled Send buttons, and no other control but four Replay
buttons and two links. There is therefore no input space to vary for
`HT-01`…`HT-31`, and recording "input: not applicable" for them is a
statement about the page's design rather than an omission. The axis re-enters
the design at exactly one point, `HT-32`, where the page's *printed* sentences
become real input to the real parser — and that is the case most likely to
find something, because nothing else checks that the tutorial's advice is
true.

---

## 6. Coverage of this area, stated against the grid

| | Input | Moment | Actor | Person watching |
|---|---|---|---|---|
| F1 read the page | n/a (§5) | HT-27, HT-28 | HT-01, HT-30 | HT-16, HT-21 |
| F2 at 375 px | n/a | — | — | HT-16, HT-17, HT-10 |
| F3 reduced motion | n/a | — | — | HT-18, HT-19 |
| F4 keyboard | n/a | — | — | HT-20, HT-21 |
| F5 replay | n/a | HT-07, HT-08 | HT-29 | HT-09, HT-10 |
| F6 scroll past and back | n/a | HT-05, HT-06 | — | — |
| F7 API unreachable | n/a | HT-31 | HT-30 | — |
| F8 logged in | n/a | HT-25 | HT-03, HT-13 | — |
| F9 sign up from the CTA | HT-32 | — | HT-03 | — |

**Empty cells, named rather than counted:**

- **F2 / moment and actor** — nobody has replayed a lesson at 375 px, or read
  the page on a phone with an expired session. Accepted today: the layout is
  the only thing that differs at 375 px and `HT-16`/`HT-17` cover it, while the
  moment and actor paths are width-independent by construction.
- **F3 / moment and actor** — reduced motion combined with Replay is `HT-19`;
  reduced motion combined with a reload is **missed**, not accepted. I did not
  design it.
- **F6 / actor and person watching** — scroll-driven election has not been
  checked at 375 px, where every lesson is full-width and the "most in view"
  calculation behaves differently from desktop. **Missed.** This is the case I
  would write next.
- **F1 / input** — genuinely n/a, per §5 above.
