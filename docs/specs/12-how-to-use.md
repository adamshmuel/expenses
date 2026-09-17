# 12 — How to use

Status: **draft, awaiting approval.**

A tutorial page that teaches the app by showing it working. It is entirely
client-side: no route on the server, no API call, no data of the user's own.

## Why this page exists

The app has one unusual idea at its centre — **you change everything by
writing a sentence, and nothing is saved until you confirm it.** Nobody
arriving at `/home` for the first time knows that. The chat box looks like a
support widget. The 2026-09-16 exploratory notes and the 2026-09-17 run both
show people typing into it and not knowing what it will accept.

The page answers three questions, in this order:

1. What do I type?
2. What happens after I type it?
3. Where does what I typed end up?

## 1. Route and access

| | |
|---|---|
| Route | `/how-to-use` |
| Access | **Public.** Works logged out and logged in |
| Nav | A link in **both** navbar states ([01-ai-chat.md](01-ai-chat.md) §5) |

Logged out it is the only page that shows what the app does before signing up.
Logged in it is the help page. Same page, same content, in both states — there
is no logged-in-only section.

Being public means it must not assume a user, a token, or any stored data.
It renders identically for a visitor who has never signed up.

## 2. What the page teaches

Only what V1 actually does. The eight-intent table in
[01-ai-chat.md](01-ai-chat.md) §6 is the source; the page groups the seven
writing intents into four lessons because seven separate demos is a wall.

| Lesson | Covers | Why it is its own lesson |
|---|---|---|
| Record an expense | create expense | The commonest action, and the one that teaches the confirm step |
| Fix a mistake | edit expense, delete expense | Teaches that you describe the record in words, not pick it from a list |
| Organise your categories | create / edit / delete category, reset to defaults | A separate mental model from expenses |
| See where it went | `/dashboard` | Teaches that the dashboard only shows; it never edits. **No animation** — see §4 |

**The confirm rule is the spine of the page, not a footnote.** Every lesson
that changes data shows the draft appearing and the user pressing Confirm. A
visitor should finish the page unable to believe the app saves anything
silently.

The V2 question feature ([10-chat-questions.md](10-chat-questions.md)) is
**not** on the page until it ships. Teaching a feature that does not exist is
the exact failure `product-first.md` forbids.

## 3. Page structure

Top to bottom, one column:

1. **Opening** — one sentence saying what the app is, and the one rule:
   you write it, you confirm it, then it is saved.
2. **The four lessons**, in the order above. The first three carry an
   animation; the fourth carries a link to the dashboard (§4). Each is a short heading, one or
   two lines of text, and one animation.
3. **A short list of sentences that work** — real examples the user can copy,
   covering phrasings the parser handles (amounts, dates, stores, categories).
4. **Closing** — a link to `/home` when logged in, or to `/signup` when logged
   out.

No sidebar, no tabs, no accordion. A tutorial that has to be navigated is one
more thing to learn.

## 4. The animations

Each lesson has one animation showing the real screen performing that action.

**How they are built:** the animation is the app's own UI, rendered from the
app's own components and stylesheet, replaying a scripted sequence on a timer.
It is not a video, not a GIF, and not a drawing of the UI.

This is a correctness requirement, not an implementation detail. A hand-drawn
or recorded tutorial drifts from the product the moment the product changes,
and then it teaches something false. Rendering the real components means a
change to the chat bubble or the draft card shows up in the tutorial by
itself.

**What each animation shows:**

| Lesson | The sequence |
|---|---|
| Record an expense | Text types itself into the composer → send → the assistant's reply appears → the draft card appears → Confirm is pressed → the card settles into the saved state |
| Fix a mistake | `change the coffee to 22` types itself → the matched expense appears with the change → Confirm → the row updates |
| Organise your categories | `add a subcategory called Pets under Home` → the draft appears → Confirm → the category list shows it nested |

**"See where it went" has no animation.** Watching totals appear teaches
nothing the sentence beside it does not already say, and the real dashboard is
one click away. The lesson keeps its heading and its explanation, and carries a
**link to `/dashboard`** in place of the animation — and therefore no Replay
control, because there is nothing to replay.

The link is shown to a logged-out visitor too, who will be sent to `/login` by
`ProtectedRoute` if they follow it. That is why the lesson's text must say what
the dashboard *does*: a visitor who cannot reach it still has to learn where
their expenses end up.

**Motion rules:**

- **Only one animation ever plays at a time, and it is the one the reader is
  looking at.** A lesson starts when it becomes the lesson most in view, and
  plays **once**. Two animations running at once means the reader is missing
  one of them — on a page whose whole job is to be watched, that is a failure,
  not a detail. Several lessons being partly on screen at ordinary desktop
  widths is the normal case, not an edge case.
- An animation that has not played yet waits, silently and at its first frame,
  until it is the one in view. It never starts off-screen and never plays to
  nobody.
- **The animation never changes the page's layout while it plays.** Each
  lesson's stage reserves the height of its tallest frame from the start and
  keeps it for the whole sequence, so nothing below the lesson ever moves. A
  stage that grows as messages arrive — and then shrinks again when the empty
  state is replaced — shoves the rest of the page up and down while the reader
  is trying to read it, which is worse than the animation being absent.
  Reserving the space must not be done by hardcoding a pixel height: it has to
  survive a different viewport width, a longer sentence and a larger font.
- It does not loop. A looping animation next to text is a competing focus.
- Every animation has a **Replay** control that **looks like a control**. It
  carries a visible affordance — a border, an icon, or both — so it reads as
  something to press before it is hovered or focused, and is never mistaken for
  a line of body text. It also says what it will replay, not just "Replay", for
  a reader who meets it out of context.
- Replay is how a reader who looked away sees the lesson again, so it must be
  findable at a glance next to the animation it belongs to. A control nobody
  notices is the same as no control.
- **Typing runs at a human cadence** — roughly the speed of someone typing the
  sentence, with small variation between keystrokes rather than a fixed
  metronome. Text that appears faster than a person could type reads as a
  machine filling a field, and the lesson is "this is you, writing a sentence".
  A lesson should still finish in a few seconds, not tens of them.
- `prefers-reduced-motion: reduce` replaces the animation with **still frames**
  plus the same caption — never an empty box, and never motion.
- For a lesson whose point is draft-then-confirm, the final frame alone is not
  enough: by then the Confirm step is gone and the reader sees only "Done.",
  which is the outcome without the idea. Those lessons show the **confirm frame
  and the final frame together, stacked and still**, so a reduced-motion reader
  sees the step §2 calls the spine of the page. Everyone else is unaffected —
  the animation itself does not change.
- The extra height costs nothing: each stage already reserves the height of its
  tallest frame for the whole sequence.

## 5. Look and feel, and constraints

**The page is part of this app, not a brochure bolted onto it.** It uses the
visual language already defined at the top of `client/src/index.css` — the
ink/paper/debit tokens, Cormorant Garamond and Lora, and figures set in
monospace so money columns line up, all of it drawn from the idea that money
is printed on paper. `docs/designs/Expenses Redesign.dc.html` is the reference
for how that language is applied.

- No new palette, no new typeface, no UI kit.
- If the page needs something the tokens do not cover, it gets a **new token**,
  not a one-off hex value.
- The animations reuse the real components and their real classes (§4), so they
  inherit the design language rather than imitating it.

Constraints:

- **No server.** No new API route, no request, nothing from
  [03-api-contract.md](03-api-contract.md). All content is in the client
  bundle.
- **No user data.** The animations use fixed invented content, identical for
  everyone. The page never reads the logged-in user's expenses, even when one
  is logged in.
- **375px.** The navbar's phone-width overflow (LV-15, from the 2026-09-17
  run) is fixed: below 480px the row wraps onto a second line rather than
  squeezing its contents. A fifth item must keep working inside that wrap, and
  the page itself must have no horizontal scroll at 375px.
- **No new dependency** for the animation. CSS and the app's existing React.

## 6. Accessibility

- Every animation is inside a region with a text caption that says the same
  thing the motion says. The captions alone teach the page.
- The animations are decorative-with-a-caption: they are not the only source
  of any instruction.
- Replay controls are real buttons, reachable by keyboard, with the 44×44
  target size FR-38 is fixing for the navbar.
- Contrast and focus states follow the rest of the client.

## 7. Course-topic coverage

React side only — this page adds no Node.js topic.

| Topic | Where it appears here |
|---|---|
| Component composition | One lesson component reused four times with different scripts |
| `useEffect` + cleanup | Driving and tearing down the animation timers |
| `IntersectionObserver` | Starting an animation when it scrolls into view |
| React Router | A fifth route, public, outside `ProtectedRoute` |

## 8. Decided

- **The nav label is "How to use."** Length is affordable: the LV-15 fix wraps
  the navbar onto a second line below 480px rather than squeezing its contents,
  so a longer label costs nothing at phone width.
- **The closing call to action stays**, including for a logged-out visitor who
  already has Sign up in the navbar. A reader who has finished the page should
  find the next step where their eyes already are. The navbar link is
  navigation; this one is the conclusion of the argument.
