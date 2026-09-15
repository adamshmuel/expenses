const express = require('express');
const router = express.Router();
const { catchAsync } = require('../error_handling');
const requireAuth = require('../middleware/requireAuth')
const categoryService = require('../bl/categoryService.js');
const expenseService = require('../bl/expenseService.js');
const { parseMessage } = require('../ai');
const Message = require('../models/messageModel');


/**
 * Request one of the chat flow (see docs/specs/09-expense-category-service.md
 * §4). Saves the user's message, sends it to the AI along with the user's
 * categories and last 30 days of expenses, and returns the parsed intent
 * plus whatever the user needs to confirm: drafts for a create, or search
 * matches to choose from for an edit/delete. No database write happens here
 * beyond the two chat messages — the actual change waits for /chat/confirm.
 */
router.post('/chat/messages', requireAuth, catchAsync(async (req, res) => {

    await Message.create({
        text: req.body.text,
        role: "user",
        author: req.user.id
    });
    const categories = await categoryService.getForUser(req.user.id);
    const recent = await expenseService.getForUser(req.user.id, { from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    const result = await parseMessage(req.body.text, categories, recent);

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

    const reply = await Message.create({
        text: result.reply,
        role: "assistant",
        author: req.user.id
    });

    res.json({
        reply: reply.text,
        intent: result.intent,
        drafts: result.drafts,
        draft: result.draft,
        matches
    });
}));

/**
 * Request two of the chat flow (see docs/specs/09-expense-category-service.md
 * §4). The client sends back the intent from /chat/messages plus either the
 * confirmed draft(s) (create) or the chosen id and change (edit/delete/reset).
 * Calls the one matching service function and returns what changed. Never
 * calls the AI again — the text was already parsed in request one.
 */
router.post('/chat/confirm', requireAuth, catchAsync(async (req, res) => {

    const { intent, id, changes, drafts, draft } = req.body;

    let changed;

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

    res.json({ changed });
}));



module.exports = router;
