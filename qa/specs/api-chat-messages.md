# Test spec — `GET /chat/messages`, `POST /chat/messages` (API)

**Under test:** `backend/routes/chatRoute.js` — `GET /chat/messages?limit=`, `POST /chat/messages`.
**Governing spec:** `docs/specs/01-ai-chat.md` §5, §6, §9.
**Level:** API — real HTTP, real test DB. `GET /chat/messages` is fully testable without touching `backend/ai/`. `POST /chat/messages` always calls the real `backend/ai/parseMessage` (`routes/chatRoute.js` imports `ai/index.js` directly, with no seam to inject a fake client the way `parseMessage.js`'s own unit tests do) — **blocked** on avoiding a real, metered, non-deterministic Gemini call (blocker B7, `qa/test-roadmap.md`). This spec covers only `POST /chat/messages`'s auth boundary; its AI-dependent behaviour (intent parsing, the 30-day expense window, per-intent `matches`) is not automated here. The one place this run does make a real (minimal) Gemini call is the E2E flagship journey — see `qa/specs/e2e-chat-dashboard-journey.md`.
**Automation:** `qa/tests/api/07-chat-messages.test.ts`.

`GET /chat/messages` fixtures are seeded by writing `Message` documents directly via Mongoose (the `Message` schema has no middleware — unlike `Category`, this is safe) rather than through `POST /chat/messages`, so these tests never touch the AI either.

---

### CM-01 — `GET /chat/messages` with no `Authorization` header → 401
- **Method:** `GET /chat/messages` with no header.
- **Expected:** `401`.

### CM-02 — `POST /chat/messages` with no `Authorization` header → 401 (the AI is never reached)
- **Method:** `POST /chat/messages` `{ text: "spent 5" }` with no header.
- **Expected:** `401`. `requireAuth` runs before the handler, so no AI call and no `Message` row is written.

### CM-03 — `GET /chat/messages` returns oldest-first
- **Method:** seed 3 `Message` docs directly for one user, in order ("m1" user, "m2" assistant, "m3" user), spaced so `createdAt` is strictly increasing. `GET /chat/messages` for that user.
- **Expected:** `200`; the array's `text` values are `["m1", "m2", "m3"]` — oldest first, even though the route fetches newest-first internally and reverses.

### CM-04 — omitting `limit` still returns everything under the 50 default
- **Method:** seed 5 messages for one user. `GET /chat/messages` (no `limit` query param).
- **Expected:** all 5 returned, oldest-first.

### CM-05 — a smaller `limit` returns the most recent N, still oldest-first (off-by-one guard)
- **Method:** seed 5 messages "m1".."m5" in order for one user. `GET /chat/messages?limit=2`.
- **Expected:** exactly `["m4", "m5"]`, in that order — the two most recent, not the two oldest, and not reversed.

### CM-06 — `GET /chat/messages` is scoped to the logged-in user only
- **Method:** seed 2 messages for user A, 3 for user B. `GET /chat/messages` as user A.
- **Expected:** exactly 2 results, both authored by A.
