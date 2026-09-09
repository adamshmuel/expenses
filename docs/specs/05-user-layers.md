# 05 — The user layers: repository, service, route

Status: **draft — needs Adam's approval.**

How the four auth endpoints from
[03-api-contract.md](03-api-contract.md) are built on Adam's server, split
into the three layers he practised in `ex6_mongodb`:

```
routes/userRoute.js   →   bl/userService.js   →   dal/userRepository.js   →   models
     (HTTP)                 (business logic)          (database only)
```

Each layer only ever calls the one below it. The route never imports the
repository; the repository never reads `req` or sends a response.

Adam writes all three files himself. This spec says **what each function does and
what it returns**, not how to write the code.

## 1. Why three layers

| Layer | Only job | Never does |
|---|---|---|
| `userRoute` | read the request, call the service, send the response, set/clear the cookie | talk to a model, hash a password, sign a token |
| `userService` | the rules: hash on signup, check the password on login, decide what a token carries, run the rotation | know about `req`, `res`, status codes, or cookies |
| `userRepository` | the four models (`User`, `RefreshToken`), every `find` / `save` / `delete` | know about `req`, hashing, or JWT signing |

This split is course topic **demo 8 (DAL / BL)**. It also means the login rules
can be unit-tested without starting Express.

## 2. What the endpoints are

From [03-api-contract.md](03-api-contract.md). The router mounts at
`/users` — no `/api` prefix, same as `ex6_mongodb`.

| Method + path | Purpose | Success |
|---|---|---|
| `POST /users/signup` | create an account, log in straight away | 201 |
| `POST /users/login` | log in | 200 |
| `POST /users/refresh` | trade the refresh cookie for a new access token | 200 |
| `POST /users/logout` | invalidate the refresh token | 204 |

The two success bodies for signup and login are identical:

```json
{
  "user": { "id": "665f...", "username": "adam", "email": "adam@example.com" },
  "accessToken": "<jwt>"
}
```

`refresh` returns the **same shape** (user + a new `accessToken`), because after
a page reload the client has no user in memory.

`logout` returns 204 with no body.

Every one of these also sets or clears the `refreshToken` HttpOnly cookie —
that is the route's job, see §6.

## 3. `dal/userRepository.js`

Talks to `User` and `RefreshToken`. Returns Mongoose documents or plain values.
Throws only real database errors — "wrong password" is not the repository's
concern, that is the service.

### Functions

| Function | Does | Returns |
|---|---|---|
| `createUser({ username, email, password })` | `new User(...).save()`. The `password` it receives is **already hashed** — the repository does not hash. | the saved `User` document |
| `findUserByUsername(username)` | `User.findOne({ username })` | the `User` document, or `null` |
| `findUserById(id)` | `User.findById(id)` | the `User` document, or `null` |
| `saveRefreshToken({ token, user, expiresAt })` | `new RefreshToken(...).save()` | the saved `RefreshToken` document |
| `findRefreshToken(token)` | `RefreshToken.findOne({ token })` | the `RefreshToken` document, or `null` |
| `deleteRefreshToken(token)` | `RefreshToken.deleteOne({ token })` | nothing meaningful (the delete result is fine) |

### Notes

- **No hashing, no JWT here.** Both belong to the service.
- `findUserByUsername` must return the document *with* the `password` field, so
  the service can compare against it. The `password` is stripped later, by the
  route, before the response goes out (§6).
- The unique-index errors from Mongo (`E11000`) surface here as thrown errors.
  The service or route turns them into the 409 / `errors` shape — decide which
  in §7.

## 4. `bl/userService.js`

The rules layer. Imports `userRepository`, `bcrypt`, `jsonwebtoken`. Never
imports a model directly.

### `signup({ username, email, password })`

1. Hash `password` with bcrypt (10 salt rounds, as in `ex6`).
2. `createUser` with the hashed password.
3. Issue a token pair for the new user (same helper as login uses).
4. Return `{ user, accessToken, refreshToken }`.

The "username / email already taken" check is done by **express-validator async
validators on the route** (course demo 22), not here — see §7. If a duplicate
still slips through, `createUser` throws and the route handles it.

### `login(username, password)`

1. `findUserByUsername(username)`.
2. If no user, or `bcrypt.compare(password, user.password)` is false — throw one
   error meaning "credentials are wrong". Same error for both cases, so the
   response cannot reveal which was wrong. Mark it so the route answers **401**
   (e.g. `err.status = 401`, as in `ex6`).
3. Issue a token pair.
4. Return `{ user, accessToken, refreshToken }`.

### `refresh(oldRefreshToken)`

This is the rotation (course demo 24).

1. `findRefreshToken(oldRefreshToken)`. If it is not in the collection — throw
   "not recognised", route answers **401**. (A token that was already rotated
   out, or from before a restart, is gone from the collection.)
2. `jwt.verify(oldRefreshToken, REFRESH_TOKEN_SECRET)`. If it throws (tampered
   or expired) — let it become a 401.
3. `deleteRefreshToken(oldRefreshToken)` — the old one can never be used again.
4. `findUserById(payload.userId)` — needed because the response includes the
   user.
5. Issue a **new** token pair for that user.
6. `saveRefreshToken(...)` the new refresh token.
7. Return `{ user, accessToken, refreshToken }`.

Storing refresh tokens in the `RefreshToken` collection (not an in-memory array
like `ex6`) is deliberate: restarting the server does not log everyone out, and
the TTL index cleans up expired rows. See
[04-data-model.md](04-data-model.md).

### `logout(refreshToken)`

`deleteRefreshToken(refreshToken)`. Nothing to return. If the token was not
there, that is fine — logout is idempotent.

### Private helper: issuing a token pair

Not exported. Used by signup, login and refresh.

- **access token**: `jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '15m' })`
  — short. Payload carries what `requireAuth` will read off `req.user` on the
  chat and expense routes later.
- **refresh token**: `jwt.sign({ userId: id }, REFRESH_TOKEN_SECRET, { expiresIn: '7d' })`
  — long, minimal payload, different secret from the access token.
- Also compute the refresh token's `expiresAt` Date (now + 7 days) so
  `saveRefreshToken` can store it for the TTL index.

Exact minutes/days are Adam's to pick; "short access, long refresh, different
secrets" is the rule.

## 5. What the service returns vs. what the client sees

The service returns `{ user, accessToken, refreshToken }`. The **route** then:

- puts `refreshToken` in the cookie, never in the JSON body;
- builds the response body as `{ user: { id, username, email }, accessToken }` —
  `password` and `createdAt` are not included.

So `refreshToken` never appears in a response body, and `password` never leaves
the server.

## 6. `routes/userRoute.js`

An Express router. Each handler is wrapped in `catchAsync` (course demo 16) so a
thrown error reaches the central error handler.

### `POST /signup`

1. express-validator checks run first (§7). On failure → 400 with the `errors`
   shape.
2. `const { user, accessToken, refreshToken } = await userService.signup(req.body)`
3. Set the refresh cookie (§6.1).
4. `res.status(201).json({ user: publicUser(user), accessToken })`.

### `POST /login`

1. express-validator checks that `username` and `password` are present. Missing
   → 400 `errors` shape.
2. `await userService.login(req.body.username, req.body.password)`.
3. Set the refresh cookie.
4. `res.status(200).json({ user: publicUser(user), accessToken })`.
5. A thrown credentials error → **401**
   `{ "error": "Username or password is incorrect." }`.

This route is **rate-limited more strictly** than the rest of the API
(`express-rate-limit`, course demo 24).

### `POST /refresh`

1. `const token = req.cookies.refreshToken`. No cookie → **401** immediately,
   and this 401 is **not logged as an error** — it is the normal "nobody is
   logged in" case on start-up.
2. `await userService.refresh(token)`.
3. Set the refresh cookie to the new token.
4. `res.status(200).json({ user: publicUser(user), accessToken })`.
5. Any failure from the service → **401**, cookie cleared.

### `POST /logout`

1. `const token = req.cookies.refreshToken`.
2. `await userService.logout(token)` (safe even if `token` is undefined).
3. Clear the refresh cookie.
4. `res.status(204).end()`.

### 6.1 The refresh cookie

Set it the same way every time:

```js
res.cookie('refreshToken', refreshToken, {
  httpOnly: true,
  secure: false,        // true once the app is on HTTPS
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000   // match the refresh token's lifetime
})
```

Clear it with `res.clearCookie('refreshToken')` using the same options.

`cookie-parser` must be mounted before this router so `req.cookies` exists.
CORS must allow credentials and the exact client origin — see
[03-api-contract.md](03-api-contract.md) §0.

### 6.2 `publicUser` helper

A tiny function in the route file that maps a `User` document to
`{ id, username, email }`. Keeps the "never leak `password`" rule in one place.

## 7. Where validation lives

| Check | Where | Course topic |
|---|---|---|
| `username` 3–20 chars, `email` valid, `password` ≥ 8 chars | express-validator on `/signup` | demo 22 |
| `username` not already taken, `email` not already taken | express-validator **async** custom validators on `/signup` — they query the DB through the repository | demo 22 |
| `username` and `password` present on `/login` | express-validator on `/login` | demo 22 |
| credentials actually correct | `userService.login` | — |
| refresh token valid and not rotated out | `userService.refresh` | demo 24 |

The async "is it taken" validators need to read the database. They may call
`userRepository.findUserByUsername` / a new `findUserByEmail`, so the route can
stay out of the model. **Open question 2** covers whether to add
`findUserByEmail` to the repository for this.

express-validator's output is mapped to the agreed `errors` shape exactly as
shown in [03-api-contract.md](03-api-contract.md) §0.

## 8. Errors, end to end

| Situation | Thrown by | Route answers |
|---|---|---|
| A signup field fails a rule | express-validator | 400 + `errors[]` |
| Username or email already taken | express-validator async validator | 409 (or 400 + `errors[]` so it lands on the field) |
| Wrong username or password | `userService.login` | 401 + `{ error }`, generic |
| No refresh cookie on `/refresh` | route itself | 401, **not logged as error** |
| Refresh token unknown / expired / tampered | `userService.refresh` | 401, cookie cleared |
| Database is down | repository | the central error handler → 500 |

One central error handler (course demo 16) turns a thrown error with `.status`
into that status, and anything else into 500.

## 9. Course-topic coverage

| Topic | Demo | Where |
|---|---|---|
| DAL / BL layers | 8 | the whole `route → service → repository` split |
| Routes, route per resource | 10, 15 | `routes/userRoute.js` mounted at `/users` |
| CRUD | 13 | create user, create/read/delete refresh token |
| Middleware, error handling | 14, 16 | `catchAsync`, central error handler |
| Mongoose | 18 | `User`, `RefreshToken` via the repository |
| bcrypt + JWT | 19 | `userService` signup and login |
| express-validator | 22 | `/signup` and `/login` bodies, async taken-checks |
| Advanced security | 24 | strict login rate limit, HttpOnly cookie, refresh-token rotation in the DB |

## 10. Open questions

1. **Access-token lifetime.** 15 minutes is a common choice; Adam picks the
   number. The rule (short access, long refresh, separate secrets) is fixed.
2. **`findUserByEmail` in the repository.** The signup async validator for
   "email already taken" needs a DB read. Add `findUserByEmail` to
   `userRepository`, or let the validator use `User` directly? Adding it keeps
   the layering clean; it is one more small function.
3. **Who catches the duplicate-key (`E11000`) error** if a race slips past the
   async validator — the service (translate to a `.status = 409` error) or the
   central error handler (special-case `E11000`). Either is fine; pick one so it
   is not handled twice.
4. **`createdAt` in the response.** The contract's `user` object is
   `{ id, username, email }` only. Confirm the client never needs `createdAt`
   here. (It does not today.)
