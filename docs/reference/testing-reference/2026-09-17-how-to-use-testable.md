# `/how-to-use` — the tutorial page, and the extractions it produced

A genuinely new area of `client/`: a public tutorial page, plus three
presentational components pulled out of `HomePage` and `DashboardPage` so the
page can show the real UI instead of a copy of it. That sharing is the part
worth testing hardest — it means a change to the chat or the dashboard now
changes the tutorial too.

Governed by `docs/specs/12-how-to-use.md` (approved 2026-09-17).

## Derivation state

| Covers | Derived against | Notes |
|---|---|---|
| `client/` growth for the tutorial page, and the client/backend fixes that landed the same day | working tree at 2026-09-17, **uncommitted** | Read directly: `App.tsx`, `NavBar.tsx`, `HowToUsePage.tsx`, `TutorialLesson.tsx`, `ChatScreen.tsx`, `DashboardTotals.tsx`, `CategoryBreakdown.tsx`, `hooks/`, `lib/dashboardFormat.ts`, `index.css`. Suite verified in the main session: `npm test --prefix client` → 108/108. Page verified live at desktop and 375px. |

## What exists now

### The page and its parts

| What | Where | Governed by | What it invites |
|---|---|---|---|
| `/how-to-use` route, **public**, outside `ProtectedRoute` | `client/src/App.tsx` | 12 §1 | Renders with no user, no token, no store data. The one route where a logged-out visitor must get a full page rather than a redirect — worth asserting from a genuinely empty state, not a cleared one. |
| "How to use" nav link, in **both** navbar states | `client/src/components/NavBar.tsx` | 12 §1, 01 §5 | The `.navbar__links` block used to exist only when logged in; it now renders logged out too. Both states, and the wrap behaviour below 480px with five items. |
| `HowToUsePage` — opening, four lessons, example sentences, closing CTA | `client/src/components/HowToUsePage.tsx` | 12 §2, §3 | The CTA changes by auth state (`/home` vs `/signup`). Both branches. |
| `TutorialLesson` — heading, caption, Replay, play-once-on-scroll, reduced motion | `client/src/components/TutorialLesson.tsx` | 12 §4 | Reused 4×. `IntersectionObserver` starts it; a `playToken` remount restarts it. Timers and observers need teardown — a test that unmounts mid-animation is the one that finds a leak. |
| `useTypedText`, `usePrefersReducedMotion` | `client/src/hooks/` | 12 §4 | Typing is state on a timer, not CSS. Reduced motion is read once per mount. |

### The extractions — the risky part

These were pulled **out of** working screens so the tutorial could reuse them.
`HomePage.test.tsx` and `DashboardPage.test.tsx` were deliberately left
unedited and still pass, which is the evidence the refactor was behaviour-
preserving. Anything that tests these now tests two screens at once.

| Component | Pulled from | Now used by | What it invites |
|---|---|---|---|
| `ChatScreen` | `HomePage.tsx` | `HomePage` (real data), `TutorialLesson` (scripted) | Presentational, no Redux and no network. A regression here breaks the real chat and the tutorial together. Worth asserting it renders identically from both callers. |
| `DashboardTotals`, `CategoryBreakdown` | `DashboardPage.tsx` | `DashboardPage`, lessons 3 and 4 | Same. `CategoryBreakdown` carries the expand/collapse the dashboard depends on. |
| `money()` | new, `client/src/lib/dashboardFormat.ts` | both of the above | The only shared money formatter. Rounding, zero, and large values. |

### CSS

`index.css` gained a `.dashboard-vars` class alongside `.dashboard-page`, so
the embedded dashboard pieces in lessons 3 and 4 pick up the serif/gold tokens
without the full page layout. The real dashboard is meant to look unchanged —
that claim is worth checking, not assuming.

## What was fixed the same day, and is not yet verified end to end

Landed in the working tree, unverified by any run. Listed here because the
tutorial page sits on top of the last of them.

| Fix | Where | Owner |
|---|---|---|
| Bugs 1, 2, 3, 5, 8 — false success claims, dropped corrections, sign and precision, unreadable drafts, phantom matches | `backend/ai/prompt.js`, `client/src/store/chatSlice.ts` | Claude |
| FR-42 — a totals question points at the dashboard instead of dead-ending | `backend/ai/prompt.js` | Claude |
| FR-43 — the reply is written in the user's own language | `backend/ai/prompt.js` | Claude |
| LV-15 — navbar wraps below 480px instead of overflowing. **Not dashboard-specific**: measured on `/home` too, and expanding a category changes nothing | `client/src/index.css` | Claude |
| FR-38 — nav tap targets ≥44×44, 6px clear between them | `client/src/index.css` | Claude |
| Bugs 4, 6, 7 — refresh race, empty message, expense with no label | `backend/bl/userService.js`, `backend/routes/chatRoute.js`, `backend/bl/expenseService.js` | Adam |
| FR-39 — signup wording matches spec 03 | `backend/routes/userRoute.js` | Adam |
| EH-05 — the 409 body names the field that actually clashed, from `err.keyValue` | `backend/error_handling.js` | Adam |
| XC-13 — `helmet()` mounted first, per spec 07 §2 | `backend/index.js` | Adam |

Two same-day changes were **reverted** after the specs were re-read: RA-06 and
XC-11 had been changed away from spec 06 §4 and spec 07 §4. The divergence
table in `qa/specs/README.md` had both stated backwards and is now corrected.
Anything deriving expected wording should read the `docs/specs/` file, not that
table.

## Known gaps in what has been checked

- The logged-in navbar with five items was not seen in a browser — component
  tests cover it, live verification did not.
- Nothing here has been through a QA run. The numbers above are a suite result
  and hand measurements, not a regression pass.
