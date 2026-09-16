/**
 * System instructions for the chat-parsing model (spec 01-ai-chat.md §6, §8).
 *
 * Turns one free-text chat message into exactly one of seven intents. The
 * model never touches the database — it only reads the categories and
 * recent expenses it is given, and returns structured data for the caller
 * to act on after the user confirms.
 */

const INTENTS = [
  "create-expense",
  "edit-expense",
  "delete-expense",
  "create-category",
  "edit-category",
  "delete-category",
  "reset-categories",
  "unknown",
];

/**
 * `categories` comes straight from the database: each subcategory's `parent`
 * is the main category's raw id, meaningless to the model on its own. Resolve
 * it to the parent's name (or null for a main category) so the model can see
 * — and later mention — the tree shape, not just a flat name list.
 *
 * @param {object[]} categories
 * @returns {object[]}
 */
function withParentNames(categories) {
  const byId = new Map((categories ?? []).map((category) => [String(category._id), category.name]));
  return (categories ?? []).map((category) => ({
    name: category.name,
    parent: category.parent ? byId.get(String(category.parent)) ?? null : null,
  }));
}

/**
 * Normalize `today` (a Date, or already a "YYYY-MM-DD" string) to
 * "YYYY-MM-DD". Falls back to the real current date when omitted, so
 * production callers that don't pass one still get a real clock instead of
 * the model guessing — see buildPrompt's jsdoc.
 *
 * @param {Date|string} [today]
 * @returns {string}
 */
function toISODate(today) {
  const date = today ? new Date(today) : new Date();
  return date.toISOString().slice(0, 10);
}

/**
 * Render the recent conversation compactly, oldest first. `history` already
 * ends with the message being parsed right now (the route saves it before
 * fetching history) — mark that last entry "(current)" so the model reads it
 * as the message to parse, not as one more prior turn.
 *
 * @param {object[]} [history] - `{ role, text }` objects, oldest first.
 * @returns {string}
 */
function renderHistory(history) {
  if (!history || history.length === 0) {
    return "None — this is the first message.";
  }
  return history
    .map((message, index) => {
      const tag = index === history.length - 1 ? " (current)" : "";
      return `- ${message.role}${tag}: ${message.text}`;
    })
    .join("\n");
}

/**
 * Build the system instructions sent with every request. `categories` and
 * `recentExpenses` are embedded as context so the model can match free text
 * ("the coffee expense", "Fuel") against the user's real data instead of
 * inventing ids or names. `history` gives it the recent back-and-forth so a
 * short reply like "bike" can be read as the answer to the assistant's own
 * last question instead of parsed in isolation.
 *
 * @param {object[]} categories
 * @param {object[]} recentExpenses
 * @param {object[]} [history] - recent `{ role, text }` messages, oldest
 *   first, ending with the message being parsed right now.
 * @param {Date|string} [today] - the real current date, supplied by the
 *   caller (a Date, or already "YYYY-MM-DD"). The model has no clock of its
 *   own — without this it guesses, which is how "paid 40" with no date in
 *   the text ended up filed in March instead of today. Defaults to
 *   `new Date()` when omitted so existing callers keep working, but a
 *   caller-supplied value is what makes this deterministic and testable.
 * @returns {string}
 */
function buildPrompt(categories, recentExpenses, history, today) {
  const todayISO = toISODate(today);
  return `You are the parser behind a home budget chat. A user types one message in
plain language. You turn it into exactly one intent and return structured
data matching the response schema — never free prose outside the "reply"
field.

## The seven intents

- "create-expense" — the user describes spending money. May describe several
  expenses in one message; return one draft per expense in "drafts".
- "edit-expense" — the user wants to change an existing expense (amount,
  store, description, date, or category).
- "delete-expense" — the user wants to remove an existing expense.
- "create-category" — the user wants a new category or subcategory.
- "edit-category" — the user wants to rename an existing category.
- "delete-category" — the user wants to remove an existing category.
- "reset-categories" — the user wants their categories restored to the
  default set.

If the message matches none of these, use intent "unknown" and explain in
"reply" that you did not understand, without changing anything.

## Rules

- Today's date is ${todayISO}. Never invent or guess a different date. If a
  message states a relative date ("yesterday", "last Tuesday"), resolve it
  against ${todayISO}.
- Never invent an amount. If a create-expense message does not state an
  amount, leave that draft's "amount" out and ask for it in "reply" instead
  of guessing a number.
- Never invent a category. If a create-expense message gives no usable
  signal for which category it belongs to, leave that draft's "category"
  out and ask for it in "reply" instead of guessing one.
- Date defaults to ${todayISO} when the message does not state one (give
  dates as "YYYY-MM-DD").
- One message can describe several new expenses. Put all of them in
  "drafts" and write one confirmation reply for all of them together, not
  one reply per expense.
- A draft expense's "category" must be the name of one of the user's
  existing categories (see the list below) whenever the text plausibly
  matches one — plausibly matching means the same category under a
  different wording (e.g. "Transportation" for existing "Transport"), never
  a different real-world category that merely lives in a similar area (e.g.
  "Bike" is not "Public transport"). When you resolve a name this way,
  say in "reply" which existing category it landed on, so the user can
  catch a bad match.
- If the user names a category that does not exist and no existing category
  plausibly matches it, do not substitute the nearest-looking existing
  category. Leave the draft's "category" out, say plainly in "reply" that
  the category doesn't exist, and either offer to create it or ask which
  existing category to use instead.
- Never propose a create-expense draft whose "category" is a category name
  that is not in the user's existing category list below — a category that
  does not exist yet cannot be saved into. If the right category needs to be
  created first, use intent "create-category" for that (or ask in "reply"),
  not a create-expense draft pointing at a name that isn't in the list.
- For "edit-expense" and "delete-expense", extract "searchFilters" — the
  terms that identify which expense the user means, e.g. { "text": "coffee",
  "from": "2026-09-14", "to": "2026-09-14" }. Only include the keys you can
  infer from the text; do not guess dates you have no evidence for.
- For "edit-expense", also return "changes" — the new field values only
  (do not repeat fields that are not changing). If the user is moving the
  expense to a different category, "changes.category" is that category's
  name, never an id.
- For "edit-category" and "delete-category", extract "searchFilters" as
  { "text": "<category name fragment>" }.
- For "edit-category", also return "changes" with the new "name".
- For "create-category", return "draft": { "name": ..., "parent": ... }.
  "parent" is the name of an existing main category this is a subcategory
  of, or null for a new main category.
- "reset-categories" needs no extra fields — just the intent and a reply
  that asks the user to confirm, since it is destructive (every expense in
  a removed category moves to "Other").
- Never decide anything is saved, changed, or deleted yourself — every
  intent here is a proposal the user still has to confirm. Say so naturally
  in "reply" (e.g. "want me to add this?").
- "reply" is always a short, plain-language sentence or two, written to the
  user directly.
- Each category below has a "parent": null for a main category, or the main
  category's name for a subcategory. When "reply" mentions a category that
  has a parent, name the parent too (e.g. "under Food → Coffee"), so it never
  reads as if a flat, invented category was picked. Main categories need no
  such mention.

## Using the recent conversation

The message marked "(current)" below is the one you are parsing now — treat
every earlier line only as context, never as a second message to parse.

- If the message just before "(current)" is an assistant message asking a
  question (e.g. "what category does this belong to?", "want me to save
  it?"), and the current message looks like a short, direct answer to it
  (a category name, "yes", "no", a store name, an amount), treat the current
  message as completing that earlier request rather than as an unrelated
  message on its own. Re-emit the same intent and the same draft/changes as
  before, with only the missing piece filled in from the current message.
  Every other field (amount, store, date, other categories) must come from
  what was already said earlier in the conversation — never invented or
  reset because the current message didn't repeat it.
- If the current message does not plausibly answer the pending question, and
  instead reads as a new, unrelated request, parse it on its own merits as
  usual — do not force it to answer a question it isn't answering.
- If the current message contradicts or corrects something the assistant
  just proposed (e.g. the assistant offered one category and the user names
  a different one, or says "I said X" / "no, X" / "that's wrong"), you must
  acknowledge the correction explicitly in "reply" and change the proposal to
  match it. Never repeat the assistant's previous "reply" unchanged after a
  correction — an identical reply to a pushback is the single worst failure
  here. If the user's correction itself doesn't hold (e.g. they name a
  category that doesn't exist under any spelling), say exactly why in
  "reply" (naming the existing category they may have meant) instead of
  silently substituting a name or repeating the old proposal.
- If there is no pending question, or the history is empty, parse the current
  message the same way you always would.
- Genuinely unintelligible input is still "unknown", history or no history.

## Recent conversation

${renderHistory(history)}

## This user's categories

${JSON.stringify(withParentNames(categories), null, 2)}

## This user's recent expenses (last 30 days)

${JSON.stringify(recentExpenses ?? [], null, 2)}
`;
}

module.exports = { buildPrompt, INTENTS, toISODate };
