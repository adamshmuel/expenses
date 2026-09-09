# 03 — API contract

Status: **v1 auth section is final — the client is already built against it.**
The chat and expense endpoints are still open.

This is the line between Adam's server and Claude's client. Neither side changes
it alone.

## 0. Ground rules

| Thing | Value |
|---|---|
| Base URL | `http://localhost:3000/api` |
| Client origin | `http://localhost:5173` |
| Body format | JSON |
| Access token | sent by the client as `Authorization: Bearer <token>` |
| Refresh token | an **HttpOnly cookie** set by the server. The client never reads it |

### CORS

The client sends cookies, so a wildcard origin will **not** work. The server
must answer with the exact origin and allow credentials:

```js
cors({ origin: 'http://localhost:5173', credentials: true })
```

If this is wrong, login appears to work and then the refresh silently fails.

### Two error shapes, and only two

The client understands exactly these. Anything else becomes a generic message.

**A general failure** — wrong password, not found, server error:

```json
{ "error": "Username or password is incorrect." }
```

**A validation failure** — one entry per bad field:

```json
{ "errors": [
  { "field": "email", "message": "That email is already registered." },
  { "field": "username", "message": "Username must be 3–20 characters." }
] }
```

`field` must match the request body key exactly (`username`, `email`,
`password`) — that is how the client puts the message under the right input.

express-validator does not produce this shape by itself. Map it:

```js
const result = validationResult(req)
if (!result.isEmpty()) {
  return res.status(400).json({
    errors: result.array().map(e => ({ field: e.path, message: e.msg }))
  })
}
```

## 1. Auth endpoints — v1

### `POST /api/auth/register`

Request:

```json
{ "username": "adam", "email": "adam@example.com", "password": "password123" }
```

Success — **201**:

```json
{
  "user": { "id": "665f...", "username": "adam", "email": "adam@example.com" },
  "accessToken": "<jwt>"
}
```

Also sets the refresh-token cookie.

| Status | When |
|---|---|
| 201 | Created |
| 400 | Validation failed → the `errors` shape |
| 409 | Username or email taken → may also use the `errors` shape, so the message lands on the field |

Rules: hash the password with bcrypt; never return the `password` field;
username 3–20 chars, unique; email valid, unique; password at least 8 chars.
The "already taken" checks are custom async validators.

### `POST /api/auth/login`

Request:

```json
{ "username": "adam", "password": "password123" }
```

Success — **200**, same body as register, and sets the refresh cookie.

| Status | When |
|---|---|
| 200 | Logged in |
| 400 | A field was missing → the `errors` shape |
| 401 | Wrong username **or** wrong password → `{ "error": "Username or password is incorrect." }` |

The 401 message must not say which one was wrong. Rate-limit this route more
strictly than the rest of the API.

### `POST /api/auth/refresh`

No request body. The browser sends the cookie automatically.

Success — **200**. **It must return the user as well as a new token**, because
after a page reload the client has no user in memory:

```json
{
  "user": { "id": "665f...", "username": "adam", "email": "adam@example.com" },
  "accessToken": "<new jwt>"
}
```

| Status | When |
|---|---|
| 200 | Refreshed |
| 401 | No cookie, expired, or revoked |

The client calls this in two situations:

1. **On start-up**, once. A 401 here is normal and silent — it just means
   "nobody is logged in", and the login screen appears. It must not be logged as
   an error.
2. **After any 401 on another request.** The client retries the original request
   once with the new token. If the refresh fails too, the user is logged out.

### `POST /api/auth/logout`

No body. Invalidate the refresh token and clear the cookie.

| Status | When |
|---|---|
| 204 | Logged out |

The client clears its own state regardless of the answer, so an error here is
harmless — but the cookie must actually be cleared server-side.

## 2. What the client already does

Built and tested. No further client work is needed for these.

| Behaviour | Where |
|---|---|
| Sends `Authorization: Bearer` on every request | `client/src/api/httpClient.ts` |
| Refreshes once on a 401 and retries | `client/src/api/httpClient.ts` |
| Keeps the access token in memory only | `client/src/api/tokenStore.ts` |
| Calls `/auth/refresh` on start-up | `client/src/App.tsx` |
| Maps `errors[]` to individual fields | `client/src/api/httpClient.ts` |
| Redirects logged-out users away from `/home` | `client/src/components/ProtectedRoute.tsx` |

To point the client at a different port, copy `client/.env.example` to
`client/.env` and change `VITE_API_URL`.

## 3. Not yet agreed

These come from `01-ai-chat.md` and `02-dashboard.md` and are **not** built on
either side:

| Purpose | Likely route |
|---|---|
| Send a chat message, get drafts back | `POST /api/chat/messages` |
| Load chat history | `GET /api/chat/messages?limit=` |
| Save confirmed expenses | `POST /api/expenses` |
| Category CRUD | `/api/categories` — deferred to v2 |
| Statistics | `GET /api/expenses/summary?period=` |

The data model behind all of them is agreed and written up in
[04-data-model.md](04-data-model.md).
