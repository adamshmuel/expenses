# Exploratory field notes — 2026-09-17

Session run **before** reading `docs/specs/12-how-to-use.md`, the
2026-09-17 testable-surface file, or the automated-run findings. The bug
reports were opened only after the flow list in
`qa/flow-analysis-2026-09-17.md` was written and sealed. This is the ordering
`user-environments` prescribes, and the reason for it is recorded in the
2026-09-16 notes: read the bug list first and it silently becomes the design.

**Environment.** Backend spawned by hand on port 3100 against a throwaway
database `expenses_qa_explore` (never Adam's dev data, never
`expenses_qa_test`). Client on 5174 with `VITE_API_URL=http://localhost:3100`.
Real Gemini calls. One fresh account, `qaexplore17`, created through the real
signup form.

Order I actually hit things, not tidied up afterwards.

---

## 1. Logged out, cold, no idea what this app is

Landed on `/login`, not on the tutorial. Worth saying plainly because the
brief for this run described `/how-to-use` as "the first thing a logged-out
visitor sees" — it is not. It is one click away, in the navbar, and the
default landing page for a stranger is still a login form with no explanation
of what they would be logging into. The left-hand panel animates a ledger slip
("spent 50 at the supermarket and 32 on gas" → two lines and a total), which
is the only thing on that screen that says what the product does.

Not a defect. But the tutorial's reach depends entirely on one unremarkable
navbar link, and nothing on `/login` points at it.

## 2. The tutorial itself

Four lessons, each an animation built from the app's real components, each
with a Replay. It reads well and the idea is good — the thing that teaches you
the app *is* the app, so it cannot drift into a lie the way a screenshot does.

Things I noticed using it:

- **The transcript says the wrong thing while a lesson is waiting to start.**
  Lessons 2, 3 and 4 sit below the fold and start when scrolled into view.
  Until then, and again for the first second of every Replay, the panel shows
  the real chat's empty state: *"Nothing here yet. Try 'spent 50 at the
  supermarket.'"* On the lesson titled **Fix a mistake**, whose whole subject
  is "change the coffee to 22", the demo panel is telling you to type a
  completely different sentence. Same on **Organise your categories**. It is
  the shared `ChatScreen`'s empty state leaking into a context where it is
  simply wrong.

- **The draft card — the entire point of lessons 1 and 2 — is on screen for
  about 2.2 seconds.** Measured, not guessed: lesson 1's card appears at
  1696 ms and is replaced at 3876 ms. That card is where the promise of the
  page ("confirm it before anything is saved") is actually demonstrated, and
  it holds "Change Coffee shop — ₪12.00 — 2026-09-12 — amount to 22?" plus
  Confirm and Cancel. Reading that is not a 2.2-second job. I had to hit
  Replay and screenshot in a tight loop to read it at all. No spec, design
  file or rule says how long a frame should hold, so there is no bar to fail
  against — I have proposed one (§"Bars I am proposing" below).

- **Reduced motion gets a worse lesson, not a calmer one.**
  `TutorialLesson` renders `frameCount - 1` when reduced motion is set — the
  *last* frame. For lesson 1 the last frame is "Done."; for lesson 2 it is
  "Done." The user who has asked for reduced motion is shown the outcome and
  never the draft card, i.e. they see the one thing the lesson is not about
  and miss the one thing it is. The Replay button is still rendered and still
  clickable, and does nothing observable, because `visibleStep` ignores
  `step` entirely in that mode.

- **Three dead text boxes in the keyboard tab order.** The demo composers are
  `readOnly` with a disabled Send — good, nothing can be typed or submitted
  from a public page. But they are still `tabIndex 0`, and they sit inside a
  `<div aria-hidden="true">`. So a keyboard or screen-reader user tabs into
  three form fields that assistive technology has been told do not exist.

- **Lesson 3 ends on a money panel full of zeros.** Its final frame is the
  real `CategoryBreakdown` showing `Home 0% ₪0.00 / Pets ₪0.00 / TOTAL
  ₪0.00`. The point being made is structural (Pets now nests under Home), but
  what is drawn is a dashboard saying you have spent nothing, on a page whose
  job is to make the app look worth using.

- **A hardcoded date that will age.** Lesson 2's card reads `2026-09-12`.
  Fixed content, so it drifts further into the past every day the project
  lives.

- **Latent: the lesson timers restart when the parent re-renders.**
  `HowToUsePage` passes `durations={[1000, 500, 1600, 600, 0]}` as an inline
  array literal, and `TutorialLesson` lists `durations` in the dependency
  array of the effect that steps the frames. A new array identity on every
  parent render re-runs that effect, which resets its local `index` to 0 and
  reschedules from the start while `step` keeps its current value. The parent
  re-renders exactly once per page load, when `restoreSession` resolves and
  `state.auth.user` changes — which only happens for a **logged-in** visitor
  (logged out, `user` stays `null` and reference equality suppresses the
  render). I could not make the glitch visible by hand: the refresh resolved
  in well under a second, inside frame 0, where a restart is
  indistinguishable from normal play. It is a real ordering bug that is
  currently hidden by a fast local network, and it is the kind of thing a
  component test pins deterministically and a browser test never will.

## 3. Signing up and recording something real

Signup worked first time and dropped me on `/home`. The navbar carries
"How to use" in both auth states, as intended.

- **On an empty chat the "Chat" heading floats in the middle of the page**
  with roughly 230 px of nothing above it. Cosmetic, but the first screen a
  new account sees looks unfinished.

- **You press Send and your own message vanishes.** This is the thing I would
  fix first. Measured: the sentence leaves the input immediately, and for the
  next ~3 seconds the transcript still reads *"Nothing here yet. Try 'spent 50
  at the supermarket.'"* while the button says "Sending…". Your words are on
  screen nowhere. On a fresh account the only text visible is an instruction
  to type the thing you have just typed. The user's message and the
  assistant's reply appear together at the end. Every chat product ever built
  echoes the user's message the instant it is sent, precisely because this
  gap is unbearable — and this is the app's single core flow.

- **The confirm card for a new expense never shows the date.** It read
  `supermarket — Groceries — ₪50.00` and `gas — Fuel — ₪32.50`. Amount, label,
  category — no date. The user is asked to confirm a write whose date they
  cannot see. (The stored dates turned out to be correct, today, midnight UTC
  — but "correct today" is invisible to the person pressing the button, and
  the *edit* card in the tutorial does show a date, so the two cards disagree
  about what matters.)

- **After confirming, the reply is the single word "Done."** No echo of what
  was saved, no amount, no category, no date. Combined with the point above,
  the user confirms a card with no date and receives a confirmation with no
  content.

- **`->` leaks into user-facing prose.** "Want me to add 50 under Food ->
  Groceries…". An ASCII arrow in a sentence a person reads.

## 4. What actually landed in the database

I checked the stored rows against what the screen had shown, field by field,
rather than checking that a row existed.

```
{ amount: 50,   store: "supermarket", date: 2026-09-17T00:00:00.000Z, category: <Groceries> }
{ amount: 32.5, description: "gas",   date: 2026-09-17T00:00:00.000Z, category: <Fuel> }
```

Amounts, categories and dates all correct. But: **one sentence produced two
expenses whose label landed in two different fields.** "supermarket" went to
`store`; "gas" went to `description`. Defensible on the model's part — one is
a place, the other is a thing — but the confirm card rendered both
identically, so the user cannot see the difference, and anything downstream
that reads `store` finds one of them and not the other. Which is exactly what
the dashboard then does: its Recent-expenses table has a column headed
**STORE** and prints "gas" under it, a value that is not a store and is not in
that field.

(False alarm I want on the record, because it nearly went in the report: my
first dump showed every chat message stored as the literal string
`"undefined"`. That was me reading a field called `content`. The model's field
is `text`, and the transcript is stored correctly. Dumping the raw document
is what caught it.)

## 5. Leaving the page and coming back — the worst thing I found

Reloading `/dashboard` while logged in does not reload the dashboard. It
lands you on `/home`.

Traced it, because "redirects to /home" and "redirects to /home for this
reason" are different bugs. Watching `location.pathname` through a cold load
of `/dashboard`:

```
immediately → /login
~1s later   → /home
```

So: `ProtectedRoute` reads `status` and `user` on the very first render.
`authSlice`'s `initialState.status` is **`'idle'`**, not `'checking'`, and the
guard only renders nothing for `'checking'`. On that first render `user` is
`null`, so it fires `<Navigate to="/login" replace />` — and `replace`
destroys the entry for where the user was going. `restoreSession` then
succeeds, `PublicOnlyRoute` sees a logged-in user sitting on `/login`, and
bounces them to `/home`. The destination is gone by then; nothing is left that
knows it was `/dashboard`.

The comment in `ProtectedRoute` describes this exact hazard and says the
`'checking'` branch exists to prevent it. The branch is right; the initial
value it keys on is wrong, so the guard never gets the chance.

This is not dashboard-specific. **Every protected deep link and every reload
of a protected page loses its destination**, and it only looks harmless today
because the app has exactly two protected routes and the accidental landing
spot is one of them. Refreshing the dashboard to see updated numbers is an
ordinary thing to do, and bookmarking it is the obvious thing a returning user
would do.

Owner is `client/` (`store/authSlice.ts`), so this is fixable without touching
Adam's server.

## 6. Narrow screens

`LV-15` was filed as "the dashboard overflows once a category is expanded".
Measured at 375 px, on the current working tree, that is not what is there:

| Route | State | `scrollWidth` vs `clientWidth` |
|---|---|---|
| `/how-to-use` | logged out | 375 / 375 — no overflow |
| `/home` | logged in | 375 / 375 — no overflow |
| `/dashboard` | logged in, both categories expanded | 375 / 375 — no overflow |

The navbar wraps to two rows instead of overflowing, so the fix in the tree
appears to hold. Two things it left behind:

- **"How to use" wraps mid-phrase** in the navbar, rendering as "How to /
  use" over two lines while "Home" and "Dashboard" stay on one.
- **The Recent-expenses table still reaches 384 px**, 9 px past the viewport,
  inside its own `overflow-x` scroller. The page does not scroll sideways, so
  a test asserting `scrollWidth === clientWidth` **passes while the table is
  still cut off**. At two rows of data every amount is legible; with longer
  store names it would not be. This is the precise shape of a test that
  proves the plumbing and not the result, and the case I have written asserts
  the amount cells' own right edges, not the document's.

## 7. Bars I am proposing, because nothing defines them

Neither the specs, the design file, nor any rule says what "fast enough" or
"readable" means here. Per the working agreement I am not allowed to record
these as uncovered, so these are my proposed numbers, for Adam to confirm,
change, or reject. If he rejects one, its case is deleted rather than watered
down until it always passes.

| Bar | Proposal | Why this number |
|---|---|---|
| Draft card hold time in a tutorial lesson | **≥ 3.5 s** | It carries four facts plus two buttons; 2.2 s is under a comfortable read for that. |
| Time from Send to the user's own message appearing | **≤ 150 ms** | It is local state; there is no reason to wait for the server at all. |
| Time from Send to a drafted reply, real model call | **≤ 6 s**, with visible progress throughout | Observed 3–5 s. The budget is for catching a regression, not for praising the current number. |
| Everything legible at 375 px | no element's right edge past the viewport, **including inside scrollers** | See §6 — the document-level check passes while content is cut. |

## 8. What this session changed downstream

Because notes nobody acts on cost time and buy nothing:

- The `/dashboard` reload bug (§5) became **RT-01…RT-05** and is the
  highest-risk item in this round's roadmap. Nothing in the existing 225 cases
  covers it; `UJ-01` reloads `/home`, where the bug's accidental destination
  happens to be the correct one, so it passes.
- The Send-echo gap (§3) and the dateless confirm card (§3) became
  **CX-01…CX-03**.
- The empty-state copy leak, the frame hold time, reduced motion, and the
  tab-order problem (§2) became the `HT-*` block.
- The `store`/`description` split (§4) became **SD-01/SD-02**, and demoted the
  existing dashboard-table assertions to samples.
- §6 rewrote **LV-15**'s case away from the original bug report, which
  described something that is not what is happening.
