const Expense = require('../models/expenseModel');
const mongoose = require("mongoose");

/**
 * Data-access layer for expenses.
 *
 * Talks only to the `Expense` model. Every function returns the Mongoose
 * query/promise directly; the caller awaits it. A finder resolves to `null`
 * when nothing matches.
 *
 * See docs/specs/08-expense-category-dal.md.
 */

/**
 * Create and save a new expense.
 * @param {object} obj
 * @returns {Promise<import('mongoose').Document>}
 */
const createExpense = (obj) => {
    const newExpense = new Expense(obj);
    return newExpense.save();
}

/**
 * Save many expenses at once, in one insert.
 * @param {object[]} docs
 * @returns {Promise<import('mongoose').Document[]>}
 */
const createManyExpenses = (docs) => {
    return Expense.insertMany(docs);
}

/** Push a date-only `to` bound to the end of that calendar day, so filters
 *  like $lte: "2026-09-15" include the whole day, not just its midnight. */
const endOfDay = (date) => {
    const d = new Date(date);
    d.setUTCHours(23, 59, 59, 999)
    return d;
}

/** Parse a date-only `from` bound as midnight UTC of that calendar day, to
 *  match how the end-of-day bound is parsed. */
const startOfDay = (date) => {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0)
    return d;
}


/**
 * Find a user's expenses, filtered by date range and/or free text.
 *
 * `filters.from`/`filters.to` narrow by `date` ($gte/$lte). `filters.text`
 * matches `store` or `description`, case-insensitive, partial match.
 *
 * @param {string} userId
 * @param {{ from?: Date, to?: Date, text?: string }} filters
 * @returns {Promise<import('mongoose').Document[]>}
 */
const queryExpenses = (userId, filters) => {
    const query = { user: userId };
    if (filters.from || filters.to) {
        query.date = {};
        if (filters.from) query.date.$gte = startOfDay(filters.from);
        if (filters.to) query.date.$lte = endOfDay(filters.to);
    }
    if (filters.text) {
        const escapedText = filters.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escapedText, 'i');
        query.$or = [{ store: pattern }, { description: pattern }];
    }
    return Expense.find(query);
}

/**
 * Total spending per category, for a user, optionally within a date range.
 * A Mongo aggregation ($match/$group/$sum), not a JS loop over fetched docs.
 * @param {string} userId
 * @param {Date} [from]
 * @param {Date} [to]
 * @returns {Promise<{ _id: string, total: number }[]>}
 */
const getExpenseTotalByCategory = (userId, from, to) => {

    const match = { user: new mongoose.Types.ObjectId(userId) };
    if (from || to) {
        match.date = {};
        if (from) match.date.$gte = startOfDay(from);
        if (to) match.date.$lte = endOfDay(to);
    }

    const results = Expense.aggregate([
        {
            $match: match
        },
        {
            $group: {
                _id: "$category",
                total: { $sum: "$amount" }
            }
        }
    ]);
    return results;

}

/**
 * Update one expense by id.
 *
 * `runValidators: true` is not optional here. Mongoose runs schema validators
 * on `.save()` but skips them on update queries, so without it an edit could
 * set an `amount` the same schema refuses on create — a negative figure, or
 * more than two decimal places. A failure throws a Mongoose `ValidationError`,
 * which `error_handling.js` turns into a 400.
 *
 * @param {string} id
 * @param {object} obj - fields to change
 * @returns {Promise<import('mongoose').Document|null>} the document after the update (`{ new: true }`)
 * @throws {import('mongoose').Error.ValidationError} if a changed field breaks a schema rule
 */
const updateExpense = (id, obj) => {
        return Expense.findOneAndUpdate({ _id: id }, obj, { new: true, runValidators: true });
}

/**
 * Delete one expense by id.
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>} the deleted document, or null
 */
const deleteExpense = (id) => {
    return Expense.findByIdAndDelete(id);
}

/**
 * Find one expense by its id.
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>}
 */
const findExpenseById = (id) => {
    return Expense.findById(id);
}

/**
 * Point every one of a user's expenses at a different category.
 * Used to move a user's expenses to "Other" before their categories are reset.
 * @param {string} userId
 * @param {string} categoryId
 * @returns {Promise<import('mongoose').mongo.UpdateResult>}
 */
const reassignExpensesToCategory = (userId, categoryId) => {
    return Expense.updateMany({ user: userId }, { category: categoryId });
}



module.exports = {
    createExpense,
    createManyExpenses,
    queryExpenses,
    getExpenseTotalByCategory,
    updateExpense,
    deleteExpense,
    findExpenseById,
    reassignExpensesToCategory
}
