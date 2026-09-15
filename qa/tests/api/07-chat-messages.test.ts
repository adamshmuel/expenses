/**
 * API tests for GET/POST /chat/messages
 * Test spec: qa/specs/api-chat-messages.md  (CM-01 .. CM-06)
 * Governing spec: docs/specs/01-ai-chat.md §5, §6, §9.
 *
 * GET /chat/messages fixtures are seeded by writing Message documents
 * directly (the Message schema has no middleware, unlike Category -- this is
 * safe), never through POST /chat/messages, so these tests never call the AI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_BASE_URL } from "../../harness/paths.js";
import { useServer } from "../../harness/useServer.js";
import { readBackendEnv, deriveTestMongoUri } from "../../harness/env.js";
import { makeUser, signup, safeJson } from "../../fixtures/factories.js";

useServer();

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const rb = createRequire(resolve(BACKEND, "package.json"));
const backendMongoose = rb("mongoose") as typeof import("mongoose");
let Message: any;

beforeAll(async () => {
  const be = readBackendEnv();
  await backendMongoose.connect(deriveTestMongoUri(be.MONGODB_URI));
  Message = rb("./models/messageModel.js");
});

afterAll(async () => {
  await backendMongoose.disconnect();
});

async function signupUser() {
  const r = await signup(makeUser());
  return { accessToken: r.body.accessToken as string, userId: r.body.user.id as string };
}

/** Seed messages in order, each createdAt strictly increasing. */
async function seedMessages(author: string, texts: string[]) {
  const base = Date.now();
  for (let i = 0; i < texts.length; i++) {
    const doc = new Message({ text: texts[i], role: i % 2 === 0 ? "user" : "assistant", author });
    await doc.save();
    // Force strictly increasing createdAt regardless of clock resolution.
    doc.createdAt = new Date(base + i * 1000);
    await Message.updateOne({ _id: doc._id }, { createdAt: doc.createdAt });
  }
}

async function getMessages(accessToken: string, limit?: number) {
  const url = new URL(`${TEST_BASE_URL}/chat/messages`);
  if (limit != null) url.searchParams.set("limit", String(limit));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { status: res.status, body: await safeJson(res) };
}

describe("GET /chat/messages", () => {
  it("CM-01 no Authorization header -> 401", async () => {
    const res = await fetch(`${TEST_BASE_URL}/chat/messages`);
    expect(res.status).toBe(401);
  });

  it("CM-03 returns oldest-first", async () => {
    const { accessToken, userId } = await signupUser();
    await seedMessages(userId, ["m1", "m2", "m3"]);
    const r = await getMessages(accessToken);
    expect(r.status).toBe(200);
    expect(r.body.map((m: any) => m.text)).toEqual(["m1", "m2", "m3"]);
  });

  it("CM-04 omitting limit still returns everything under the 50 default", async () => {
    const { accessToken, userId } = await signupUser();
    await seedMessages(userId, ["a", "b", "c", "d", "e"]);
    const r = await getMessages(accessToken);
    expect(r.body).toHaveLength(5);
    expect(r.body.map((m: any) => m.text)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("CM-05 a smaller limit returns the most recent N, still oldest-first", async () => {
    const { accessToken, userId } = await signupUser();
    await seedMessages(userId, ["m1", "m2", "m3", "m4", "m5"]);
    const r = await getMessages(accessToken, 2);
    expect(r.body.map((m: any) => m.text)).toEqual(["m4", "m5"]);
  });

  it("CM-06 scoped to the logged-in user only", async () => {
    const a = await signupUser();
    const b = await signupUser();
    await seedMessages(a.userId, ["a1", "a2"]);
    await seedMessages(b.userId, ["b1", "b2", "b3"]);
    const r = await getMessages(a.accessToken);
    expect(r.body).toHaveLength(2);
    expect(r.body.every((m: any) => m.author === a.userId)).toBe(true);
  });
});

describe("POST /chat/messages", () => {
  it("CM-02 no Authorization header -> 401 (the AI is never reached)", async () => {
    const before = await Message.countDocuments({});
    const res = await fetch(`${TEST_BASE_URL}/chat/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "spent 5" }),
    });
    expect(res.status).toBe(401);
    expect(await Message.countDocuments({})).toBe(before);
  });
});
