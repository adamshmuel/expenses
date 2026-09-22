# Flow analysis — 2026-09-17

Written **after** the exploratory session in
`qa/field-notes-2026-09-17-exploratory.md` and **before** opening
`2026-09-17-automated-run-findings.md`, `2026-09-17-how-to-use-testable.md`,
or `docs/specs/12-how-to-use.md`. The provenance column below is the honesty
check: if it were mostly "bug report", the user-first step did not happen.

Scope of this round: the new public tutorial, the thirteen unverified fixes,
and the shared-component extraction. The 225-case V1 suite is not redesigned;
V2 (`docs/specs/10`/`11`) is out of scope and already covered by
`v2-chat-questions-2026-09-17.md`.

---

## The four questions, answered from this session

**1. What is this app for?**
Unchanged from 2026-09-16: a home budget book that writes itself from a
sentence. What *is* new is that it now has a front door that tries to explain
that to somebody who has never seen it — and the honest answer after using it
is that the front door is a navbar link on a login screen that says nothing.

**2. How is it meant to be used?**
Three screens now, not two, and the third is public. The promises the
tutorial makes implicitly, by being the kind of thing it is:

- **A tutorial promises you can read it.** A frame that shows the thing being
  taught for 2.2 seconds and then replaces it has not taught it. Measured;
  see field notes §2.
- **A tutorial promises it is showing you the real app.** This one keeps that
  promise structurally — it is built from `ChatScreen`, `CategoryBreakdown`
  and `DashboardTotals` themselves, so it cannot drift into a lie the way a
  screenshot would. That is a genuinely good decision and it is also the
  single biggest new risk: those three components now have two callers, and
  a regression in any of them breaks a real screen and the tutorial together.
- **A tutorial promises it is inert.** Nothing a visitor does on a public
  page should write, call the API, or need a session.
- **A page in the navbar promises it works logged out**, including if the
  server is down — there is no reason a fixed, invented, identical-for-
  everyone page should depend on a backend.
- **Reduced motion promises a calmer version of the same lesson**, not a
  shorter and less informative one.

And the promises the older screens make, which this session found broken:

- **A page promises that reloading it reloads it.** `/dashboard` does not.
- **A chat promises your message appears when you send it.** It does not, for
  about three seconds.
- **A confirm card promises it shows what you are confirming.** The
  create-expense card omits the date.

**3. How *can* it be used?**
New possibilities this round adds, on top of 2026-09-16's list:
- Arrive on `/how-to-use` from outside, logged out, with no account.
- Arrive on it logged in (the CTA changes, and so does the render count —
  see the `durations` finding).
- Tab through it with a keyboard, or hear it with a screen reader.
- Ask for reduced motion.
- Read it on a 375 px phone.
- Scroll past a lesson before it plays, or scroll back up and expect a
  replay.
- Hit Replay repeatedly, or on several lessons at once.
- Bookmark `/dashboard`, or refresh it.
- Open a protected URL directly while logged in, logged out, or with an
  expired refresh cookie.

**4. What must never happen?**
Carried forward from 2026-09-16, plus:
- The public tutorial must never issue a write, never require auth, and never
  render a real user's data.
- No focusable control may sit inside an `aria-hidden` subtree.
- A protected deep link must never silently lose its destination.
- No element may be cut off at 375 px — *including inside a scroll
  container*, where the document-level check cannot see it.

---

## Archetypes

The four lived-in accounts (`qa/specs/env-lived-in.md`) stand. This round adds
one the existing suite has almost no coverage of, and it is the one the new
page is built for.

| # | Archetype | Account state | What they do today | New? |
|---|---|---|---|---|
| A0 | **Stranger** | no account, no session, no cookie | lands on `/login`, finds "How to use", reads the tutorial, decides whether to sign up | **yes** |
| A1 | First evening | empty, fresh signup | records their first expenses | no |
| A2 | Two months in (`lv_steady`) | 180 expenses, 60 days | adds today's coffee, glances at the dashboard | no |
| A3 | Repetitive spender (`lv_coffee`) | 40 near-identical coffees | adds another | no |
| A4 | Sprawler (`lv_sprawl`) | 32 categories, 3 near-duplicate clusters | asks for something matching three | no |
| A5 | Corrector (`lv_corrector`) | 6 ambiguity clusters | fixes a vague 3-week-old expense | no |
| A6 | Returner (`lv_corrector`) | last message 21 days old | picks up cold | no |
| A7 | **Confused returner** | has an account, opens a bookmarked `/dashboard` | expects the dashboard | **yes** |

A0 matters because it is the only archetype that meets the product before it
meets the database, and because almost every existing test starts from a
signup. A7 matters because it is the archetype the `/dashboard` reload bug
actually hits, and no existing case occupies it.

---

## Flows, crossed with archetypes

Provenance: **E** exploratory (this session), **S** spec, **A** archetype,
**D** design file, **B** bug report. Sealed before the bug reports were read —
every **B** row below was added afterwards, in a marked block, and none
replaced an **E** row.

| Flow | Archetype | Provenance | Covered today? |
|---|---|---|---|
| F1 Stranger lands, finds the tutorial, reads all four lessons | A0 | E | no |
| F2 Stranger reads it at 375 px | A0 | E | no |
| F3 Stranger reads it with reduced motion | A0 | E/S | no |
| F4 Stranger keyboard-tabs the whole page | A0 | E | no |
| F5 Stranger replays one lesson, then another, then the same one twice | A0 | E | no |
| F6 Stranger scrolls fast past a lesson and back | A0 | E | no |
| F7 Stranger reads the tutorial with the API unreachable | A0 | E | no |
| F8 Logged-in user opens the tutorial (CTA differs, parent re-renders) | A1/A2 | E | no |
| F9 Stranger reads the tutorial, then signs up from its CTA | A0→A1 | E | no |
| F10 Fresh account records a first expense, checks stored fields | A1 | E | partly — `FJ-01` is a sample |
| F11 User sends a message and waits (what they see meanwhile) | A1/A2 | E | no |
| F12 User confirms a draft without ever seeing the date | A1 | E | no |
| F13 User reloads `/dashboard` | A7 | E | **no — bug** |
| F14 User opens a protected deep link logged out | A0 | E | partly — `UJ-01` |
| F15 User reloads `/home` mid-draft, draft pending | A1 | E | no |
| F16 Dashboard at 375 px with categories expanded | A2 | E | no |
| F17 Same sentence yields `store` for one item and `description` for another | A1 | E | no |
| F18 Shared component changes and both callers must still work | all | E | **no — this is the refactor risk** |

### Added after reading the bug reports (B rows)

These extend the list; they did not define it. Each is here as a *class*, and
where the class was already closed by a row above, it says so and adds
nothing.

| Flow | Archetype | Provenance | Note |
|---|---|---|---|
| F19 Every fix from the 2026-09-17 run, re-walked end to end | various | B | the thirteen regression cases |
| F20 Amount precision and sign, at the prompt not the schema | A1–A5 | B | must be treated as fallible |
| F21 Duplicate-key 409 in its three `keyValue` shapes | A0 | B | |
| F22 Contract agreement across the `ai/` ↔ `bl/` seam | all | B | class already implied by F17 |
| F23 Can a failure be reconstructed from what it left behind | all | B | |

**Already closed by an E row, nothing added:** the "assert every stored field,
supplied and derived" class (F10 covers it and demotes `FJ-01`); the "start
the flow at the real producer, not a hand-written payload" class (F10 and F11
both walk the real UI).

---

## Samples, stated plainly

These exist, are worth keeping, and are **not** coverage:

- `FJ-01`, `DJ-01` — one happy-path walk each of chat→dashboard. One sentence,
  one account, one shape of data.
- `UJ-01` — reloads `/home` only. It passes *through* the `/dashboard` reload
  bug without touching it, because `/home` is the accidental destination the
  bug lands on. This is the clearest example in the suite of a green test
  sitting next to a broken flow.
- `HomePage.test.tsx` / `DashboardPage.test.tsx` — unedited through the
  extraction and still passing. That is evidence the two *callers* still
  render, not evidence the three extracted components behave identically for
  both callers. See `qa/specs/client-shared-components.md` §1.
- Every existing `CC-*` case that posts a hand-written payload to
  `/chat/confirm`. Determinism justifies it; it means nothing upstream is
  verified to produce that payload.
