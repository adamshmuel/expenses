const categoryRepository = require('../dal/categoryRepository.js');
const expenseRepository = require('../dal/expenseRepository.js');
const defaultCategories = require('../constants/defaultCategories');

/**
 * Business-logic layer for categories.
 *
 * Enforces the rules from docs/specs/04-data-model.md explicitly — two
 * levels deep, no duplicate name under the same parent, "Other" cannot be
 * renamed or deleted — before calling the repository. Talks to the database
 * only through `categoryRepository`/`expenseRepository`; never imports a
 * model. Signals failure by throwing `{ status, message }`, which the route
 * turns into that HTTP status.
 *
 * See docs/specs/09-expense-category-service.md, section 2.
 */

/**
 * Get every category a user owns.
 * @param {string} userId
 * @returns {Promise<import('mongoose').Document[]>}
 */
const getForUser = (userId) => {
    return categoryRepository.getCategoriesByUser(userId);
}

/**
 * Match a user's own categories by name (case-insensitive) and, if given, by parent.
 * @param {string} userId
 * @param {string} name
 * @param {string} [parentId]
 * @returns {Promise<import('mongoose').Document[]>} zero, one, or several matches
 */
const findByName = async (userId, name, parentId) => {
    const userCategories = await categoryRepository.getCategoriesByUser(userId);
    return userCategories.filter(category => {
        const nameMatches = category.name.toLowerCase() === name.toLowerCase();
        const parentMatches = parentId ? String(category.parent) === String(parentId) : true;
        return nameMatches && parentMatches;
    });
}

/**
 * Create a main category, or a subcategory under an existing main category.
 *
 * @param {string} userId
 * @param {{ name: string, parent?: string }} fields - `parent`, if given, is
 *   the *name* of an existing main category owned by this user (that is what
 *   the AI sends — never an id); it is resolved to that category's `_id` here
 *   before anything is stored
 * @returns {Promise<import('mongoose').Document>}
 * @throws {{status:400,message:string}} no such parent, the parent name is
 *   ambiguous, or the parent is itself a subcategory
 * @throws {{status:409,message:string}} a category with this name already exists under the same parent
 */
const createCategory = async (userId, { name, parent }) => {

    let parentId = null;
    if (parent) {
        const parentMatches = await findByName(userId, parent);
        if (parentMatches.length === 0) {
            throw { status: 400, message: "No such category to add a subcategory to." };
        }
        if (parentMatches.length > 1) {
            throw { status: 400, message: `More than one category named "${parent}".` };
        }
        const parentDoc = parentMatches[0];
        if (!parentDoc || String(parentDoc.owner) !== String(userId)) {
            throw { status: 400, message: "No such category to add a subcategory to." };
        }
        if (parentDoc.parent) {
            throw { status: 400, message: "Categories can only be two levels deep." };
        }
        parentId = parentDoc._id;
    }
    const existing = await findByName(userId, name, parentId);
    if (existing.length > 0) {
        throw { status: 409, message: `A category named "${name}" already exists here.` };
    }
    return categoryRepository.createCategory({ name, parent: parentId, owner: userId });
}

/**
 * Rename a category owned by this user.
 *
 * @param {string} userId
 * @param {string} id
 * @param {{ name: string }} fields
 * @returns {Promise<import('mongoose').Document|null>} the renamed document
 * @throws {{status:404,message:string}} not found, or belongs to another user
 * @throws {{status:400,message:string}} the category is "Other"
 * @throws {{status:409,message:string}} another category already has this name under the same parent
 */
const updateCategory = async (userId, id, { name }) => {
    const category = await categoryRepository.findCategoryById(id);
    if (!category || String(category.owner) !== String(userId)) {
        throw { status: 404, message: "Category not found." };
    }
    if (category.isProtected) {
        throw { status: 400, message: "\"Other\" cannot be renamed." };
    }

    const existing = await findByName(userId, name, category.parent);
    const otherMatches = existing.filter(category => String(category._id) !== String(id));
    if (otherMatches.length > 0) {
        throw { status: 409, message: `A category named "${name}" already exists here.` };
    }
    return categoryRepository.updateCategory(id, { name: name });
}

/**
 * Delete a category owned by this user.
 * The model's `pre("findOneAndDelete")` hook moves its expenses (and, for a
 * main category, its subcategories' expenses) to "Other" before it is removed.
 *
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<import('mongoose').Document|null>}
 * @throws {{status:404,message:string}} not found, or belongs to another user
 * @throws {{status:400,message:string}} the category is "Other"
 */
const deleteCategory = async (userId, id) => {
    const category = await categoryRepository.findCategoryById(id);
    if (!category || String(category.owner) !== String(userId)) {
        throw { status: 404, message: "Category not found." };
    }
    if (category.isProtected) {
        throw { status: 400, message: "\"Other\" cannot be deleted." };
    }
    return categoryRepository.deleteCategory(id);
}

/**
 * Create a fresh set of default categories for one user, from
 * `constants/defaultCategories.js`. Used by both sign-up (a new user's first
 * categories) and `resetToDefaults` (after their old ones are cleared out),
 * so the two can never drift apart.
 *
 * Two passes: mains are saved first (so they have real `_id`s), then
 * subcategories are built using those saved mains' ids and saved too.
 *
 * @param {string} userId
 * @returns {Promise<import('mongoose').Document[]>} the newly created categories, mains and subcategories together
 */
const seedDefaultCategories = async (userId) => {

    const mainCategories = [];

    for (const entry of defaultCategories) {
        mainCategories.push({ name: entry.name, parent: null, owner: userId, isProtected: !!entry.isProtected });
    }

    const defaultMainCategories = await categoryRepository.createManyCategories(mainCategories);

    const subcategories = [];

    for (const entry of defaultCategories) {
        if (entry.subcategories.length > 0) {
            const mainCategory = defaultMainCategories.find(category => category.name === entry.name);
            for (const subcategory of entry.subcategories) {
                subcategories.push({ name: subcategory, parent: mainCategory._id, owner: userId });
            }
        }
    }

    const defaultSubcategories = await categoryRepository.createManyCategories(subcategories);
    return defaultMainCategories.concat(defaultSubcategories);
}


/**
 * Wipe a user's categories and replace them with a fresh default set.
 * For the chat's `reset-categories` intent — no search, no match, applies to
 * all of this user's categories at once.
 *
 * Every expense is reassigned to "Other" before anything is deleted, so
 * nothing is left pointing at a category about to be removed. The delete
 * itself relies on the model's `pre("deleteMany")` hook allowing a protected
 * category ("Other") through specifically for a single-owner reset.
 *
 * @param {string} userId
 * @returns {Promise<import('mongoose').Document[]>} the newly created default categories
 */
const resetToDefaults = async (userId) => {
    await categoryRepository.deleteCategoriesByUser(userId);
    const newCategories = await seedDefaultCategories(userId);
    const newOther = newCategories.find(c => c.name === "Other");
    await expenseRepository.reassignExpensesToCategory(userId, newOther._id);
    return newCategories;
}



module.exports = {
    getForUser,
    findByName,
    createCategory,
    updateCategory,
    deleteCategory,
    seedDefaultCategories,
    resetToDefaults
}
