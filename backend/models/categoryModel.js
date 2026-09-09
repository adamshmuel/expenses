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
categorySchema.pre("save", async function (next) {
    if (this.isProtected === true && this.name !== "Other") {
        return next(new Error("Only the 'Other' category can be protected"));
    }

    if (!this.parent) {
        return next();
    }

    const parentCategory = await mongoose.model("Category").findById(this.parent);

    if (!parentCategory) {
        return next(new Error("Parent category does not exist"));
    }

    if (parentCategory.parent) {
        return next(new Error("A subcategory cannot have a parent that is itself a subcategory"));
    }

    next();
});

/**
 * Runs before a Category is updated via findOneAndUpdate.
 * Rejects the update if it would rename or unprotect a protected category,
 * or set a `parent` that is itself a subcategory.
 */
categorySchema.pre("findOneAndUpdate", async function (next) {

    const update = this.getUpdate();

    const parentValue =
        update.parent !== undefined ? update.parent : undefined;

    const isProtectedValue =
        update.isProtected !== undefined ? update.isProtected : undefined;

    const nameValue =
        update.name !== undefined ? update.name : undefined;

    const docToUpdate = await this.model.findOne(this.getFilter());

    if (!docToUpdate) {
    return next();
}

    if (docToUpdate.isProtected === true) {
        if (nameValue !== undefined && nameValue !== "Other") {
            return next(new Error("Protected categories cannot be renamed"));
        }

        if (isProtectedValue === false) {
            return next(new Error("Protected categories cannot be unprotected"));
        }
    }

    if (parentValue !== undefined && parentValue !== null) {
        const parentCategory = await mongoose.model("Category").findById(parentValue);

        if (!parentCategory) {
            return next(new Error("Parent category does not exist"));
        }

        if (parentCategory.parent) {
            return next(new Error("A subcategory cannot have a parent that is itself a subcategory"));
        }
    }

    next();
});

/**
 * Runs before a Category is deleted via findOneAndDelete.
 * Rejects the delete if the category is protected.
 */
categorySchema.pre("findOneAndDelete", async function (next) {

    const docToDelete = await this.model.findOne(this.getFilter());

    if (!docToDelete) {
        return next();
    }

    if (docToDelete.isProtected === true) {
        return next(new Error("Protected categories cannot be deleted"));
    }

    next();
});

/**
 * Runs before a bulk Category delete via deleteMany.
 * Rejects the whole operation if any matched category is protected.
 */
categorySchema.pre("deleteMany", async function (next) {
    const docs = await this.model.find(this.getFilter());

    const hasProtectedCategory = docs.some(doc => doc.isProtected === true);

    if (hasProtectedCategory) {
        return next(new Error("Protected categories cannot be deleted"));
    }

    next();
});

categorySchema.set("toJSON", { virtuals: true });

/**
 * The Category model. Use this to create, read, update, and delete categories.
 * @type {mongoose.Model<Category>}
 */
const Category = mongoose.model("Category", categorySchema);
module.exports = Category;