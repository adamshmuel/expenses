/**
 * Turns one free-text chat message into a structured intent (spec
 * 01-ai-chat.md §8). Calls Gemini Flash Lite with the shared prompt and
 * response schema, and returns the parsed JSON. Never touches the database —
 * data in, structured data out.
 */

const { GoogleGenAI } = require("@google/genai");
const { buildPrompt } = require("./prompt");
const { responseSchema } = require("./schema");

// The "-latest" alias always points at Google's current Flash Lite model, so
// this stays "the current model" without needing to be bumped by hand.
const MODEL = "gemini-flash-lite-latest";

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
 * @param {{ client?: { models: { generateContent: Function } } }} [options] -
 *   `client` overrides the Gemini client; tests use this, production callers
 *   omit it and get the real SDK client.
 * @returns {Promise<object>} one of the seven intent shapes from spec 01 §8,
 *   plus a "reply" string.
 * @throws {{ status: number, message: string }} when the model call fails,
 *   or returns something that isn't valid JSON — never a raw provider error.
 */
async function parseMessage(text, categories, recentExpenses, options = {}) {
  const client = options.client ?? getDefaultClient();

  let response;
  try {
    response = await client.models.generateContent({
      model: MODEL,
      contents: text,
      config: {
        systemInstruction: buildPrompt(categories, recentExpenses),
        responseMimeType: "application/json",
        responseSchema,
      },
    });
  } catch {
    throw AI_UNAVAILABLE_ERROR;
  }

  try {
    return JSON.parse(response.text);
  } catch {
    throw AI_UNAVAILABLE_ERROR;
  }
}

module.exports = { parseMessage };
