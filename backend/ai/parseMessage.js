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

// Bug 5: the findings doc captured a real 207,000-character response — a
// repetition-collapse run, not a legitimate parse result. A budget-app
// intent (a handful of short fields) has no honest reason to approach this
// size; refuse before paying the JSON.parse/regex cost on something this
// shape, rather than only catching it after decoding. Generous headroom
// above any real response (the largest legitimate shape is several drafts
// plus a two-sentence reply, nowhere near this), so it only ever fires on
// the degenerate case the log evidence shows, never on real output.
const MAX_RESPONSE_LENGTH = 5000;

// Same "does this look like leaked JSON/HTML instead of natural text" check
// as the client's isSaneText (client/src/store/chatSlice.ts) — a JS port for
// the server side, since bug 2 and this are the same underlying symptom.
const MAX_FREE_TEXT_LENGTH = 200;
const HTML_FRAGMENT_PATTERN = /<\/|<html|<body/i;
const JSON_FRAGMENT_PATTERN = /"\s*,\s*"[^"]+"\s*:|[{}]/;

// Bug 5 shape 2: a repetition-collapse tail in a script this app has no
// legitimate reason to produce, appended after an otherwise-correct value.
// It can stay well under MAX_FREE_TEXT_LENGTH, so length alone misses it --
// this needs its own signal. The app's real, supported alphabets are Latin
// and Hebrew (spec 01-ai-chat.md; a Hebrew "reply" is expected usage, see
// FR-43 in the findings doc), plus digits/punctuation/currency symbols. Any
// *other* Unicode script appearing in a free-text field is never legitimate
// input or output here, at any length -- one stray character is still enough
// signal, since nothing in this app's domain ever produces Myanmar, CJK,
// Thai, etc. Ranges are written as \uXXXX escapes (not literal characters)
// so they stay legible in an editor/diff/grep: Basic Latin + Latin-1
// Supplement + Latin Extended-A/B, Greek, Hebrew, general punctuation,
// currency symbols.
const UNSUPPORTED_SCRIPT_PATTERN =
  /[^\u0020-\u024F\u0370-\u03FF\u0590-\u05FF\u2010-\u2027\u2030-\u205E\u20A0-\u20CF]/;

function looksSuspicious(value) {
  if (!value) return false;
  return (
    value.length > MAX_FREE_TEXT_LENGTH ||
    HTML_FRAGMENT_PATTERN.test(value) ||
    JSON_FRAGMENT_PATTERN.test(value) ||
    UNSUPPORTED_SCRIPT_PATTERN.test(value)
  );
}

// Bug 3a: the model can drop a minus sign (user types "-50", model returns
// amount: 50) and ask the user to confirm a number they never typed. This
// app has no concept of a negative expense (the model enforces `min: 0.01`),
// so the only honest options are "refuse and ask" or "silently flip the
// sign" — flipping is exactly the bug. This check is a structural backstop,
// independent of whatever the model decided: it reads the user's own text,
// not the model's output, so it cannot be talked out of catching this by a
// confident-sounding reply. A minus sign right before digits ("-50", "- 50")
// is the signal; it will not fire on unrelated text like "50, -ish" because
// the digits must immediately follow (allowing one space).
const NEGATIVE_AMOUNT_PATTERN = /-\s?\d/;

function textHasNegativeAmount(text) {
  return typeof text === "string" && NEGATIVE_AMOUNT_PATTERN.test(text);
}

// Bug 3b: shekels have no sub-agora precision, so a third decimal place
// ("12.345") is not a real amount. The schema (backend/ai/schema.js) can't
// express a decimal-places constraint — @google/genai's Type is a flat
// subset of OpenAPI with no "multipleOf" support — so this is enforced here
// in code instead of trusted to a prompt rule, the same way the negative
// check is: deterministic on the number itself, not a bet on model behaviour.
function hasSubAgoraPrecision(amount) {
  return typeof amount === "number" && Math.round(amount * 100) !== amount * 100;
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

// Shared shape for every "the model's output can't be trusted, ask the user
// to retry rather than act on it or show it" case — bug 3's negative-amount
// and precision guards, and all of bug 5's malformed-output shapes below.
const GARBLED_RESPONSE_REPLY = {
  intent: "unknown",
  reply: "Sorry, that didn't come out right on my end — could you try rephrasing your message?",
};

// Bug 5 shape 3: "reply" is the one field every intent always shows the user
// verbatim. A missing, empty, or literal-string "undefined" reply (the exact
// captured shape) can't be salvaged into anything meaningful — there is no
// "final value" to recover, unlike a garbled store name where a real value
// might still be in there. Refusing is the only honest option.
function hasUnusableReply(parsed) {
  return typeof parsed.reply !== "string" || parsed.reply.trim() === "" || parsed.reply === "undefined";
}

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
// One call to the model plus every check needed to trust its shape. Returns
// the parsed object on success, or the sentinel GARBLED_RESPONSE_REPLY when
// the response degenerated in a way that's worth retrying (bug 6's unusable
// text, bug 5's over-length/suspicious-field/bad-JSON/bad-reply shapes).
// A genuine API failure (the try/catch below) still throws AI_UNAVAILABLE_ERROR
// straight out of here — that's not degeneration, so parseMessage must not
// catch it and retry.
async function attemptParse(client, text, categories, recentExpenses, history, options) {
  const response = await client.models.generateContent({
    model: MODEL,
    contents: text,
    config: {
      systemInstruction: buildPrompt(categories, recentExpenses, history, options.today),
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const rawResponse = String(response.text).slice(0, RAW_RESPONSE_LOG_CAP);

  // Bug 6: the real SDK can resolve with a `.text` that is undefined, null,
  // empty, or otherwise not a usable string under the same degeneration the
  // length guard below exists to catch — reproduced against the live API as
  // a raw TypeError crashing out of this function entirely (nothing catches
  // it, since it's outside the try/catch above). Whatever shape "unusable"
  // takes, it must fall into the same refusal as an over-long response
  // rather than reading a property off it; the user must never be able to
  // tell an undefined reply from a 207,000-character one.
  if (typeof response.text !== "string" || response.text.length === 0) {
    logger.warn("AI response had no usable text — refusing rather than parsing it", {
      area: "ai",
      rawResponse,
    });
    return GARBLED_RESPONSE_REPLY;
  }

  // Bug 5: a real 207,000-character response was captured (repetition
  // collapse, not a legitimate parse result) — refuse before paying the
  // JSON.parse/regex cost on something this shape, rather than only
  // catching it after decoding.
  if (response.text.length > MAX_RESPONSE_LENGTH) {
    logger.warn(`AI response was ${response.text.length} characters — refusing rather than parsing a runaway response`, {
      area: "ai",
      rawResponse,
    });
    return GARBLED_RESPONSE_REPLY;
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (error) {
    // A malformed-JSON response is degeneration too (a 67KB unterminated-
    // string response has been captured live) — treat it the same as the
    // other garbled shapes so the caller retries, instead of throwing
    // AI_UNAVAILABLE_ERROR straight out.
    logger.warn(`AI response was not valid JSON: ${error.message}`, { area: "ai", rawResponse });
    return GARBLED_RESPONSE_REPLY;
  }

  // Bug 5 shape 3: "reply" itself can come back unusable (missing, empty, or
  // the literal string "undefined") even when the rest of the shape looks
  // fine. Every intent shows "reply" to the user verbatim, so this can't be
  // salvaged — check it before anything else.
  if (hasUnusableReply(parsed)) {
    logger.warn('AI response had an unusable "reply" field', { area: "ai", rawResponse });
    return GARBLED_RESPONSE_REPLY;
  }

  // Bug 5 shape 1 & 2: the model occasionally reasons about the prompt's own
  // rules inline inside a free-text field instead of just returning the
  // final value, despite the explicit "final value only" instruction in
  // prompt.js — or appends a repetition-collapse tail in a script this app
  // never legitimately produces. hasSuspiciousField catches both. Salvaging
  // (e.g. "keep the first word") would work on some captures but has no
  // structural guarantee elsewhere, and a wrong salvage silently saves the
  // wrong data — worse than refusing (product-first.md). Same refuse-and-
  // explain shape as bug 3's guards below.
  if (hasSuspiciousField(parsed)) {
    logger.warn("AI response has a suspicious field (looks like leaked JSON/HTML)", { area: "ai", rawResponse });
    return GARBLED_RESPONSE_REPLY;
  }

  // Bug 5b: a stray empty object can show up as an extra element in
  // "drafts" alongside real ones. It carries no amount, store, or category —
  // nothing to show or confirm — so drop it before it reaches the caller,
  // same as the numbered-list UI would have nothing to number it with.
  if (Array.isArray(parsed.drafts)) {
    parsed.drafts = parsed.drafts.filter((draft) => Object.keys(draft).length > 0);
  }

  return parsed;
}

async function parseMessage(text, categories, recentExpenses, history, options = {}) {
  // `history` is an array (or omitted). An older caller passing `options` as
  // the 4th argument instead (before `history` existed) sends a plain object
  // there — shift it into `options` so that call shape keeps working.
  if (history && !Array.isArray(history)) {
    options = history;
    history = undefined;
  }
  const client = options.client ?? getDefaultClient();

  // One retry on a garbled response (not two): a qa-tester round against the
  // real Gemini API found an ordinary, unambiguous message refused roughly
  // 2 in 10 times from pure model degeneration (repetition collapse, runaway
  // output, malformed JSON) — an identical second call usually succeeds. A
  // second garbled response in a row may mean this input shape reliably
  // trips the model, where a third call mostly just makes the user wait
  // longer for the same refusal. The retry is an unchanged, identical replay
  // of the same request — no "your last response was malformed" nudge.
  let parsed;
  try {
    parsed = await attemptParse(client, text, categories, recentExpenses, history, options);
  } catch (error) {
    logger.error(`AI call failed: ${error.message}`, { area: "ai" });
    throw AI_UNAVAILABLE_ERROR;
  }

  if (parsed === GARBLED_RESPONSE_REPLY) {
    logger.warn("AI response was garbled — retrying once with an identical request", { area: "ai" });
    try {
      parsed = await attemptParse(client, text, categories, recentExpenses, history, options);
    } catch (error) {
      logger.error(`AI call failed: ${error.message}`, { area: "ai" });
      throw AI_UNAVAILABLE_ERROR;
    }
    logger.info(`AI retry ${parsed === GARBLED_RESPONSE_REPLY ? "did not recover" : "succeeded"} from a garbled first response`, { area: "ai" });
    if (parsed === GARBLED_RESPONSE_REPLY) {
      return GARBLED_RESPONSE_REPLY;
    }
  }

  if (textHasNegativeAmount(text)) {
    logger.warn("User text has a negative amount — refusing rather than confirming a flipped sign", { area: "ai" });
    return {
      intent: "unknown",
      reply: "It looks like that amount is negative. Expenses can't be negative here — did you mean a positive amount, or a refund/reduction I should handle another way?",
    };
  }

  const amountsToCheck = [...(parsed.drafts ?? []).map((draft) => draft.amount), parsed.changes?.amount];
  if (amountsToCheck.some(hasSubAgoraPrecision)) {
    logger.warn("AI response has an amount with more than 2 decimal places", { area: "ai" });
    return {
      intent: "unknown",
      reply: "That amount has more than two decimal places, but shekels only go down to agorot (two decimals). Can you confirm the amount rounded to the nearest agora?",
    };
  }

  logger.info(`AI parsed intent: ${parsed.intent}`, { area: "ai" });
  return parsed;
}

module.exports = { parseMessage };
