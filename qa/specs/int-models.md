# Test spec — Mongoose models (integration)

**Under test:** `backend/models/userModel.js`, `refreshTokenModel.js`, `expenseModel.js`.
**Governing spec:** `docs/specs/04-data-model.md` ("User", "RefreshToken", "Expense").
**Level:** integration against the test database `expenses_qa_test` (see `qa/harness/`). A QA-owned `mongoose` connection (not the server's) `require`s each model file and connects to the same test DB the spawned server uses. Validation-only cases use `new Model(doc).validate()` (no write). Index cases read `Model.collection.getIndexes()` after `Model.init()` (which builds indexes). Each test cleans its own collection; the harness drops the whole DB at the end.
**Automation:** `qa/tests/integration/models.test.ts`.

---

## `User` — MD-01 … MD-08

### MD-01 — `username` is required
- **Method:** `new User({ email:"a@x.io", password:"h" }).validate()`.
- **Expected:** rejects; `err.errors.username` present, kind `required`.

### MD-02 — `username` shorter than 3 is rejected
- **Method:** `new User({ username:"ab", email:"a@x.io", password:"h" }).validate()`.
- **Expected:** rejects; `err.errors.username`, message mentions "3 characters".

### MD-03 — `username` longer than 20 is rejected
- **Method:** `username` = 21 chars. `.validate()`.
- **Expected:** rejects; `err.errors.username`, message mentions "20".

### MD-04 — `username` is trimmed
- **Method:** `new User({ username:"  amir  ", email:"a@x.io", password:"h" })` — read `.username` after construction.
- **Expected:** `"amir"` (Mongoose applies `trim` on set).

### MD-05 — `email` must pass `validator.isEmail`
- **Method:** `new User({ username:"amir", email:"not-an-email", password:"h" }).validate()`.
- **Expected:** rejects; `err.errors.email`, message `"Please enter a valid email address"`.

### MD-06 — `email` is lowercased
- **Method:** `new User({ username:"amir", email:"Amir@Example.IO", password:"h" })` — read `.email`.
- **Expected:** `"amir@example.io"`.

### MD-07 — `username` and `email` have unique indexes
- **Method:** `await User.init()`, then `User.collection.getIndexes()`.
- **Expected:** an index on `{ username: 1 }` with `unique: true`, and one on `{ email: 1 }` with `unique: true`.

### MD-08 — `createdAt` defaults to ~now; `toJSON` exposes the `id` virtual
- **Method:** `const u = new User({ username:"amir", email:"a@x.io", password:"h" });` check `u.createdAt` is a `Date` within 5 s of now. Save `u`, then `u.toJSON()`.
- **Expected:** `createdAt` is a recent `Date`. `toJSON()` output has a string `id` equal to `_id.toString()`.

## `RefreshToken` — MD-09 … MD-14

### MD-09 — `token` is required
- **Method:** `new RefreshToken({ user: new ObjectId(), expiresAt: new Date() }).validate()`.
- **Expected:** rejects; `err.errors.token`, kind `required`.

### MD-10 — `user` is required and is an ObjectId ref
- **Method:** `new RefreshToken({ token:"t", expiresAt:new Date() }).validate()`; separately `new RefreshToken({ token:"t", user:"not-an-oid", expiresAt:new Date() }).validate()`.
- **Expected:** first rejects on `user` required; second rejects on `user` cast error. The schema path `user` has `ref === "User"`.

### MD-11 — `expiresAt` is required
- **Method:** `new RefreshToken({ token:"t", user:new ObjectId() }).validate()`.
- **Expected:** rejects; `err.errors.expiresAt`, kind `required`.

### MD-12 — `token` has a unique index
- **Method:** `await RefreshToken.init()`, `getIndexes()`.
- **Expected:** an index on `{ token: 1 }` with `unique: true`.

### MD-13 — there is a TTL index on `expiresAt` with `expireAfterSeconds: 0`
- **Purpose:** MongoDB removes expired tokens on its own (spec 04 "RefreshToken": "Put a TTL index on `expiresAt`").
- **Method:** `RefreshToken.collection.getIndexes({ full: true })` (or `listIndexes()`), find the index whose key is `{ expiresAt: 1 }`.
- **Expected:** that index has `expireAfterSeconds === 0`.

### MD-14 — there is an index on `user`
- **Method:** `getIndexes()`.
- **Expected:** an index whose key is `{ user: 1 }`.

## `Expense` — MD-15 … MD-20

### MD-15 — `amount` is required
- **Method:** `new Expense({ category:new ObjectId(), user:new ObjectId() }).validate()`.
- **Expected:** rejects; `err.errors.amount`, kind `required`.

### MD-16 — `amount` of 0 is rejected
- **Method:** `new Expense({ amount:0, category:new ObjectId(), user:new ObjectId() }).validate()`.
- **Expected:** rejects; `err.errors.amount`, message mentions "greater than 0".

### MD-17 — `amount` negative is rejected
- **Method:** `amount: -5`. `.validate()`.
- **Expected:** rejects; `err.errors.amount`.

### MD-18 — `amount` of 0.01 is accepted
- **Method:** `new Expense({ amount:0.01, category:new ObjectId(), user:new ObjectId() }).validate()`.
- **Expected:** resolves (no error).

### MD-19 — `date` defaults to ~now; `category` and `user` are required refs
- **Method:** construct a valid `Expense` without `date` → `.date` is a `Date` within 5 s of now. `new Expense({ amount:5 }).validate()` → rejects on both `category` and `user`. Schema paths `category`/`user` have `ref` `"Category"`/`"User"`.
- **Expected:** as stated.

### MD-20 — compound index `{ user: 1, date: 1 }` exists
- **Purpose:** every dashboard query is "this user, this period" (spec 04 "Expense").
- **Method:** `await Expense.init()`, `getIndexes()`.
- **Expected:** an index whose key is exactly `{ user: 1, date: 1 }`.
