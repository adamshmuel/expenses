/**
 * Unit tests for backend/ai/ (prompt.js, schema.js, parseMessage.js, index.js)
 * Test spec: qa/specs/unit-ai.md  (AI-01 .. AI-12)
 * Governing spec: docs/specs/01-ai-chat.md §6, §8.
 *
 * No real network call anywhere in this file, no GEMINI_API_KEY needed. Most
 * tests use parseMessage's own options.client injection seam (same as Adam's
 * own backend/ai/__tests__/parseMessage.test.js). AI-10/AI-11 need to observe
 * the DEFAULT (no options.client) path, so those two stub `@google/genai`'s
 * GoogleGenAI export via loadCjsWithStubs -- keeping the real `Type` export
 * (schema.js needs it to build responseSchema) and replacing only the
 * constructor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCjsWithStubs } from "../../harness/cjs-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(here, "..", "..", "..", "backend");
const rb = createRequire(resolve(BACKEND, "package.json"));

const { buildPrompt, INTENTS } = rb("./ai/prompt.js");
const { responseSchema } = rb("./ai/schema.js");
const { parseMessage } = rb("./ai/parseMessage.js");
const aiIndex = rb("./ai/index.js");

function fakeClient(impl: (args: any) => any) {
  return { models: { generateContent: vi.fn(impl) } };
}

describe("backend/ai/prompt.js", () => {
  it("AI-01 buildPrompt embeds recentExpenses verbatim and categories with parent names resolved", () => {
    // Corrected 2026-09-16: buildPrompt now runs categories through
    // withParentNames (resolves a subcategory's raw parent id to its main
    // category's name) before embedding -- a main category with no parent
    // comes out as { name, parent: null }, not the raw input shape.
    const categories = [{ name: "Fuel" }];
    const expenses = [{ amount: 12, store: "Aroma" }];
    const prompt = buildPrompt(categories, expenses);
    expect(prompt).toContain(JSON.stringify(expenses, null, 2));
    expect(prompt).toContain(JSON.stringify([{ name: "Fuel", parent: null }], null, 2));
  });

  it("AI-02 buildPrompt defaults undefined/null to [], never the string 'undefined'", () => {
    const prompt = buildPrompt(undefined, null);
    expect(prompt).not.toContain("undefined");
    const categoriesBlock = prompt.split("## This user's categories")[1].split("## This user's recent expenses")[0];
    const expensesBlock = prompt.split("## This user's recent expenses (last 30 days)")[1];
    expect(categoriesBlock.trim()).toBe("[]");
    expect(expensesBlock.trim()).toBe("[]");
  });

  it("AI-03 buildPrompt mentions every one of the 8 INTENTS values", () => {
    const prompt = buildPrompt([], []);
    for (const intent of INTENTS) {
      expect(prompt, `missing intent "${intent}"`).toContain(intent);
    }
  });

  it("AI-04 INTENTS is exactly the 8 values, and the single shared source for prompt.js + schema.js", () => {
    expect(INTENTS).toEqual([
      "create-expense",
      "edit-expense",
      "delete-expense",
      "create-category",
      "edit-category",
      "delete-category",
      "reset-categories",
      "unknown",
    ]);
    expect(responseSchema.properties.intent.enum).toBe(INTENTS); // reference equality
  });
});

describe("backend/ai/schema.js", () => {
  it("AI-05 responseSchema.required is exactly ['intent', 'reply']", () => {
    expect(responseSchema.required).toEqual(["intent", "reply"]);
  });
});

describe("backend/ai/parseMessage.js", () => {
  it("AI-06 parseMessage sends the actual prompt/schema buildPrompt/responseSchema produce", async () => {
    const client = fakeClient(async () => ({ text: '{"intent":"unknown","reply":"ok"}' }));
    const categories = [{ name: "Fuel" }];
    await parseMessage("hi", categories, [], { client });
    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    const arg = client.models.generateContent.mock.calls[0][0];
    expect(arg.model).toBe("gemini-flash-lite-latest");
    expect(arg.contents).toBe("hi");
    expect(arg.config.systemInstruction).toBe(buildPrompt(categories, []));
    expect(arg.config.responseMimeType).toBe("application/json");
    expect(arg.config.responseSchema).toBe(responseSchema);
  });

  it("AI-07 happy path returns JSON.parse(response.text) unchanged", async () => {
    const client = fakeClient(async () => ({
      text: '{"intent":"create-expense","reply":"ok","drafts":[{"amount":5}]}',
    }));
    const out = await parseMessage("spent 5", [], [], { client });
    expect(out).toEqual({ intent: "create-expense", reply: "ok", drafts: [{ amount: 5 }] });
  });

  it("AI-08 a generateContent throw becomes the clean 502, never the raw provider error", async () => {
    const client = fakeClient(async () => {
      throw new Error("ECONNRESET: upstream reset");
    });
    let err: any;
    try {
      await parseMessage("hi", [], [], { client });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 502, message: "Could not reach the AI right now. Please try again." });
    expect(JSON.stringify(err)).not.toContain("ECONNRESET");
  });

  it("AI-09 an unparseable response.text becomes the same clean 502", async () => {
    const client = fakeClient(async () => ({ text: "not json {{{" }));
    let err: any;
    try {
      await parseMessage("hi", [], [], { client });
    } catch (e) {
      err = e;
    }
    expect(err).toEqual({ status: 502, message: "Could not reach the AI right now. Please try again." });
  });

  describe("default client (options.client omitted)", () => {
    let stubbedParseMessage: any;
    let ctorSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      const real = rb("@google/genai");
      ctorSpy = vi.fn().mockImplementation(() => ({
        models: { generateContent: vi.fn().mockResolvedValue({ text: '{"intent":"unknown","reply":"ok"}' }) },
      }));
      const stubbed = loadCjsWithStubs<any>(BACKEND, "./ai/parseMessage.js", {
        "@google/genai": { ...real, GoogleGenAI: ctorSpy },
      });
      stubbedParseMessage = stubbed.parseMessage;
    });

    it("AI-10 getDefaultClient() is a lazy singleton, built once across repeated calls", async () => {
      await stubbedParseMessage("a", [], []);
      await stubbedParseMessage("b", [], []);
      expect(ctorSpy).toHaveBeenCalledTimes(1);
      expect(ctorSpy).toHaveBeenCalledWith({ apiKey: process.env.GEMINI_API_KEY });
    });

    it("AI-11 the default client is never constructed when options.client is supplied", async () => {
      const client = fakeClient(async () => ({ text: '{"intent":"unknown","reply":"ok"}' }));
      await stubbedParseMessage("hi", [], [], { client });
      expect(ctorSpy).not.toHaveBeenCalled();
    });
  });
});

describe("backend/ai/index.js", () => {
  it("AI-12 exports exactly { parseMessage }", () => {
    expect(Object.keys(aiIndex)).toEqual(["parseMessage"]);
  });
});
