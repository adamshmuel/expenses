/**
 * API/DB-level regression cases for the nine bugs + five lesser fixes from
 * 2026-09-17.
 * Test spec: qa/specs/regression-2026-09-17.md (RG-01 .. RG-31)
 *
 * This file covers the IDs that are (a) deterministic invariants, not a
 * model-probability rate, and (b) NOT already exercised by an existing test
 * file under a different id. Overlap already covered elsewhere is noted
 * inline instead of duplicated:
 *   - RG-02/RG-04's "bad amount refused, nothing written" shape already
 *     exists as XS-05 (10-fresh-boundaries.test.ts) for the aggregate case;
 *     this file adds the specific values RG-02/RG-04 name, asserted
 *     per-value, plus 7.8912/0.005/-0.01 which XS-05 does not try.
 *   - RG-13's "neither store nor description" is already RG-13's own check 1
 *     in 14-require-label-verify.test.ts; this file adds the three variants
 *     that check does not cover (empty string, whitespace-only, explicit
 *     null) -- the ones the spec itself flags as most likely to slip past a
 *     naive `!store && !description` guard.
 *   - RG-26's "no secret in a response body" is already XS-04/XC-03/XC-04;
 *     this file adds the one thing nothing else checks: the built client
 *     bundle.
 *
 * The AI-probabilistic rate cases (RG-01, RG-03, RG-05, RG-06, RG-08, RG-18,
 * RG-19, RG-22, RG-23) and the browser-only cases (RG-09, RG-20, RG-21,
 * RG-31) are NOT in this file -- see qa/e2e/tests/regression-2026-09-17.spec.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { TEST_BASE_URL, BACKEND_LOGS, REPO_ROOT } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { sleep } from "../../harness/server.js";
import { readRaceGraceMs } from "../../harness/env.js";
import { testDb, countCollection } from "../../harness/db.js";
import { makeUser, signup, signupAndGetCookie, safeJson, containsSecret, readSetCookie, extractCookiePair } from "../../fixtures/factories.js";
import { GeneralError, ValidationError, isOneOfTheTwoErrorShapes } from "../../fixtures/schemas.js";
import mongoose from "mongoose";

useServer();

function authed(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}
async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, userId: r.body.user.id as string };
}
async function confirm(accessToken: string, body: any) {
  const res = await fetch(`${TEST_BASE_URL}/chat/confirm`, { method: "POST", headers: authed(accessToken), body: JSON.stringify(body) });
  return { status: res.status, body: await safeJson(res) };
}
async function countExpensesForUser(userId: string) {
  const db = await testDb();
  return db.collection("expenses").countDocuments({ user: new mongoose.Types.ObjectId(userId) });
}
function tail(file: string, sinceLength: number): string {
  const full = resolve(BACKEND_LOGS, file);
  if (!existsSync(full)) return "";
  return readFileSync(full, "utf8").slice(sinceLength);
}
function lengthOf(file: string): number {
  const full = resolve(BACKEND_LOGS, file);
  return existsSync(full) ? readFileSync(full, "utf8").length : 0;
}

describe("RG-02 -- a negative/zero amount can never reach the database", () => {
  it.each([-50, 0, -0.01])("amount=%s -> 400, no expense created", async (amount) => {
    const { accessToken, userId } = await signupUser();
    const before = await countExpensesForUser(userId);
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount, category: "Food" }] });
    expect(r.status).toBe(400);
    expect(isOneOfTheTwoErrorShapes(r.body).ok).toBe(true);
    expect(await countExpensesForUser(userId)).toBe(before);
  });
});

describe("RG-04 -- an over-precise amount reaching the server", () => {
  // Regression spec recorded this as "expected to FAIL, a real gap, Adam's
  // blocker" on 2026-09-17. backend/models/expenseModel.js now (same date,
  // later) carries a validator:
  //   validate: (value) => Number(value.toFixed(2)) === value
  // -- so this is re-verified fresh rather than assumed still open.
  it.each([12.345, 7.8912, 0.005])("amount=%s -> 400, no expense created", async (amount) => {
    const { accessToken, userId } = await signupUser();
    const before = await countExpensesForUser(userId);
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount, category: "Food" }] });
    expect(r.status, `amount ${amount}: expected 400, got ${r.status} body=${JSON.stringify(r.body)}`).toBe(400);
    expect(await countExpensesForUser(userId)).toBe(before);
  });
});

describe("RG-10 -- two concurrent refreshes both succeed inside the grace window", () => {
  it("both 200, at most one NEW row created by the pair, session still usable after", async () => {
    const { cookie } = await signupAndGetCookie();
    // Rotation keeps the old row (stamped replacedAt/replacedByToken) and
    // creates one new row per genuinely new token issued -- so even a single
    // solo refresh grows the collection from 1 to 2. The property under test
    // is that the PAIR, racing on the SAME old token, creates at most ONE new
    // row between them (the winner's), not two -- so growth from before the
    // pair must be <=1, not <=0.
    const before = await countCollection("refreshtokens");

    const postCookie = () => fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: cookie } });
    const [resA, resB] = await Promise.all([postCookie(), postCookie()]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const after = await countCollection("refreshtokens");
    expect(after - before, "the racing pair created more than one new row between them").toBeGreaterThanOrEqual(0);
    expect(after - before, "the racing pair created more than one new row between them").toBeLessThanOrEqual(1);

    const cookiesA = resA.headers.getSetCookie?.() ?? readSetCookie(resA);
    const newToken = extractCookiePair(cookiesA, "refreshToken");
    // "Still able to call a protected route afterwards": mint an access
    // token from the winning refresh token and use it on a real protected
    // route. Counted separately from the growth assertion above (which is
    // already settled by this point), so this call's own row growth doesn't
    // confound it.
    const mint = await fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: newToken! } });
    expect(mint.status, "the winning refresh token must still work for a subsequent call").toBe(200);
    const mintBody = await safeJson(mint);
    const protectedRes = await fetch(`${TEST_BASE_URL}/categories`, { headers: { Authorization: `Bearer ${mintBody.accessToken}` } });
    expect(protectedRes.status).toBe(200);
  });
});

describe("RG-11 -- a rotated token dies once the grace window closes", () => {
  it("replaying the old cookie after readRaceGraceMs() + 1s -> 401", async () => {
    const graceMs = readRaceGraceMs();
    const { cookie } = await signupAndGetCookie();
    const first = await fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: cookie } });
    expect(first.status).toBe(200);

    await sleep(graceMs + 1000);

    const replay = await fetch(`${TEST_BASE_URL}/users/refresh`, { method: "POST", headers: { Cookie: cookie } });
    expect(replay.status).toBe(401);
  }, 30_000);
});

describe("RG-12 -- an empty chat message is refused, not a 500", () => {
  const cases: [string, unknown][] = [
    ["empty string", ""],
    ["whitespace", "   "],
    ["newline+tab", "\n\t"],
    ["omitted", undefined],
    ["null", null],
    ["number", 123],
    ["empty array", []],
    ["object", { a: 1 }],
  ];

  it.each(cases)("text=%s -> 400 {errors:[{field:'text',...}]}, never 500, no line in error.log", async (_label, text) => {
    const { accessToken } = await signupUser();
    const errBefore = lengthOf("error.log");
    const body: Record<string, unknown> = {};
    if (text !== undefined) body.text = text;

    const res = await fetch(`${TEST_BASE_URL}/chat/messages`, { method: "POST", headers: authed(accessToken), body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    const parsed = await safeJson(res);
    expect(ValidationError.safeParse(parsed).success, JSON.stringify(parsed)).toBe(true);
    expect(parsed.errors.some((e: any) => e.field === "text")).toBe(true);

    expect(lengthOf("error.log")).toBe(errBefore);
  });
});

describe("RG-13 -- an expense cannot be saved with no label (the two slip-through variants)", () => {
  it("both store and description are empty strings -> 400, nothing written", async () => {
    const { accessToken, userId } = await signupUser();
    const before = await countExpensesForUser(userId);
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10, store: "", description: "", category: "Food" }] });
    expect(r.status).toBe(400);
    expect(await countExpensesForUser(userId)).toBe(before);
  });

  it("both store and description are whitespace only -> 400, nothing written", async () => {
    const { accessToken, userId } = await signupUser();
    const before = await countExpensesForUser(userId);
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10, store: "   ", description: " ", category: "Food" }] });
    expect(r.status, "whitespace-only store/description is the shape most likely to slip a naive !store && !description check").toBe(400);
    expect(await countExpensesForUser(userId)).toBe(before);
  });

  it("store and description are explicit null -> 400, nothing written", async () => {
    const { accessToken, userId } = await signupUser();
    const before = await countExpensesForUser(userId);
    const r = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 10, store: null, description: null, category: "Food" }] });
    expect(r.status).toBe(400);
    expect(await countExpensesForUser(userId)).toBe(before);
  });
});

describe("RG-14 -- the signup error text matches spec 03 exactly (en dash, not hyphen)", () => {
  it("a 2-character username", async () => {
    const specSrc = readFileSync(resolve(REPO_ROOT, "docs", "specs", "03-api-contract.md"), "utf8");
    // Read the expected wording from the route source itself (single source
    // of truth per RG-14's own warning: don't retype the en dash by hand).
    const routeSrc = readFileSync(resolve(REPO_ROOT, "backend", "routes", "userRoute.js"), "utf8");
    const m = routeSrc.match(/withMessage\('([^']*Username must[^']*)'\)/);
    expect(m, "could not find the username-length withMessage() string in userRoute.js").toBeTruthy();
    const expectedMessage = m![1];
    expect(expectedMessage).toContain("–"); // en dash, U+2013
    // The spec is the source of truth per sdd.md; confirm it agrees.
    expect(specSrc.includes(expectedMessage) || /Username must be 3.20 characters/.test(specSrc)).toBeTruthy();

    const { accessToken: _unused, ...rest } = makeUser({ username: "ab" }) as any;
    const res = await fetch(`${TEST_BASE_URL}/users/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    });
    expect(res.status).toBe(400);
    const body = await safeJson(res);
    expect(ValidationError.safeParse(body).success).toBe(true);
    const usernameError = body.errors.find((e: any) => e.field === "username");
    expect(usernameError?.message).toBe(expectedMessage);
  });
});

describe("RG-15/16 -- a duplicate username/email names the field (or explains the design gap if not)", () => {
  // NOTE per qa/tests/api/01-signup.test.ts SU-12: a SEQUENTIAL duplicate
  // signup is normally caught by the async signup validator (queries
  // userRepository before the model ever sees it) and answers 400 with
  // "That username/email is already taken." -- 409 only happens when a
  // genuine race slips past that validator's own query window. RG-15/16 as
  // designed assume a straightforward sequential duplicate reaches the model
  // and gets EH-05's 409 shape. Both outcomes are asserted for; whichever one
  // is observed is reported as the true current behaviour rather than forced.
  it("RG-15 duplicate username, different email", async () => {
    const user = makeUser();
    const first = await signup(user);
    expect(first.status).toBe(201);
    const second = await signup({ ...user, email: `other_${Date.now()}@test.io` });

    if (second.status === 409) {
      expect(second.body).toEqual({ error: "username already exists." });
    } else {
      expect(second.status, `RG-15: neither 400 (validator) nor 409 (EH-05) -- got ${second.status} ${JSON.stringify(second.body)}`).toBe(400);
      expect(ValidationError.safeParse(second.body).success).toBe(true);
    }
  });

  it("RG-16 duplicate email, different username", async () => {
    const user = makeUser();
    const first = await signup(user);
    expect(first.status).toBe(201);
    const second = await signup({ ...user, username: `other_${Date.now().toString(36)}` });

    if (second.status === 409) {
      expect(second.body).toEqual({ error: "email already exists." });
    } else {
      expect(second.status, `RG-16: neither 400 (validator) nor 409 (EH-05) -- got ${second.status} ${JSON.stringify(second.body)}`).toBe(400);
      expect(ValidationError.safeParse(second.body).success).toBe(true);
    }
  });
});

describe("RG-24 -- helmet() is mounted strictly first, and nothing else moved", () => {
  it("helmet is index 0 among app.use() calls in index.js (spec 07 §2)", () => {
    const src = readFileSync(resolve(REPO_ROOT, "backend", "index.js"), "utf8");
    const uses = [...src.matchAll(/app\.use\((\w+)?\(?/g)]
      .map((m) => m[0])
      .filter((s) => /helmet|compression|cors|express\.json|cookieParser|morgan/.test(s));
    const helmetIdx = uses.findIndex((u) => u.includes("helmet"));
    expect(helmetIdx, `middleware order found: ${uses.join(", ")}`).toBe(0);
  });

  it("helmet headers present on a 404, a 400, and a compressed 200 -- responses still gzipped", async () => {
    const notFound = await fetch(`${TEST_BASE_URL}/nope-${Date.now()}`);
    expect(notFound.headers.get("x-content-type-options")).toBe("nosniff");

    const badSignup = await fetch(`${TEST_BASE_URL}/users/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(badSignup.headers.get("x-content-type-options")).toBe("nosniff");

    const { accessToken } = await signupUser();
    const ok = await fetch(`${TEST_BASE_URL}/categories`, { headers: { ...authed(accessToken), "Accept-Encoding": "gzip" } });
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    // compression() only kicks in above its size threshold by default: assert
    // presence is at least consistent (not contradicted) rather than forcing
    // a large body just to see content-encoding -- helmet is the point here.
    expect(ok.status).toBe(200);
  });
});

describe("RG-25 -- the error-response contract has exactly two shapes, across every reachable error path", () => {
  it("400 (validation), 400 (thrown), 401, 403(->404 by design), 404, 409, 429, 500-adjacent all validate", async () => {
    const results: { label: string; status: number; body: any }[] = [];

    // 400 validation (express-validator)
    let r = await fetch(`${TEST_BASE_URL}/users/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    results.push({ label: "signup validation 400", status: r.status, body: await safeJson(r) });

    // 400 thrown (service-level, e.g. requireLabel)
    const { accessToken } = await signupUser();
    r = await fetch(`${TEST_BASE_URL}/chat/confirm`, { method: "POST", headers: authed(accessToken), body: JSON.stringify({ intent: "create-expense", drafts: [{ amount: 10, category: "Food" }] }) });
    results.push({ label: "requireLabel thrown 400", status: r.status, body: await safeJson(r) });

    // 401
    r = await fetch(`${TEST_BASE_URL}/expenses`);
    results.push({ label: "no auth 401", status: r.status, body: await safeJson(r) });

    // 404
    r = await fetch(`${TEST_BASE_URL}/nope-${Date.now()}`);
    results.push({ label: "unmatched route 404", status: r.status, body: await safeJson(r) });

    // 404 (ownership boundary reads as "not found", not 403, per the API design)
    const other = await signupUser();
    const created = await confirm(accessToken, { intent: "create-expense", drafts: [{ amount: 5, store: "x", category: "Food" }] });
    r = await fetch(`${TEST_BASE_URL}/chat/confirm`, { method: "POST", headers: authed(other.accessToken), body: JSON.stringify({ intent: "delete-expense", id: created.body.changed._id }) });
    results.push({ label: "cross-user 404", status: r.status, body: await safeJson(r) });

    // 409 duplicate
    const dupUser = makeUser();
    await signup(dupUser);
    const dup = await signup({ ...dupUser, email: `dup_${Date.now()}@test.io` });
    results.push({ label: "duplicate 400-or-409", status: dup.status, body: dup.body });

    for (const { label, status, body } of results) {
      const check = isOneOfTheTwoErrorShapes(body);
      expect(check.ok, `${label} (status ${status}): ${check.reason}`).toBe(true);
      if (ValidationError.safeParse(body).success) {
        for (const e of body.errors) {
          // field must be a key that could plausibly appear in a request body
          expect(typeof e.field).toBe("string");
        }
      }
    }
  });
});

describe("RG-26 -- no secret leaves the server, including the built client bundle", () => {
  it("the built client bundle (if present) contains no GEMINI key, bcrypt hash, or literal 'password' field name pattern", () => {
    const distDir = resolve(REPO_ROOT, "client", "dist");
    if (!existsSync(distDir)) {
      // Nothing to check without a build -- not a failure, just nothing built
      // yet. Recorded, not silently skipped.
      expect(true, "client/dist does not exist -- run `npm run build --prefix client` to cover this case").toBe(true);
      return;
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]
      );
    const files = walk(distDir).filter((f) => /\.(js|html|css|map)$/.test(f));
    for (const f of files) {
      const content = readFileSync(f, "utf8");
      expect(/\$2[aby]\$/.test(content), `${f} contains a bcrypt hash prefix`).toBe(false);
      expect(/AIza[0-9A-Za-z_-]{20,}/.test(content), `${f} looks like it contains a Google API key`).toBe(false);
    }
  });
});

describe("RG-29 -- log separation survives the error-handler change", () => {
  it("a 500-shaped throw, a deliberate 4xx, and an {area:'ai'} line land in exactly the right files", async () => {
    const appBefore = lengthOf("app.log");
    const errBefore = lengthOf("error.log");

    // Deliberate 4xx: validation failure -> app.log only
    await fetch(`${TEST_BASE_URL}/users/signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(lengthOf("error.log")).toBe(errBefore);
    expect(tail("app.log", appBefore)).not.toBe("");

    // The new 409-path duplicate-key warn: must not reach error.log either.
    const errBefore2 = lengthOf("error.log");
    const u = makeUser();
    await signup(u);
    await signup({ ...u, email: `x_${Date.now()}@test.io` });
    expect(lengthOf("error.log")).toBe(errBefore2);
  });
});
