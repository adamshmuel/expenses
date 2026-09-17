# Expenses

A home budget web app. You track spending by talking to it — no forms, no
"add expense" button. Type what happened in plain language, an AI turns it
into a structured expense or category action, you confirm it, and it's
saved. A second screen shows the numbers.

Final project for the Node.js part of a fullstack course, built in 6 working
days.

## What it does

**`/home` — the chat.** The only place anything changes. Type things like:

- `spent 45 on lunch at Cafe Aroma`
- `rename Fuel to Gas`
- `delete the coffee expense from yesterday`
- `reset my categories`

The AI reads the message, proposes what it understood, and shows a confirm
button. Nothing is written to the database until you press it. If the AI
finds more than one matching expense for an edit or delete, it lists them and
asks which one.

**`/dashboard` — read-only.** Total spent, number of expenses, number of
categories used, a breakdown by category, and a list of recent expenses — all
for a selected date range. No edit or delete controls here; everything is
changed through the chat.

Full behaviour, edge cases and the reasoning behind them are written up in
[`docs/specs/`](docs/specs/), starting at
[`00-overview.md`](docs/specs/00-overview.md).

## Stack

| Part | Tech |
|---|---|
| Server | Node.js, Express, MongoDB (Mongoose) |
| AI | Gemini Flash Lite, via `@google/genai` |
| Client | React, TypeScript, Redux Toolkit, Vite |
| Auth | JWT access + refresh tokens, bcrypt, HttpOnly cookies |

## Running it

You need a MongoDB connection string and a Gemini API key.

**Server:**

```bash
npm install --prefix backend
```

Create `backend/.env`:

```bash
PORT=3000
MONGODB_URI=<your MongoDB connection string>
JWT_SECRET=<any random string>
REFRESH_TOKEN_SECRET=<a different random string>
GEMINI_API_KEY=<your Gemini API key>
CLIENT_ORIGIN=http://localhost:5173
```

```bash
npm run dev --prefix backend      # http://localhost:3000
```

**Client**, in a second terminal:

```bash
npm install --prefix client
npm run dev --prefix client       # http://localhost:5173
```

The client expects the server at `http://localhost:3000/api`. To change
that, copy `client/.env.example` to `client/.env`.

Open `http://localhost:5173`, sign up, and start typing expenses into the
chat.

## Tests

```bash
node --test backend/ai/__tests__/*.test.js   # the AI parsing layer
npm test --prefix client                     # the React app
```

## Course topics → where they're used

Adam wrote the server (`backend/`, everything except `backend/ai/`) himself,
at a beginner's pace, as the graded part of the course. Claude wrote the AI
layer (`backend/ai/`) and the React client (`client/`). Full detail and
reasoning for each row is in the "Course-topic coverage" section of the
linked spec.

### Node.js / Express — server-side topics

| Course topic | Demo | Where |
|---|---|---|
| Express basics | 9 | The server itself — [`07-server-entry.md`](docs/specs/07-server-entry.md) |
| DAL / BL / route layers | 8 | `route → bl/service → dal/repository → model`, every feature — [`05`](docs/specs/05-user-layers.md), [`09`](docs/specs/09-expense-category-service.md) |
| Routes, router per resource | 10, 15 | `routes/userRoute.js`, `routes/chat.js`, `routes/expenses.js`, `routes/categories.js` |
| Route params | 11 | `GET /expenses/:id`-style lookups after a chat match |
| Query string | 12 | `GET /expenses?from=&to=`, `GET /chat/messages?limit=` |
| CRUD | 13 | Expenses, categories, and messages, all through the chat |
| Middleware | 14 | `requireAuth` on `/chat`, `/expenses`, `/categories` |
| Error handling, `catchAsync` | 16 | One central error handler — [`06-server-modules.md`](docs/specs/06-server-modules.md) |
| CORS, static, dotenv | 17 | Server setup; secrets in `.env` |
| Mongoose | 18 | `User`, `Message`, `Category`, `Expense`, `RefreshToken` |
| bcrypt + JWT | 19 | Signup, login, access/refresh tokens |
| Advanced middleware (factory) | 20 | `requireAuth` written as a factory |
| Winston, separate error log | 21 | `.config/logger.js`; AI calls logged apart |
| express-validator | 22 | Signup/login bodies, async "already taken" checks, empty-message guard |
| Population | 23 | Messages populate their author; expenses their category |
| Advanced security | 24 | helmet, login rate limit, HttpOnly cookie, refresh-token rotation |
| CORS in depth | 27 | Locked to the client's exact origin |
| Async / error handling | JS fundamentals | Every route |

### React — client-side topics

| Course topic | Where |
|---|---|
| Components and props | Every screen |
| Events | Buttons and submits |
| State | Form fields, the draft list |
| Conditional rendering | Navbar state, loading, errors, empty chat |
| Lifting state up | Chat input and draft list |
| Axios | The API layer, including refresh-and-retry on an expired access token |
| Forms | Signup, login, chat input |
| Lifecycle / effects | Loading chat history on entering `/home` |
| React Router | The four routes, plus a protected-route wrapper |
| React Redux | `authSlice`, `chatSlice` |
| TypeScript | The whole client |

Not used: `path`, streams, Socket.io — still open for a future `/dashboard`
feature.

## Project layout

```
backend/         Adam's Express server
backend/ai/      The Gemini call — Claude's code, plain functions Adam's server calls
client/          The React app — Claude's code
docs/specs/      What the app does and why
docs/plans/      How each spec was built, in TDD order
.claude/rules/   The working agreement between Adam and Claude on this repo
```
