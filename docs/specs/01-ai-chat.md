# 01 — Home and auth

Status: **draft — needs Adam's approval.**

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
the same for everyone. From there each user can:

1. add their own categories and subcategories
2. edit them
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

The user records an expense by writing it the way they would say it, instead of
filling in a form.

### The flow

1. On entering the page, the last messages are loaded and shown, oldest first.
2. The user types a message. Example: `spent 50 at the supermarket`.
3. The client sends the text to the server. **Request one.**
4. The server saves the user's message, passes the text to `backend/ai/`, saves
   the reply as an assistant message, and returns both the reply and a list of
   **draft** expenses: amount, store, date, category.
5. The client shows the drafts and asks the user to confirm.
6. On confirm, the client sends the drafts back to be saved. **Request two.**
7. On cancel, nothing is saved. The messages stay in the history.

Two requests, not one. Parsing and saving are separate so that nothing reaches
the expenses collection without the user agreeing to it.

### Rules

- **Never save without the user confirming.** This is the core rule of the
  screen.
- One message may contain several expenses. Show them as a numbered list and ask
  to confirm **once**, not one by one.
- The model never invents an amount. If the amount is missing from the text, the
  draft is incomplete and the app asks for it.
- Default when the text does not say: the date is today.
- A draft's category must be one of the user's existing categories, or clearly
  marked as a new one the user is agreeing to create.

## 7. Cases to handle

### Chat

| Case | Behaviour |
|---|---|
| Text is not an expense at all | Say so. Save nothing |
| Amount missing | Ask for the amount. Save nothing |
| Several expenses in one message | Numbered list, one confirmation |
| The AI call fails or times out | Show an error. The user's text is not lost |
| The user cancels | Nothing is saved |
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

One function. Claude writes it; Adam's server calls it.

- **Input:** the user's text.
- **Output:** a list of draft expenses (amount, store, description, date,
  category), plus a short reply to show in the chat.
- It calls Gemini Flash Lite and asks for a fixed response shape, so the result
  is data and not free prose.
- **It never touches the database.** It receives text, returns objects. Saving is
  the server's job.
- It never throws a raw provider error at the route. A failure comes back as a
  clear result the route can turn into a `502`.
- The Gemini API key lives in `.env` and never reaches the client.

## 9. Course-topic coverage

Why each part is here. Source:
[../reference/course-topics.md](../reference/course-topics.md).

### Node.js — Adam's side

| Course topic | Demo | Where it is used |
|---|---|---|
| Express basics | 9 | The server itself |
| Routes | 10 | `/users/*`, `/chat/*`, `/expenses` |
| Route params | 11 | `PUT /categories/:id`, `DELETE /categories/:id` |
| Query string | 12 | `GET /chat/messages?limit=` |
| CRUD | 13 | Create and read messages; create expenses |
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

1. Where category management lives. The four abilities above need a screen, and
   it is not one of the four routes in this spec. Either a `/categories` route,
   or a panel inside `/home`.
2. How many messages `/home` loads on entry.

## Decided and closed

- Chat history is **read-only**. `DELETE /chat/messages/:id` was dropped:
  deleting a message does not delete the expense it created, so it looks like an
  undo and is not one. See `.claude/rules/product-first.md`.
- Categories start from a shared default set, and each user can add, edit,
  delete, and reset them.
