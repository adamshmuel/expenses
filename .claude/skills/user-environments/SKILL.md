---
name: user-environments
description: >-
  Decide what to test by exploring the product by hand and modelling the people
  who use it and the state their accounts are actually in — not by reading the
  code surface or the last bug report. Covers: exploratory testing sessions before
  any test design, the four user questions, naming user archetypes, marking where
  every test idea came from, building a lived-in test environment with weeks or
  months of accumulated history alongside the fresh-account environment, and
  designing the tests that only exist once data has piled up. Use this FIRST,
  before any inventory, spec reading, roadmap or test design, on every QA run —
  and again whenever asked "what should we test," "is this enough coverage,"
  "what did we miss," "test what's built," "explore the app," or when a bug
  reached a human while the suite was green. If you are about to list flows,
  design test cases, or judge whether coverage is sufficient, you need this skill.
  Not for: how to write the test code once designed — use unit-testing,
  api-testing, or playwright-automation. Not for: factory and fixture mechanics —
  use test-data-management, which this skill tells you how to scope.
---

<objective>
Produce the user model, the environments, and the flow list that every later
testing decision is judged against. A suite derived from the code surface proves
each piece works alone. A suite derived from the last bug report proves the last
bugs are gone. Neither proves the app works for the people using it — and both
have already failed on this project.
</objective>

---

## Why this skill exists

A real QA engineer is the number one user of their product. They know how every
screen feels because they opened it, clicked it, and lived in it — not because
they read its source. They know what breaks in month two because they have an
account that is in month two.

An agent doing QA has a strong pull in the opposite direction: reading code is
fast, a bug list is a ready-made checklist, and small hand-picked datasets make
assertions easy to write. Each of those is locally sensible and the combination
is how a green suite ends up sitting next to a broken app.

This project has the receipts. Eleven bugs were found by hand, on the main flow,
while every automated test passed. The next run produced a document titled "think
like a user" in which nearly every line cited one of those eleven bugs — the
ritual was performed, the content was back-filled from the checklist. The flows
that came out of it were then judged "enough," because they were measured against
the same list they were copied from.

That is the failure this skill is built to prevent. The order below is the
correction: **explore the app, answer the four questions, model its users, build
their environments, and only then look at code, specs, and bug reports.**

---

## 1. Explore the app before you describe it

Start every run with an **exploratory testing** session: open the real app in a
real browser and use it as a person would, before reading specs, before the code
inventory, and with the bug reports closed. Reading the bug list first does not
produce discovery, it produces confirmation of the list.

Exploratory testing is not manual regression testing, and it is not clicking
around hoping something breaks. It is risk-based critical thinking done at the
keyboard: you steer by what you understand about where this app is likely to be
fragile, how it is built, and what its users actually need, and you change
direction the moment something looks off. The absence of a script is the point —
a scripted pass can only find what somebody already thought of in advance, which
by definition excludes every bug nobody has imagined yet. That is why this finds
things quickly and broadly that no amount of pre-written test cases would.

Drive it the way someone would on a real evening with it: record something, get
it wrong, fix it, abandon something halfway, go and look at the dashboard, come
back. Follow curiosity and suspicion. When something feels wrong, chase it until
you understand it rather than noting it and moving on.

**Judge it against a wider standard than automation can reach.** A test suite
can only tell you whether the thing it was told to check still behaves. An
exploratory session is the only part of this process that can notice a feature is
awkward, ugly, confusing, slow, or simply not useful — and those reach users just
as hard as a crash does. Ease of use, visual design, and whether the feature
actually does something worth doing are all in scope here, and nowhere else.

**Feed what you learn back, or the session was wasted.** Exploratory testing
earns its place by what it changes downstream: findings become new automated
tests, they sharpen existing ones, they point at code worth fixing, and they tell
you which risks deserve attention next. A session that ends with notes nobody
acts on has cost time and bought nothing. The two halves depend on each other —
exploration finds what nobody scripted, automation stops it coming back.

Write what you saw to a field-notes file under `qa/`, plainly, in the order you
hit it. Anything that surprised you, annoyed you, felt slow, felt wrong, or made
you hesitate belongs in it, including things you cannot yet turn into an
assertion. A note saying "I could not tell whether it had saved" is a real
finding; it may become a test, or a report to Adam, or nothing — but it can
become none of those if it was never written down. Tell Adam what the session
taught you, not only what failed; he is the developer here, and what you noticed
while using his app is worth as much to him as a failing assertion.

Then keep doing this. An exploratory pass is not a one-time initiation you
graduate from. Every run includes one, because the app changes and because a
suite you only ever read stops being connected to the thing users touch.

---

## 2. The four questions

Answer these in writing immediately after the exploratory session, while the app
is still fresh in mind. You have just used it, so answer from what you saw rather
than from what the specs claim.

1. **What is this app for?** One sentence from the user's side.
2. **How is it meant to be used?** The intended path — and the promises each
   screen makes implicitly by being the kind of thing it is. A chat promises the
   composer stays put, that it remembers what it just asked, that "yes" means
   yes. A dashboard promises that what you just recorded appears on it. Nobody
   writes these down; most defects that reach a human live exactly here.
3. **How *can* it be used?** Everything actually possible, intended or not —
   answering with a bare word, typing instead of clicking, correcting mid-draft,
   abandoning things, reloading at the worst moment, calling the API directly and
   skipping every guard the UI puts up.
4. **What must never happen?** The invariants: nothing saved without confirming,
   nothing filed under a category or date the user never agreed to, no silent
   failure, no secret in a response, no reading another user's data.

These four are what turn a session of poking at screens into a model of the
product. Question 2 in particular is only answerable by someone who has just used
the thing — implicit promises do not appear in any spec, and they are where most
escaped defects live.

---

## 3. Model the population, not "a user"

"The user" is a fiction that quietly means *someone who just signed up*, because
that is the cheapest account to create. Day-one users are the smallest and
easiest slice of any real user base, and a suite that only knows them is testing
the app's first five minutes forever.

Name the actual archetypes for this product, in writing. For each one, describe
who they are, how much history their account carries, and what they would do
today. A useful set for a budget app looks something like:

| Archetype | What their account looks like | What they do today |
|---|---|---|
| First evening | empty, no categories touched yet | records their first few expenses, explores |
| Two months in | hundreds of expenses, categories with real weight | adds today's coffee; glances at the dashboard weekly |
| Repetitive spender | dozens of near-identical entries ("coffee", "coffee", "coffee") | adds another one and expects it filed like the last thirty |
| Sprawler | many categories, several overlapping or near-duplicate | asks for something that could match three of them |
| Corrector | edits and deletes often, changes their mind mid-sentence | fixes an expense from three weeks ago, described vaguely |
| Returner | opens it after two weeks away | picks up with no memory of what they last said |

These are a starting shape, not a list to copy. Derive yours from what the
product is for and what its own history does to it. The archetypes that matter
most are the ones where the app's behaviour *depends on* the state of the
account, because those are the ones a fresh signup can never reach.

---

## 4. Name the flows — and mark where each came from

A flow is a complete journey with a start, a middle, and a visible result. Name
the ones your four answers imply, then cross them with the archetypes: the same
flow performed by "first evening" and by "two months in" is two different tests,
and usually only one of them is being run.

Give each flow a provenance: **exploratory**, **spec**, **archetype**, or **bug
report**. This costs one column and it is the cheapest honesty check available —
if the list is mostly "bug report", the user-first step did not happen, whatever
the document is titled. Nobody can see that without the column, including you.

Bug reports are still valuable, and they are read *after* this list exists and is
written down. They may add flows; they may not define the list. Each escaped bug
contributes a *class* of test, not a single case — "assert the stored date is
today" fixes one bug, "after any write, assert every field the user supplied and
every field the system derived" closes the blind spot. Apply each new class
backwards over what you already covered, and say plainly which existing tests it
demotes to samples.

---

## 5. Two environments, and why both are right

`test-data-management` teaches that each test owns its data, minimises it, cleans
it up, and that shared mutable data is an anti-pattern. That guidance is correct,
and it is correct for the layer it was written for. Applied to every layer, it
guarantees the app is only ever tested on its first five minutes.

Run both environments, deliberately:

**Fresh-account environment** — one signup per test, minimal hand-picked data,
torn down after. Use it for anything where the point is that a mechanism is
correct in isolation: unit tests, endpoint contracts, validation, auth, error
shapes, single-behaviour regressions. Determinism matters more than realism here,
and the existing suite is right to work this way. Do not destabilise passing
tests by making them share state.

**Lived-in environment** — accounts that carry weeks or months of accumulated
history, kept and built on rather than created and dropped. Use it for journeys,
for anything the AI touches, and for every archetype in section 3 that is not
"first evening". This is where the product's actual promises live, and there is
currently no substitute for it.

A test that could pass on an empty account tells you nothing about an account
with history. If the only environment is fresh, that gap is invisible — which is
exactly how it stayed invisible here.

### Building the lived-in environment honestly

There is a real tension: driving months of history through the real AI is slow
and costs money, and seeding rows straight into the database is fast but risks
testing a fiction. Resolve it by splitting the two:

- **Seed the bulk directly** — the background history, the hundreds of prior
  expenses, the category sprawl. Fast and cheap.
- **Drive the interaction under test through the real path** — the message being
  parsed, the draft being confirmed, the edit being matched. That is the part
  whose correctness you are actually claiming.

Whatever you seed must be indistinguishable from what the app itself would have
produced: the same shapes, real category ids owned by that user, dates that fall
where they plausibly would. Seeded data the app could never have created makes
every test built on it meaningless, in a way that still passes.

This matters especially here because the assistant is handed the user's real
categories and recent expenses as context on every message. Its behaviour is a
function of the account's history, so the history is not scenery around the test
— it is an input to the thing being tested.

---

## 6. The tests that only exist at volume

These have no meaning on a fresh account, which is why a fresh-account suite will
never contain them. Design them against the lived-in environment:

- **Consistency over time** — does the same kind of expense land in the same
  category the fortieth time as the fourth? Drift here is silent and corrodes
  every number on the dashboard.
- **Near-duplicates** — with thirty similar entries, does an edit or delete
  request find the right one, or the most recent one by luck?
- **Ambiguity that only exists with history** — a description that matches three
  past expenses, or a new category name that nearly matches two existing ones.
- **Degradation** — does matching, parsing, or categorising get *worse* as
  history grows? A behaviour that is correct at five rows and wrong at five
  hundred passes every test you currently have.
- **Volume in the interface** — what the screens do when the data behind them is
  real: what is shown, what is silently cut off, whether the user can tell that
  something was cut off.
- **Accumulated invariants** — the rules from question 4, checked across the
  whole history rather than the row just written. No expense anywhere under a
  category its owner never agreed to.

---

## 7. Judging whether coverage is enough

Never answer this by looking at what you built. Coverage compared against your
own output, or against the bug list you derived it from, always looks complete —
that is a property of the comparison, not of the suite.

Judge it against the grid instead: **archetypes × flows × the invariants**. Name
the cells that have nothing in them. A number of tests is not an answer to this
question, and "enough for now" is only a real answer when it names what is
uncovered and why that risk is acceptable today.

Say plainly which of your existing tests are **samples** rather than coverage — a
single happy-path walk of a flow, a mechanism proven on two rows, an endpoint
exercised with a hand-written payload no real client would send. A sample is
useful and worth keeping. Calling it coverage is the mistake.

---

## Done when

- Field notes from an exploratory session exist under `qa/`, written before any
  spec or bug-report reading this run, and what they changed downstream is stated.
- The four questions are answered in writing, from what you saw.
- The archetypes are named, with what their accounts hold.
- Both environments exist and it is stated which tests use which.
- The flow list exists, crossed with archetypes, every row carrying its
  provenance.
- Any flow whose only coverage is one happy-path walk is labelled a sample, in
  writing, in the report.
- The uncovered cells of the grid are named — not counted.
