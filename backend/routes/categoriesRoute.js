const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/requireAuth.js')
const { catchAsync } = require('../error_handling.js');
const categoryService = require('../bl/categoryService.js');

/**
 * GET /categories — this user's category list, for the dashboard
 * (docs/specs/09-expense-category-service.md §5). Read-only.
 */
router.get('/', requireAuth, catchAsync(async (req, res) => {
    const categories = await categoryService.getForUser(req.user.id);
    res.json(categories);
}));


module.exports = router;
