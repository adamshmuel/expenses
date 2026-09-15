const mongoose = require("mongoose");

/**
 * Mongoose schema for a Category document.
 * Categories are two levels deep: a document with no `parent` is a main
 * category, and one with a `parent` is a subcategory of that main category.
 * A subcategory can never itself have subcategories.
 *
 * @typedef {Object} Category
 * @property {string} name - Required, trimmed.
 * @property {mongoose.Types.ObjectId} [parent] - The main category this
 *   belongs to. Missing/empty means this document is itself a main category.
 * @property {mongoose.Types.ObjectId} owner - Required. The User who owns
 *   this category — categories are private per user, never shared.
 * @property {boolean} isProtected - True only for the "Other" category.
 *   Blocks renaming, unprotecting, and deleting.
 */
const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Category name is required'],
        trim: true
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category"
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, 'Owner is required']
    },
    isProtected: {
        type: Boolean,
        default: false
    }
});

categorySchema.index({ owner: 1, parent: 1, name: 1 }, { unique: true });
categorySchema.index({ owner: 1 });

/**
 * Runs before a Category is created.
 * Rejects it if `isProtected` is set on anything but "Other", or if its
 * `parent` is itself a subcategory (which would make three levels deep).
 */
categorySchema.pre("save", async function () {
    if (this.isProtected === true && this.name !== "Other") {
        throw new Error("Only the 'Other' category can be protected");
    }

    if (!this.parent) {
        return;
    }

    const parentCategory = await mongoose.model("Category").findById(this.parent);

    if (!parentCategory) {
        throw new Error("Parent category does not exist");
    }

    if (parentCategory.parent) {
        throw new Error("A subcategory cannot have a parent that is itself a subcategory");
    }
});

/**
 * Runs before a Category is updated via findOneAndUpdate.
 * Rejects the update if it would rename or unprotect a protected category,
 * or set a `parent` that is itself a subcategory.
 */
categorySchema.pre("findOneAndUpdate", async function () {

    const update = this.getUpdate();

    const parentValue =
        update.parent !== undefined ? update.parent : undefined;

    const isProtectedValue =
        update.isProtected !== undefined ? update.isProtected : undefined;

    const nameValue =
        update.name !== undefined ? update.name : undefined;

    const docToUpdate = await this.model.findOne(this.getFilter());

    if (!docToUpdate) {
        return ;
    }

    if (docToUpdate.isProtected === true) {
        if (nameValue !== undefined && nameValue !== "Other") {
            throw new Error("Protected categories cannot be renamed");
        }

        if (isProtectedValue === false) {
            throw new Error("Protected categories cannot be unprotected");
        }
    }

    if (parentValue !== undefined && parentValue !== null) {
        const parentCategory = await mongoose.model("Category").findById(parentValue);

        if (!parentCategory) {
            throw new Error("Parent category does not exist");
        }

        if (parentCategory.parent) {
            throw new Error("A subcategory cannot have a parent that is itself a subcategory");
        }
    }
});

/**
 * Runs before a Category is deleted via findOneAndDelete.
 * Rejects the delete if the category is protected.
 *
 * Otherwise, re-points that user's expenses to their "Other" category before
 * the delete goes through, so spending history is never lost:
 *  - if this is a main category (no `parent`), its subcategories' expenses
 *    move to "Other" too, and the subcategories are then deleted;
 *  - the category being deleted itself always has its expenses moved.
 */
categorySchema.pre("findOneAndDelete", async function () {

    const docToDelete = await this.model.findOne(this.getFilter());

    if (!docToDelete) {
        return;
    }

    if (docToDelete.isProtected === true) {
        throw new Error("Protected categories cannot be deleted");
    }
    const otherCategory = await this.model.findOne({ owner: docToDelete.owner, name: "Other" });

    let categoryIdsToMove = [docToDelete._id];

    if (!docToDelete.parent) {
        const subcategories = await this.model.find({ parent: docToDelete._id });
        const subcategoryIds = subcategories.map(sub => sub._id);
        categoryIdsToMove = categoryIdsToMove.concat(subcategoryIds);
    }

    const Expense = mongoose.model("Expense");

    await Expense.updateMany(
        { category: { $in: categoryIdsToMove } },
        { category: otherCategory._id }
    );

    if (!docToDelete.parent) {
        await this.model.deleteMany({ parent: docToDelete._id });
    }
});


/**
 * Runs before a bulk Category delete via deleteMany.
 *
 * A single-owner reset (`deleteMany({ owner: userId })`, i.e. the filter has
 * exactly one key, `owner`) is let through even though it always matches the
 * user's protected "Other" — the caller is expected to have already moved
 * that user's expenses off every category being deleted (see
 * `categoryService.resetToDefaults`, docs/specs/09-expense-category-service.md).
 *
 * Any other deleteMany call is rejected if it would match a protected
 * category, same as the single-document delete hook above.
 */
categorySchema.pre("deleteMany", async function () {
    const keys = Object.keys(this.getFilter());
    const isSingleOwnerReset = keys.length === 1 && keys[0] === 'owner';

    if (isSingleOwnerReset) {
        return;
    }

    const docs = await this.model.find(this.getFilter());
    const hasProtectedCategory = docs.some(doc => doc.isProtected === true);

    if (hasProtectedCategory) {
        throw new Error("Protected categories cannot be deleted");
    }
});


categorySchema.set("toJSON", { virtuals: true });

/**
 * The Category model. Use this to create, read, update, and delete categories.
 * @type {mongoose.Model<Category>}
 */
const Category = mongoose.model("Category", categorySchema);
module.exports = Category;