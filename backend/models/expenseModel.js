const mongoose = require("mongoose");
/**
 * Mongoose schema for an Expense document.
 * Every amount is a number of shekels — there is no currency field, and no
 * conversion (single currency for v1).
 *
 * @typedef {Object} Expense
 * @property {number} amount - Required, greater than 0, in shekels.
 * @property {string} [store] - Optional — the AI does not always find one.
 * @property {string} [description] - Optional.
 * @property {Date} date - Required, defaults to today.
 * @property {mongoose.Types.ObjectId} category - Required. The Category this
 *   expense belongs to. Moved to the user's "Other" category if its original
 *   category is deleted — see categoryModel.js.
 * @property {mongoose.Types.ObjectId} user - Required. The User who owns
 *   this expense.
 * @property {Date} createdAt - Set automatically to the creation time.
 */
const expenseSchema = new mongoose.Schema({
    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [0.01, 'Amount must be greater than 0']
    },
    store: {
        type: String
    },
    description: {
        type: String
    },
    date: {
        type: Date,
        required: [true, 'Date is required'],
        default: Date.now
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category",
        required: [true, 'Category is required']
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, 'User is required']
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Every dashboard query is "this user, this period", so this is the index
// that matters.
expenseSchema.index({ user: 1, date: 1 });

expenseSchema.set("toJSON", { virtuals: true });

/**
 * The Expense model. Use this to create, read, update, and delete expenses.
 * @type {mongoose.Model<Expense>}
 */
const Expense = mongoose.model("Expense", expenseSchema);
module.exports = Expense;