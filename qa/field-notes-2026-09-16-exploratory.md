# Exploratory field notes — 2026-09-16

**Session:** ~45 minutes at the keyboard. Real signup (`qalead_dana`), real chat
messages against the real Gemini call, real dashboard, real MongoDB reads to check
what actually landed.

**What was open while I did this:** nothing. No specs, no code, no bug records, no
existing test files. This file was written before any of those were read. That
ordering is deliberate — see `.claude/skills/user-environments/SKILL.md`.

**Environment:** server `localhost:3000` (Adam's `backend/index.js`, real Atlas,
default DB `test`), client `localhost:5173`. Browser driven through the Chrome
tools.

---

## In the order I hit it

### 1. Signup form — submitted empty on purpose

Three field errors came back and mapped onto the right fields. Good.

Two things I noticed:

- The username error reads **"User name must between 3 and 20 characters"** —
  missing the word "be". Also "User name" as two words, where the label says
  "Username".
- **"Confirm password" got no error** even though it was empty and every other
  field did. As a user I read that as "that field is fine", which it is not.

### 2. Signup worked, landed straight on the chat

No confirmation, no "welcome". Fine — the chat empty state carries it
("Nothing here yet. Try 'spent 50 at the supermarket.'").

The chat screen with no messages puts the heading and the composer floating in the
vertical middle with a large dead area above. Looks unfinished rather than
deliberate. Cosmetic.

### 3. Typed my first expense and pressed Enter — **nothing happened**

`spent 50 at the supermarket and 32 on gas`, then Return. The text just sat there.
I waited 6 seconds. No network request fired at all (checked).

This is the single most natural action in a chat interface and it does nothing.
There is no affordance telling you Enter is not the send key. I only got past it
because I know to look for a button.

### 4. Clicked Send — worked, and the draft card is good

Assistant replied *"I have put these down under Groceries (under Food) and Fuel
(under Transport). Want me to save them?"* and a card appeared:

```
1. supermarket — Groceries — ₪50.00
2. gas — Fuel — ₪32.00
[Confirm] [Cancel]
```

Two things about that card:

- **It does not show the date.** I am being asked to approve a write without being
  told which day it will be filed under. For an app whose entire dashboard is
  date-filtered, that is the one field I cannot verify before saying yes.
- There is a large empty gap between the assistant's message and the card. The card
  is docked to the bottom rather than flowing after the message it belongs to, so
  at a glance it is not obviously *that* message's card.

### 5. Confirmed — and the receipt vanished

Reply was **"Done."** and the itemised card disappeared completely.

Scrolling back up the transcript now, there is no record of what was saved. I see
"I have put these down under Groceries and Fuel" and "Done." — but the amounts, the
line items, the thing I actually approved, are gone. If I want to know what I
agreed to, the chat cannot tell me.

### 6. Dashboard — correct

₪82.00, 2 expenses, 2 categories, Food 61% / Transport 39%, recent expenses dated
16 Sept. All right. Category drill-down (Food → Groceries) works. The "Today" /
"This week" / "This month" filters switch correctly and the header line updates.

This screen is the best part of the app. It is clear, it reads well, and the
"read-only. Every change is made in the chat." line is a genuinely good bit of
product writing.

### 7. Incomplete input — `bought coffee`

Asked me for the amount, offered no card. Correct behaviour.

### 8. Answered with the bare word `18` — multi-turn memory works

It remembered the coffee and produced a card: `coffee — Coffee — ₪18.00`. Good.

### 9. Changed my mind: `actually it was 22, and it was at Aroma`

Prose came back fine: *"I have updated the amount to 22 and the store to Aroma
under Coffee (under Food). Want me to save it?"*

**The card did not appear.** No Confirm button anywhere on the page. I am asked a
yes/no question with no way to say yes.

I read the response body. The model had leaked its own reasoning into the `store`
field:

```json
"drafts": [{
  "amount": 22,
  "store": "Aroma and coffee expense correction description if needed omitted or
   simplified to coffee description context omitted in draft description since
   store is Aroma but description can remain coffee ... Wait, let's include
   description coffee if originally stated, but wait, the prompt says amount 22,
   store Aroma, category Coffee (under Food). ... Let's look at fields: amount,
   store, category, description, date."
}]
```

No `category`. Nothing on the server rejected this. Nothing on the client told me
anything was wrong — it just rendered no card, silently.

### 10. So I typed `yes`, like anyone would — **and the app lied to me**

Reply: **"I have saved your 22 expense at Aroma under Coffee (under Food)."**

I went to the dashboard. Still ₪82.00. Still 2 expenses. I checked MongoDB
directly. Still 2 expenses.

**Nothing was saved.** The app told me, in plain words, that it had recorded an
expense that does not exist.

This is the worst thing I found. Every other bug in this session is something the
user can see. This one is invisible — you walk away believing your budget is
right, and it is quietly 22 short. For an app whose only job is to be a truthful
record of what you spent, a false "I have saved" is a total failure of the product
promise.

### 11. Reload with a draft pending — logged me out

Created a draft (`paid 240 for electricity`, card appeared fine), then reloaded the
page. I was thrown back to the login screen.

Looking at the network: the client fires **two** `POST /users/refresh` calls on
load. One returns 200, the other returns 401 — and the 401 is the one that decides,
so I get logged out. Refresh rotates the token (old row deleted, new pair issued),
so two concurrent calls with the same cookie cannot both win.

In dev this is React StrictMode double-invoking. But the underlying race is real
and reachable without StrictMode: **two tabs open, both reloading, is the same
thing.** A user who keeps the app open in a second tab gets logged out at random.

Also noticed the same double-fire on `GET /chat/messages?limit=50` — every chat
load fetches twice.

### 12. Logged back in — history survived, the draft did not

The transcript came back intact, ending on *"I have put this down as 240 under
Utilities (under Home). Want me to save it?"* — with no Confirm button.

So the chat persists the **prose** but not the **draft**. Any reload leaves an
unanswerable question sitting in the transcript forever.

### 13. `last Tuesday I spent 90 on a train ticket`

Parsed as **2026-09-08**. Today is Wednesday 2026-09-16 — so yesterday, 2026-09-15,
was also a Tuesday. "Last Tuesday" said on a Wednesday most naturally means
yesterday. It picked the one 8 days back.

I am not sure that is wrong, and I am not sure it is right. What I am sure of is
that **nothing decides this** — there is no rule written down anywhere the model
can be held to, and the user is only shown the resolved date buried in a sentence.

The draft body again had **no `category`**, despite the prose saying "under Public
transport (under Transport)". No card. Second occurrence of the same failure.

### 14. `how much did I spend on food this month?`

*"I can only help you track, edit, or delete expenses and categories, but I cannot
calculate totals yet."*

Honest, which I like. But the answer is sitting on the Dashboard tab two
centimetres away and it does not say so. A one-line "the Dashboard has that" would
turn a dead end into a handoff.

### 15. Hebrew — `קניתי לחם ב-12 שקל`

Worked. Card: `לחם — Groceries — ₪12.00`. Amount and category both right.

The reply came back in **English**. For an app that prices in ₪ and is being built
in Israel, answering a Hebrew message in English is a jarring mismatch. Not a bug;
a product decision nobody has made.

### 16. Cancel — silently does nothing visible

Clicked Cancel on the Hebrew draft. The card disappeared. **No acknowledgement at
all.** No "OK, I won't save that."

Which means the transcript now looks *identical* in four different situations:

| What happened | What the transcript looks like afterwards |
|---|---|
| I confirmed | "...Want me to save it?" → "Done." |
| I cancelled | "...Want me to save it?" (nothing) |
| I reloaded the page | "...Want me to save it?" (nothing) |
| The model emitted a broken draft | "...Want me to save it?" (nothing) |

Three of those four are indistinguishable. A user scrolling back cannot tell
whether an expense was declined, lost, or broken.

### 17. Read the database directly

Two expenses stored for my account, both dated 2026-09-16, both correct amounts,
both correctly categorised. The write path, when it works, works.

But the two rows from **the same message, the same turn** are shaped differently:

```json
{"amount":50,"store":"supermarket"}              // no description
{"amount":32,"description":"gas"}                // no store
```

One uses `store`, the other uses `description`, for the same kind of thing. The
dashboard's STORE column showed both, so it is falling back from one to the other
and hiding the inconsistency.

Across the whole database (7 expenses, all users): 2 have `store`, 4 have
`description`, **0 have both**, and **1 has neither** —

```json
{"amount":40,"date":"2026-03-31T00:00:00.000Z"}
```

An expense with no label of any kind. On the dashboard that is a blank row: ₪40,
no store, nothing to tell you what it was. Nothing validated it on the way in.

Signup seeds **17 categories** (8 top-level, 9 children). `Other` is
`isProtected: true`; nothing else is.

### 18. The thing that struck me most, looking at the whole database

**52 user accounts. The largest has 5 expenses.**

Nobody — no test, no person — has ever used this app with more than a week of data
in it. Every judgement anyone has made about whether it works is a judgement about
its first five minutes. The dashboard's date filters, the category breakdown
percentages, the "Recent expenses" list, and above all the model's consistency
(it is handed the account's categories and recent expenses as context on every
message) are all completely unexercised.

---

## What surprised me, in one list

1. The app says "I have saved" for things it did not save. **Silent data loss.**
2. Enter does not send.
3. A page reload logs you out, because of a token-rotation race the client causes itself.
4. The model's prose and the model's JSON routinely disagree, and nothing checks.
5. When they disagree, the UI shows **nothing** — no card, no error, no way forward.
6. Confirm, Cancel, reload, and breakage all look the same in the transcript.
7. The confirm card never shows the date, which is the one field the user cannot otherwise check.
8. `store` and `description` are used interchangeably and an expense can have neither.
9. No account in existence has more than 5 expenses.

## What is genuinely good

- The dashboard. It is clear, well laid out, correctly calculated, and its
  read-only framing is well written.
- Multi-turn memory. Answering `18` to "how much was it?" works, and that is the
  hard part of this interaction done right.
- Hebrew parsing with correct amount and category.
- Refusing to answer a question it cannot answer, instead of inventing a number.
- Server-side validation on signup returns per-field errors that map to fields.

## What this session changes downstream

Every one of the numbered findings above becomes either a flow, a case class, or a
reported observation in `qa/flow-analysis-2026-09-16b.md` and the specs under
`qa/specs/`. The three that reshape the *design* rather than adding a case:

- **"Assert the claim against the store."** Finding 10 means no case may end at the
  assistant's sentence. Every case that ends in a claim about data must read the
  data back. This applies backwards to existing cases.
- **"Assert prose and payload agree."** Findings 9, 13 mean the draft JSON is a
  separate assertion target from the reply text, always.
- **"Volume is an input, not scenery."** Finding 18 means the lived-in environment
  is not an enhancement; without it, the majority of this app is untested.
