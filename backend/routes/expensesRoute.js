const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth.js')
const { catchAsync } = require('../error_handling.js');
const expenseService = require('../bl/expenseService.js');
const expenseRepository = require('../dal/expenseRepository.js');

/**
 * GET /expenses?from=&to= — recent-expenses list for the dashboard
 * (docs/specs/09-expense-category-service.md §5). Read-only; scoped to the
 * logged-in user.
 */
router.get('/', requireAuth, catchAsync(async (req, res) => {
    const { from, to } = req.query;
    const expenses = await expenseService.getForUser(req.user.id, { from, to });
    res.json(expenses);
}));

/**
 * GET /expenses/summary?from=&to= — category breakdown for the dashboard.
 * Calls the repository directly, skipping the service layer — a plain
 * aggregation read with no rule to enforce (spec 09 §5).
 */
router.get('/summary', requireAuth, catchAsync(async (req, res) => {
    const { from, to } = req.query;
    const summary = await expenseRepository.getExpenseTotalByCategory(req.user.id, from, to);
    res.json(summary);
}));

module.exports = router;
