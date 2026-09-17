/**
 * One-off verification of the refresh-token race fix (not part of the
 * permanent roadmap — Adam asked for a narrow check of this bug fix only).
 *
 * Bug: POST /users/refresh used check-then-act (find token, await, then
 * delete it), so two near-simultaneous calls with the SAME refresh token
 * (e.g. React StrictMode double-mounting the session-restore effect) could
 * both pass the "token exists" check before either invalidated it. Whichever
 * response landed second could come back 401 and log out a just-logged-in user.
 *
 * Fix, round 1: backend/dal/userRepository.js `consumeRefreshToken` does an
 * atomic findOneAndUpdate stamping `replacedByToken`; backend/bl/userService.js
 * `refresh()` uses it as the single atomic read, and the "loser" of a race
 * hands back the winner's pair instead of 401.
 *
 * Round-1 verification found a second bug the fix exposed rather than fixed:
 * `issueTokenPair` signed the refresh JWT from `{ userId }` only, and
 * `jwt.sign`'s `iat` is second-resolution, so two token-issuing calls for the
 * same user within the same wall-clock second (concurrent refreshes, or even
 * signup-then-immediate-refresh) minted byte-identical tokens, which collided
 * on the unique index on `token` (Mongo E11000) and surfaced as a bogus 401.
 *
 * Fix, round 2: `issueTokenPair` now signs the refresh token from
 * `{ userId, jti: crypto.randomUUID() }`, so same-second tokens can no longer
 * collide.
 *
 * Round-2 verification found a third bug: the "loser" branch treated ANY
 * already-rotated token as a race win and handed back the winner's pair —
 * with no time bound, a captured old refresh token stayed a working key to
 * the current session for up to 7 days (the row's own TTL), turning a stolen
 * token into a long-lived replay vector instead of a rejected one.
 *
 * Fix, round 3: `replacedAt` (backend/models/refreshTokenModel.js) records
 * when a row was rotated; `consumeRefreshToken` stamps it atomically
 * alongside `replacedByToken`; `refresh()` only answers the "loser" with the
 * winner's pair when `Date.now() - replacedAt <= RACE_GRACE_MS` (10s) AND the
 * winner's row still exists. Older reuse of a rotated-out token 401s exactly
 * as it did originally. This file re-verifies the original 5 checks against
 * that fix, including both sides of the grace window.
 *
 * This file exists only to drive the checks Adam asked for and is not
 * meant to be kept in the permanent suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { sleep } from "../../harness/server.js";
import { signupAndGetCookie, safeJson, extractCookiePair, readSetCookie } from "../../fixtures/factories.js";

// Must exceed backend/bl/userService.js's RACE_GRACE_MS (10s) so the
// "outside the window" case is genuinely outside it, not timing-dependent.
const RACE_GRACE_MS = 10_000;

useServer();

const url = `${TEST_BASE_URL}/users/refresh`;
const postCookie = (cookie?: string) =>
  fetch(url, { method: "POST", headers: cookie ? { Cookie: cookie } : {} });

describe("refresh race fix verification (one-off)", () => {
  it("check 1+2: two concurrent /refresh calls with the SAME token both 200, and a third call afterward is coherent", async () => {
    const { cookie } = await signupAndGetCookie();

    // Genuinely concurrent: both fired before either awaits a response.
    const [resA, resB] = await Promise.all([postCookie(cookie), postCookie(cookie)]);

    // --- Check 1: neither concurrent call may 401 ---
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const bodyA = await safeJson(resA);
    const bodyB = await safeJson(resB);

    const cookiesA = resA.headers.getSetCookie?.() ?? readSetCookie(resA);
    const cookiesB = resB.headers.getSetCookie?.() ?? readSetCookie(resB);
    const newTokenA = extractCookiePair(cookiesA, "refreshToken");
    const newTokenB = extractCookiePair(cookiesB, "refreshToken");

    expect(newTokenA).toBeTruthy();
    expect(newTokenB).toBeTruthy();

    // --- Check 2: session stays coherent — both concurrent responses agree on
    // the same winning refresh token, and a third, later call with that token
    // still works (exactly one "current" token left usable). ---
    expect(newTokenA).toBe(newTokenB);
    expect(bodyA.user.username).toBe(bodyB.user.username);

    const third = await postCookie(newTokenA!);
    expect(third.status).toBe(200);
    const thirdBody = await safeJson(third);
    expect(thirdBody.user.username).toBe(bodyA.user.username);
  });

  it("check 3a: a normal single /refresh works, incl. signup-then-immediate-refresh with no sleep", async () => {
    const { cookie } = await signupAndGetCookie();

    const res = await postCookie(cookie);
    expect(res.status).toBe(200);
    const body = await safeJson(res);
    expect(body.user).toBeTruthy();
    expect(body.accessToken).toBeTruthy();
  });

  it("check 3b-inside-window: sequential reuse of an old token WITHIN the 10s grace window succeeds (by design -- indistinguishable from a race)", async () => {
    const { cookie } = await signupAndGetCookie();

    const first = await postCookie(cookie);
    expect(first.status).toBe(200);
    const firstCookies = first.headers.getSetCookie?.() ?? readSetCookie(first);
    const winnerToken = extractCookiePair(firstCookies, "refreshToken");

    // Reusing the same OLD token again, sequentially (not concurrently), but
    // still well inside RACE_GRACE_MS -- per the round-3 design this is
    // treated the same as a race and answered with the winner's pair, not 401.
    const reuse = await postCookie(cookie);
    expect(reuse.status).toBe(200);
    const reuseBody = await safeJson(reuse);
    const reuseCookies = reuse.headers.getSetCookie?.() ?? readSetCookie(reuse);
    const reuseToken = extractCookiePair(reuseCookies, "refreshToken");
    expect(reuseToken).toBe(winnerToken);
    expect(reuseBody.user).toBeTruthy();
  });

  it("check 3b-outside-window: sequential reuse of an old token AFTER the grace window elapses -> 401 (genuine replay rejection)", async () => {
    const { cookie } = await signupAndGetCookie();

    const first = await postCookie(cookie);
    expect(first.status).toBe(200);

    // Genuinely wait out the grace window -- no DB backdating, no faking.
    await sleep(RACE_GRACE_MS + 1500);

    const reuse = await postCookie(cookie);
    expect(reuse.status).toBe(401);
    const reuseBody = await safeJson(reuse);
    expect(reuseBody.error).toBe("Session expired");
  }, 20_000);

  it("check 4: no cookie at all -> 401 Not authenticated", async () => {
    const res = await postCookie();
    expect(res.status).toBe(401);
    const body = await safeJson(res);
    expect(body.error).toBe("Not authenticated");
  });

  it("check 5: garbage/tampered token -> 401 Session expired", async () => {
    const res = await postCookie("refreshToken=not-a-real-jwt-at-all");
    expect(res.status).toBe(401);
    const body = await safeJson(res);
    expect(body.error).toBe("Session expired");
  });
});
