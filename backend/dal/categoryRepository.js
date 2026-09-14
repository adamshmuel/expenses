const Category = require('../models/categoryModel');

/**
 * Data-access layer for categories.
 *
 * Talks only to the `Category` model. Every function returns the Mongoose
 * query/promise directly; the caller awaits it. A finder resolves to `null`
 * when nothing matches.
 *
 * See docs/specs/08-expense-category-dal.md.
 */

/**
 * Find every category a user owns.
 * @param {string} userId
 * @returns {Promise<import('mongoose').Document[]>}
 */
const getCategoriesByUser = (userId) => {
    return Category.find({owner: userId})
}

/**
 * Find one category by its id.
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>}
 */
const findCategoryById = (id) => {
    return Category.findOne({ _id: id })
}

/**
 * Find a user's protected "Other" main category.
 * @param {string} userId
 * @returns {Promise<import('mongoose').Document|null>}
 */
const findOtherCategory = (userId) => {
    return Category.findOne({name: "Other", owner: userId, parent: null})
}

/**
 * Create and save a new category.
 * @param {{ name: string, parent: string|null, owner: string, isProtected?: boolean }} obj
 * @returns {Promise<import('mongoose').Document>}
 */
const createCategory = (obj) => {
    const newCategory = new Category(obj);
    return newCategory.save();
}

/**
 * Update one category by id.
 * @param {string} id
 * @param {object} obj - fields to change
 * @returns {Promise<import('mongoose').Document|null>} the document after the update (`{ new: true }`)
 */
const updateCategory = (id, obj) => {
    return Category.findOneAndUpdate({ _id: id }, obj, { new: true });
}

/**
 * Delete one category by id.
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>} the deleted document, or null
 */
const deleteCategory = (id) => {
    return Category.findByIdAndDelete(id);
}

/**
 * Save many categories at once, in one insert.
 * @param {object[]} docs
 * @returns {Promise<import('mongoose').Document[]>}
 */
const createManyCategories = (docs) => {
    return Category.insertMany(docs);
}

/**
 * Delete every category a user owns.
 * @param {string} userId
 * @returns {Promise<import('mongoose').mongo.DeleteResult>}
 */
const deleteCategoriesByUser = (userId) => {
    return Category.deleteMany({owner: userId})
}

module.exports = {
    getCategoriesByUser,
    findCategoryById,
    findOtherCategory,
    createCategory,
    updateCategory,
    deleteCategory,
    createManyCategories,
    deleteCategoriesByUser
}
