const expenseRepository = require('../dal/expenseRepository.js');
const categoryService = require('./categoryService.js');

/**
 * Resolve a category name (as returned by the AI parser) to a category
 * document owned by this user. Private helper, not exported.
 * @param {string} userId
 * @param {string} categoryNameOrId
 * @returns {Promise<import('mongoose').Document>}
 * @throws {{status: 400, message: string}} no category name given, no match, or more than one match
 */
const resolveCategory = async (userId, categoryNameOrId) => {

    if (!categoryNameOrId) {
        throw { status: 400, message: "Which category should this go under?" };
    }
    const category = await categoryService.findByName(userId, categoryNameOrId);
    if (category.length === 0) {
        throw { status: 400, message: `No category named "${categoryNameOrId}". Create it first?` };
    }
    if (category.length > 1) {
        throw { status: 400, message: `More than one category matches "${categoryNameOrId}".`, candidates: category };
    } else {
        return category[0];
    }
}

/**
 * A user's expenses, filtered by date range and/or free text. Plain read, no
 * rules to enforce.
 * @param {string} userId
 * @param {{ from?: Date, to?: Date, text?: string }} filters
 * @returns {Promise<import('mongoose').Document[]>}
 */
const getForUser = (userId, filters) => {
    return expenseRepository.queryExpenses(userId, filters);
}

/**
 * Create one expense, resolving its category name to a real category first.
 * @param {string} userId
 * @param {{ amount: number, store?: string, description?: string, date?: Date, category: string }} draft
 * @returns {Promise<import('mongoose').Document>} the saved expense
 */
const createExpense = async (userId, { amount, store, description, date, category }) => {
    const categoryDoc = await resolveCategory(userId, category);
    return expenseRepository.createExpense({ amount, store, description, date, category: categoryDoc._id, user: userId });
}

/**
 * Create many expenses at once. Every draft's category is resolved before
 * anything is written, so one bad category name fails the whole batch
 * instead of leaving a partial save.
 * @param {string} userId
 * @param {object[]} drafts
 * @returns {Promise<import('mongoose').Document[]>} the saved expenses
 */
const createManyExpenses = async (userId, drafts) => {
    const docs = await Promise.all(drafts.map(async (draft) => {
        const categoryDoc = await resolveCategory(userId, draft.category);
        return { ...draft, category: categoryDoc._id, user: userId };
    }));
    return expenseRepository.createManyExpenses(docs);
}

/**
 * Edit one of this user's expenses. If `changes.category` is a name, it is
 * resolved to a category id first.
 * @param {string} userId
 * @param {string} id
 * @param {object} changes
 * @returns {Promise<import('mongoose').Document>} the updated expense
 * @throws {{status: 404, message: string}} not found, or belongs to another user
 */
const editExpense = async (userId, id, changes) => {
    const expense = await expenseRepository.findExpenseById(id);
    if (!expense || expense.user.toString() !== userId) {
        throw { status: 404, message: "Expense not found." };
    }
    if (changes.category) {
        const categoryDoc = await resolveCategory(userId, changes.category);
        changes.category = categoryDoc._id;
    }
    return expenseRepository.updateExpense(id, changes);
}

/**
 * Delete one of this user's expenses.
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>} the deleted expense
 * @throws {{status: 404, message: string}} not found, or belongs to another user
 */
const deleteExpense = async (userId, id) => {
    const expense = await expenseRepository.findExpenseById(id);
    if (!expense || expense.user.toString() !== userId) {
        throw { status: 404, message: "Expense not found." };
    }
    return expenseRepository.deleteExpense(id);
}

module.exports = {
    getForUser,
    createExpense,
    createManyExpenses,
    editExpense,
    deleteExpense
}