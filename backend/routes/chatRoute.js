const express = require('express');
const router = express.Router();
const { catchAsync } = require('../error_handling.js');
const requireAuth = require('../middleware/requireAuth.js')
const categoryService = require('../bl/categoryService.js');
const expenseService = require('../bl/expenseService.js');
const messageService = require('../bl/messageService.js');
const { parseMessage } = require('../ai/index.js');



/**
 * GET /chat/messages?limit= — chat history (docs/specs/01-ai-chat.md §5, §9).
 * Read-only. Returns this user's most recent `limit` messages (default 50),
 * oldest first — fetched newest-first so `.limit` keeps the right end, then
 * reversed for display order.
 */
router.get('/messages', requireAuth, catchAsync(async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json(await messageService.getHistory(req.user.id, limit));
}));

/**
 * Request one of the chat flow (see docs/specs/09-expense-category-service.md
 * §4). Saves the user's message, sends it to the AI along with the user's
 * categories, last 30 days of expenses, and the last 10 chat messages (so a
 * short follow-up — "bike", "yes" — is read against what was just asked,
 * not as a new message with no context), and returns the parsed intent
 * plus whatever the user needs to confirm: drafts for a create, or search
 * matches to choose from for an edit/delete. No database write happens here
 * beyond the two chat messages — the actual change waits for /chat/confirm.
 */
router.post('/messages', requireAuth, catchAsync(async (req, res) => {

    await messageService.saveMessage(req.user.id, req.body.text, "user");
    const categories = await categoryService.getForUser(req.user.id);
    const recent = await expenseService.getForUser(req.user.id, { from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    const history = await messageService.getHistory(req.user.id, 10);
    const result = await parseMessage(req.body.text, categories, recent, history);


    let matches;

    switch (result.intent) {
        case "edit-expense":
        case "delete-expense":
            matches = await expenseService.getForUser(req.user.id, result.searchFilters);
            break;
        case "edit-category":
        case "delete-category":
            matches = await categoryService.findByName(req.user.id, result.searchFilters.text);
            break;
        // create-expense, create-category, reset-categories: nothing to do here
    }

    const reply = await messageService.saveMessage(req.user.id, result.reply, "assistant");

    res.json({
        reply: reply.text,
        intent: result.intent,
        drafts: result.drafts,
        draft: result.draft,
        changes: result.changes,
        matches
    });
}));

/**
 * Request two of the chat flow (see docs/specs/09-expense-category-service.md
 * §4). The client sends back the intent from /chat/messages plus either the
 * confirmed draft(s) (create) or the chosen id and change (edit/delete/reset).
 * Calls the one matching service function and returns what changed. Never
 * calls the AI again — the text was already parsed in request one.
 *
 * Either way, the outcome is written to the chat as an assistant message:
 * "Done." when the change went through, the thrown error's own message when
 * it did not. The chat is this app's record of what happened, so a change
 * that left no line in it would be invisible after a reload. The catch
 * re-throws once it has saved, so the status the client receives is
 * unchanged — the message is a record, not a replacement for the error.
 */
router.post('/confirm', requireAuth, catchAsync(async (req, res) => {

    const { intent, id, changes, drafts, draft } = req.body;

    let changed;

    try {
        switch (intent) {
            case "create-expense":
                changed = drafts.length > 1
                    ? await expenseService.createManyExpenses(req.user.id, drafts)
                    : await expenseService.createExpense(req.user.id, drafts[0]);
                break;
            case "create-category":
                changed = await categoryService.createCategory(req.user.id, draft);
                break;
            case "edit-expense":
                changed = await expenseService.editExpense(req.user.id, id, changes);
                break;
            case "delete-expense":
                changed = await expenseService.deleteExpense(req.user.id, id);
                break;
            case "edit-category":
                changed = await categoryService.updateCategory(req.user.id, id, changes);
                break;
            case "delete-category":
                changed = await categoryService.deleteCategory(req.user.id, id);
                break;
            case "reset-categories":
                changed = await categoryService.resetToDefaults(req.user.id);
                break;
        }
    } catch (error) {
        await messageService.saveMessage(req.user.id, error.message ?? "That didn't work.", "assistant");
        throw error;
    }

    await messageService.saveMessage(req.user.id, "Done.", "assistant");
    res.json({ changed });
}));



module.exports = router;
