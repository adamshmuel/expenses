/**
 * Turns one free-text chat message into a structured intent (spec
 * 01-ai-chat.md §8). Calls Gemini Flash Lite with the shared prompt and
 * response schema, and returns the parsed JSON. Never touches the database —
 * data in, structured data out.
 */

const { GoogleGenAI } = require("@google/genai");
const { buildPrompt } = require("./prompt");
const { responseSchema } = require("./schema");
const logger = require("../.config/logger");

// The "-latest" alias always points at Google's current Flash Lite model, so
// this stays "the current model" without needing to be bumped by hand.
const MODEL = "gemini-flash-lite-latest";

// One giant response must not bloat ai.log forever — keep only enough to
// diagnose what went wrong.
const RAW_RESPONSE_LOG_CAP = 2000;

// Same "does this look like leaked JSON/HTML instead of natural text" check
// as the client's isSaneText (client/src/store/chatSlice.ts) — a JS port for
// the server side, since bug 2 and this are the same underlying symptom.
const MAX_FREE_TEXT_LENGTH = 200;
const HTML_FRAGMENT_PATTERN = /<\/|<html|<body/i;
const JSON_FRAGMENT_PATTERN = /"\s*,\s*"[^"]+"\s*:|[{}]/;

function looksSuspicious(value) {
  if (!value) return false;
  return value.length > MAX_FREE_TEXT_LENGTH || HTML_FRAGMENT_PATTERN.test(value) || JSON_FRAGMENT_PATTERN.test(value);
}

/** True when any of the model's own free-text output fields (drafts[].store/
 *  description, draft.name, changes.store/description/name, ...) looks like
 *  a leaked JSON/HTML fragment rather than real text. */
function hasSuspiciousField(parsed) {
  const fields = [
    ...(parsed.drafts ?? []).flatMap((draft) => [draft.store, draft.description]),
    parsed.draft?.name,
    parsed.changes?.store,
    parsed.changes?.description,
    parsed.changes?.name,
  ];
  return fields.some(looksSuspicious);
}

const AI_UNAVAILABLE_ERROR = {
  status: 502,
  message: "Could not reach the AI right now. Please try again.",
};

let defaultClient = null;

/** Lazily built so tests never need a real GEMINI_API_KEY. */
function getDefaultClient() {
  if (!defaultClient) {
    defaultClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return defaultClient;
}

/**
 * @param {string} text - the user's raw chat message.
 * @param {object[]} categories - this user's categories, for name matching.
 * @param {object[]} recentExpenses - this user's last 30 days of expenses.
 * @param {object[]} [history] - recent `{ role, text }` messages, oldest
 *   first, ending with the message being parsed right now (the caller saves
 *   it before fetching history, so it is already the last element — never
 *   passed again separately). Omit for a first message or when no history is
 *   available; undefined degrades to "no history" rather than crashing.
 * @param {{ client?: { models: { generateContent: Function } }, today?: Date|string }} [options] -
 *   `client` overrides the Gemini client; tests use this, production callers
 *   omit it and get the real SDK client. `today` overrides the current date
 *   used to resolve "today"/relative dates in the prompt (bug: the model has
 *   no clock of its own and invents a date when none is given); tests pass a
 *   fixed value, production callers omit it and get the real `new Date()`.
 *   Callers written before `history` existed pass this as the 4th argument —
 *   still accepted (see below).
 * @returns {Promise<object>} one of the seven intent shapes from spec 01 §8,
 *   plus a "reply" string.
 * @throws {{ status: number, message: string }} when the model call fails,
 *   or returns something that isn't valid JSON — never a raw provider error.
 */
async function parseMessage(text, categories, recentExpenses, history, options = {}) {
  // `history` is an array (or omitted). An older caller passing `options` as
  // the 4th argument instead (before `history` existed) sends a plain object
  // there — shift it into `options` so that call shape keeps working.
  if (history && !Array.isArray(history)) {
    options = history;
    history = undefined;
  }
  const client = options.client ?? getDefaultClient();

  let response;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: text,
      config: {
        systemInstruction: buildPrompt(categories, recentExpenses, history, options.today),
        responseMimeType: "application/json",
        responseSchema,
      },
    });
  } catch (error) {
    logger.error(`AI call failed: ${error.message}`, { area: "ai" });
    throw AI_UNAVAILABLE_ERROR;
  }

  const rawResponse = String(response.text).slice(0, RAW_RESPONSE_LOG_CAP);

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    logger.error(`AI response was not valid JSON: ${error.message}`, { area: "ai", rawResponse });
    throw AI_UNAVAILABLE_ERROR;
  }

  if (hasSuspiciousField(parsed)) {
    logger.warn("AI response has a suspicious field (looks like leaked JSON/HTML)", { area: "ai", rawResponse });
  }

  logger.info(`AI parsed intent: ${parsed.intent}`, { area: "ai" });
  return parsed;
}

module.exports = { parseMessage };
