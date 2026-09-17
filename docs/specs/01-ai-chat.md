# 01 — Home and auth

Status: **approved.**

Covers the first half of the app: the AI chat and the login screens around it.
`/dashboard` is specified separately in [02-dashboard.md](02-dashboard.md).

## 1. Routes

| Route | Access | What it is |
|---|---|---|
| `/signup` | public | Register form |
| `/login` | public | Login form |
| `/home` | logged in only | The AI chat |
| Navbar | every page | Shared shell; changes when logged in |

A logged-out user who opens `/home` is sent to `/login`. A logged-in user who
opens `/login` or `/signup` is sent to `/home`.

## 2. Data used by these routes

Field-level detail (types, indexes, validation) lives in
[03-api-contract.md](03-api-contract.md). This is what each route needs.

| Model | Fields it needs here |
|---|---|
| `User` | username (unique), email (unique), password (hashed) |
| `Message` | text, role (`user` / `assistant`), author (ref → User), createdAt |
| `Category` | name, parent (a main category, or none), owner (ref → User) |
| `Expense` | amount, store, description, date, category (ref → Category), user (ref → User) |

A password is never sent back to the client, in any response.

### Categories

Every new user starts with a set of **default categories and subcategories**,
the same for everyone. From there each user can, through the chat (§6), same as
expenses:

1. add their own categories and subcategories
2. rename them
3. delete them
4. reset back to the defaults

Categories are two levels deep: a main category, and subcategories under it.

How this is stored is decided in [04-data-model.md](04-data-model.md): one
`Category` collection with a `parent` field, one set copied per user at sign-up,
and deleting a category moves its expenses to "Other" rather than losing them.

## 3. `/signup`

**Form:** username, email, password, confirm password.

**Validation, on the server:**

| Field | Rule |
|---|---|
| username | required, 3–20 characters, not already taken |
| email | required, valid email, not already taken |
| password | required, at least 8 characters |

The "not already taken" checks are custom asynchronous validators — they query
the database.

The client also checks that the two password fields match, before sending.

**On success:** the account is created, the password stored hashed with bcrypt,
and the user is logged in straight away and sent to `/home`.

**On failure:** the server returns the field-by-field errors, and the form shows
each message under its own field. Nothing already typed is lost.

## 4. `/login`

**Form:** username, password.

**On success the server returns two tokens:**

| Token | Lifetime | Where it is kept |
|---|---|---|
| access | short (minutes) | client memory only (Redux). Never `localStorage` |
| refresh | long (days) | an HttpOnly cookie, set by the server |

The access token is sent on every request as `Authorization: Bearer <token>`.

**When the access token expires mid-session:** the server answers `401`. The
client calls `/users/refresh` once, gets a fresh access token, and retries the
original request. The user notices nothing. If the refresh also fails, the user
is logged out and sent to `/login`.

**On wrong username or password:** one generic message — "username or password
is incorrect". The response never reveals which of the two was wrong.

**Rate limiting:** the login route is limited more strictly than the rest of the
API, to slow down password guessing.

## 5. Navbar

Shown on every page.

| State | What it shows |
|---|---|
| Logged out | App name, and links to Login and Signup |
| Logged in | App name, links to Home and Dashboard, the username, and Logout |

**Logout** clears the access token from memory, tells the server to invalidate
the refresh token, and returns to `/login`.

## 6. `/home` — the chat

**The chat is the only place the user changes anything.** There is no other
screen with an edit, delete, or reset button, for an expense or for a
category. The user writes what they want in plain language, and the AI turns
it into one of eight intents — seven that change something, and one, added in
V2, that only answers ([10-chat-questions.md](10-chat-questions.md)):

| Intent | Example |
|---|---|
| Create an expense | `spent 50 at the supermarket` |
| Edit an expense | `change that IKEA expense to 200`, `move the coffee expense to Entertainment` |
| Delete an expense | `delete the coffee from yesterday` |
| Create a category | `add a subcategory called Pets under Home` |
| Edit a category | `rename Fuel to Gas` |
| Delete a category | `delete the Gym subcategory` |
| Reset categories to defaults | `reset my categories` |
| **Answer a question** (V2) | `how much did I spend on Food this month` |

`/dashboard` ([02-dashboard.md](02-dashboard.md)) shows the result. It never
writes.

Whichever of the **seven writing** intents it is, nothing changes in the
database until the user confirms — this is the core rule of the screen. The
eighth, `answer-question`, changes nothing at all, so it has no confirm step
and no second request; see [10-chat-questions.md](10-chat-questions.md) §1.

### Create — the flow

1. On entering the page, the last 50 messages are loaded and shown, oldest
   first. No pagination — a flat, fixed limit.
2. The user types a message. Example: `spent 50 at the supermarket`.
3. The client sends the text to the server. **Request one.**
4. The server saves the user's message, passes the text to `backend/ai/`, saves
   the reply as an assistant message, and returns both the reply and a list of
   **drafts** — new expenses (amount, store, date, category) or a new category
   (name, parent).
5. The client shows the drafts and asks the user to confirm.
6. On confirm, the client sends the drafts back to be saved. **Request two.**
7. On cancel, nothing is saved. The messages stay in the history.

Two requests, not one. Parsing and saving are separate so that nothing reaches
the database without the user agreeing to it.

### Edit and delete — the flow

The user refers to an existing expense or category in plain language instead
of picking it from a list.

1. The client sends the text to the server, same as create. **Request one.**
2. The server passes the text to `backend/ai/`, along with the user's
   categories and recent expenses (see §8). The AI returns an intent (`edit` or
   `delete`, for an expense or a category), plus `searchFilters` — the terms it
   pulled out of the text to find what the user means (e.g. `{ text: "coffee",
   from: <yesterday>, to: <yesterday> }` for an expense, `{ text: "Fuel" }` for
   a category). An edit also carries `changes`, the new field values. Moving an
   expense to a different category is an ordinary edit whose `changes.category`
   is a category **name** — see §8.
3. The server runs `searchFilters` through `queryExpenses` or
   `getCategoriesByUser` ([08-expense-category-dal.md](08-expense-category-dal.md)),
   against that user's own data only.
4. The client shows what matched:
   - **No match** — say so. Nothing to confirm.
   - **One match** — show it and the proposed change (or "delete this?"), ask
     to confirm.
   - **Several matches** — show them as a numbered list, ask the user to pick
     one first, then show the proposed change and ask to confirm.
5. On confirm, the client sends the chosen id and the change back. **Request
   two.** The server calls `updateExpense`/`deleteExpense` or
   `updateCategory`/`deleteCategory`.
6. On cancel, nothing changes.

Same two-request shape as create, and the same confirm rule — picking a match
is not confirming the change, it only narrows down which record the next
confirmation applies to.

### Reset categories — the flow

There is nothing to search for or pick: the intent applies to all of the
user's categories at once. Shortest of the seven writing intents.

1. The client sends the text to the server. **Request one.**
2. The server passes the text to `backend/ai/`, which returns `{ intent:
   'reset-categories' }` and a reply asking the user to confirm — this is
   destructive, every expense pointing at a deleted category moves to "Other".
3. On confirm, the client asks the server to reset. **Request two.** The server
   calls `deleteCategoriesByUser` then `createManyCategories` with the default
   set ([04-data-model.md](04-data-model.md)).
4. On cancel, nothing changes.

### Rules

- **Never change the database without the user confirming.** For every intent,
  expense or category alike.
- One message may contain several new expenses. Show them as a numbered list
  and ask to confirm **once**, not one by one.
- The model never invents an amount. If the amount is missing from the text, the
  draft is incomplete and the app asks for it.
- Default when the text does not say: the date is today.
- A draft expense's category must be one of the user's existing categories, or
  clearly marked as a new one the user is agreeing to create.
- An edit or delete can only ever match the logged-in user's own expenses or
  categories — every DAL lookup is scoped by `userId` first.
- Category rules from [04-data-model.md](04-data-model.md) apply the same as if
  typed by hand: two levels only, no duplicate name under the same parent, and
  "Other" cannot be renamed or deleted. A request that would break one of these
  is refused in the chat reply, not silently adjusted.

## 7. Cases to handle

### Chat

| Case | Behaviour |
|---|---|
| Text does not match any of the eight intents | Say so. Nothing changes |
| A statement is misread as a question, or the reverse (V2) | The one genuinely new failure V2 introduces — `spent 50 on coffee` and `how much on coffee` are close. See [10-chat-questions.md](10-chat-questions.md) §5 |
| Amount missing (create expense) | Ask for the amount. Save nothing |
| Several expenses in one message | Numbered list, one confirmation |
| Edit/delete matches nothing | Say so. Nothing to confirm |
| Edit/delete matches several records | Numbered list, user picks one, then confirms the change |
| A category action would break a rule (three levels, duplicate name, editing "Other") | Say so in the reply. Nothing changes |
| The AI call fails or times out (provider unreachable) | Show an error, `502`. The user's text is not lost |
| The model responds but the content is unusable (garbled, empty, oversized, wrong script) | Retry once, identical request; still bad → refuse with "try rephrasing", not a `502`. See §8 |
| The user cancels | Nothing changes |
| No messages yet | An empty state, not a blank screen |

### Auth

| Case | Behaviour |
|---|---|
| Wrong username or password | One generic message |
| Username or email already taken | Error under that field |
| Passwords do not match | Caught in the client, before sending |
| Access token expired | Refresh once and retry, invisibly |
| Refresh failed | Log out, go to `/login` |
| Not logged in, opens `/home` | Redirect to `/login` |
| Server unreachable | An error message, and a way to try again |

## 8. What `backend/ai/` exposes

One function in V1. V2 adds a second, `answerQuestion`, used only by the
`answer-question` intent ([10-chat-questions.md](10-chat-questions.md) §4).
Claude writes both; Adam's server calls them.

- **Input:** the user's text, the user's categories, and the user's recent
  expenses (e.g. last 30 days) — plain data the route already fetched via the
  DAL ([08-expense-category-dal.md](08-expense-category-dal.md)). The category
  list is what lets the AI resolve a category **by name** for both a new
  expense's category and an edited expense's `changes.category` — the route
  never does a second lookup for that; it matches the name against the same
  list it already passed in.
- **Output:** one of eight shapes, by intent — the intent name says which
  entity (expense or category) and which action (create, edit, delete, reset):

  | Intent | Output |
  |---|---|
  | `create-expense` | a list of draft expenses (amount, store, description, date, category) |
  | `edit-expense` | `searchFilters` (to find the expense via `queryExpenses`) and `changes` — new field values; `changes.category`, if present, is a category **name**, not an id |
  | `delete-expense` | `searchFilters` (to find the expense) |
  | `create-category` | a draft category (name, parent — a main category name, or none) |
  | `edit-category` | `searchFilters` (to find the category via `getCategoriesByUser`, matched by name) and `changes` (new name) |
  | `delete-category` | `searchFilters` (to find the category) |
  | `reset-categories` | nothing to search or match — applies to all of the user's categories |
  | `answer-question` (V2) | a `question` object — a shape (`total`/`list`) plus filters — for the server to run. See [10-chat-questions.md](10-chat-questions.md) §4 |

  Every response also carries a short reply to show in the chat.
- It calls Gemini Flash Lite and asks for a fixed response shape, so the result
  is data and not free prose.
- **It never touches the database.** It receives data, returns objects. Running
  `searchFilters` as a query, resolving a category name to an id, and saving,
  editing, or deleting, are all the server's job.
- It never throws a raw provider error at the route. A failure comes back as a
  clear result the route can turn into a `502`.
- The Gemini API key lives in `.env` and never reaches the client.

### The model never claims something happened

`backend/ai/` only ever produces the reply for **request one** — the parse.
It has no visibility into whether the user goes on to confirm, or into
whether the resulting write succeeds. So its reply is never phrased in a way
that could be read as "done", in any tense — not "I've added it", not "added",
not "saved". It describes what it is **proposing**, and the confirm button is
what the user reads as the commit point.

This applies the same way to a correction ("actually make that 30, not 25")
mid-conversation: the reply is derived from the updated draft fields, not
composed separately — so an acknowledgement can never say one thing while the
payload underneath it holds the old value.

An edit or delete reply is worded conditionally on there being a match
("I'll delete the coffee expense, if I've got the right one" rather than "the
coffee expense is deleted") — the search itself runs server-side, after the
model has already produced its reply, so it cannot know at reply-time whether
anything matched.

### Malformed model output never reaches the user unfiltered

Gemini Flash Lite occasionally degenerates: an amount like `-50` or an amount
with sub-agora precision (`10.005`) slipping past the requested schema,
reasoning text leaking into a field meant to hold a final value, a reply in
an unsupported script, or a response that is empty, oversized, or not the
JSON shape `parseMessage` asked for. None of these are the provider being
unreachable — the call succeeds, the content is just unusable. `backend/ai/`
treats them as a distinct failure mode from "the API is down":

- The user's **raw text**, not the model's echo of it, is checked for a
  leading `-` before an amount — the guard reads from the one place that
  can't have been altered by the model.
- A parsed amount with more than two decimal places is rejected the same way.
- A response with no usable text, an empty draft, a suspicious/leaked field,
  a reply over 5000 characters, or characters outside the supported script
  ranges (Hebrew included, per the app's bilingual support) is treated as
  **garbled**, not passed through.
- On a garbled response, `parseMessage` retries **once** with an identical
  request before giving up — Gemini Flash Lite's failures on this app's
  traffic are transient roughly 1 time in 5, and one retry cuts the
  user-visible rate to roughly 1 in 25. A second failure in a row is reported
  to the user as a refusal to parse ("that didn't come out right, try
  rephrasing"), not a `502` — the provider answered, it just didn't answer
  usably. Every attempt is logged, so the real failure rate stays visible
  without guessing.
- On the client, a draft that comes back with a field the guards couldn't
  make sense of, but that isn't missing something the user is expected to
  supply (like a missing amount, which is a normal, silent case), shows an
  explicit "couldn't read part of the reply, try rephrasing" message rather
  than a silently empty draft.

## 9. Course-topic coverage

Why each part is here. Source:
[../reference/course-topics.md](../reference/course-topics.md).

### Node.js — Adam's side

| Course topic | Demo | Where it is used |
|---|---|---|
| Express basics | 9 | The server itself |
| Routes | 10 | `/users/*`, `/chat/*`, `/expenses`, `/categories` |
| Route params | 11 | `GET /expenses/:id`-style lookups used internally after a chat match |
| Query string | 12 | `GET /chat/messages?limit=` |
| CRUD | 13 | Create and read messages; create/edit/delete expenses and categories, all via chat |
| Middleware | 14 | `requireAuth` on `/chat` and `/expenses` |
| Router per resource | 15 | `routes/userRoute.js`, `routes/chat.js`, `routes/expenses.js` |
| Error handling | 16 | `catchAsync` plus one central error handler |
| CORS, static, dotenv | 17 | Server setup; the Gemini key in `.env` |
| Mongoose | 18 | `User`, `Message`, `Category`, `Expense` |
| bcrypt + JWT | 19 | Signup and login |
| Advanced middleware | 20 | `requireAuth` written as a factory |
| Winston | 21 | Request log, separate error log, AI calls logged apart |
| express-validator | 22 | Signup and login bodies; async "is it taken" checks |
| Population | 23 | Messages populate their author; expenses their category |
| Advanced security | 24 | helmet, login rate limit, CSRF on refresh, HttpOnly cookie, token rotation |
| CORS in depth | 27 | Locked to the client's origin only |
| DAL / BL layers | 8 | `route → bl → dal → model`, as in his `ex6_mongodb` |
| Async and error handling | JS | Every route |

### React — Claude's side

| Course topic | Demo | Where it is used |
|---|---|---|
| Components and props | React 1 | Every screen |
| Events | React 2 | Buttons and submits |
| State | React 3 | Form fields, the draft list |
| Conditional rendering | React 5 | Navbar state, loading, errors, empty chat |
| Lifting state up | React 6 | Chat input and draft list |
| Axios | React 7 | The API layer, including refresh-and-retry on 401 |
| Forms | React 8 | Signup, login, chat input |
| Lifecycle / effects | React 9 | Loading history on entering `/home` |
| React Router | React 10 | The four routes, plus a protected-route wrapper |
| React Redux | React 11 | `authSlice`, `chatSlice` |
| TypeScript | React TS | The whole client, as in his `tv-show-app` |

### Not used by these routes

`path` (demo5), streams (demo25), Socket.io (demo26). Streams and Socket.io are
still open for `/dashboard`.

## 10. Open questions

None.

## Decided and closed

- Chat **history** (the `Message` collection — what was typed and replied) is
  **read-only**. `DELETE /chat/messages/:id` was dropped: deleting a message
  does not delete the expense it created, so it looks like an undo and is not
  one. See `.claude/rules/product-first.md`. This is separate from editing or
  deleting an **expense** through the chat (§6), which is in scope — the
  message log itself is still never edited or deleted, only the expense it
  led to.
- Categories start from a shared default set. There is no separate category
  screen — every change to a category, like every change to an expense, goes
  through the chat. See §6.
- Expenses and categories can both be created, edited, and deleted through the
  chat, all with confirmation first. See §6.
