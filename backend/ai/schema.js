/**
 * The fixed JSON shape the model must return, passed as the Gemini SDK's
 * `responseSchema` (spec 01-ai-chat.md §8). One flat object: every intent's
 * fields live side by side, all optional except "intent" and "reply", and
 * `parseMessage` picks out only the fields that intent actually uses.
 *
 * @google/genai's Schema type (see node_modules/@google/genai/dist/genai.d.ts)
 * is a select subset of OpenAPI 3.0 — no draft-level $ref etc. A single flat
 * object plays to its strengths; a root-level `anyOf` per intent is more
 * "correct" but less reliably honoured by the model.
 */

const { Type } = require("@google/genai");
const { INTENTS } = require("./prompt");

const draftExpenseSchema = {
  type: Type.OBJECT,
  properties: {
    amount: { type: Type.NUMBER, description: "Never invented — omit if not stated." },
    store: { type: Type.STRING },
    description: { type: Type.STRING },
    date: { type: Type.STRING, description: "YYYY-MM-DD" },
    category: { type: Type.STRING, description: "A category name, not an id." },
  },
  required: [],
};

const searchFiltersSchema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    from: { type: Type.STRING, description: "YYYY-MM-DD" },
    to: { type: Type.STRING, description: "YYYY-MM-DD" },
  },
  required: [],
};

// Covers both an expense edit's changes (amount/store/description/date/
// category) and a category edit's changes (name) in one flat shape — same
// reasoning as the top-level schema: fewer nested unions, more reliably
// honoured by the model.
const changesSchema = {
  type: Type.OBJECT,
  properties: {
    amount: { type: Type.NUMBER },
    store: { type: Type.STRING },
    description: { type: Type.STRING },
    date: { type: Type.STRING, description: "YYYY-MM-DD" },
    category: { type: Type.STRING, description: "A category name, not an id." },
    name: { type: Type.STRING, description: "New category name, for edit-category." },
  },
  required: [],
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, enum: INTENTS },
    reply: { type: Type.STRING },
    drafts: { type: Type.ARRAY, items: draftExpenseSchema },
    draft: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        parent: { type: Type.STRING, nullable: true, description: "A main category name, or null." },
      },
      required: [],
    },
    searchFilters: searchFiltersSchema,
    changes: changesSchema,
  },
  required: ["intent", "reply"],
};

module.exports = { responseSchema };
