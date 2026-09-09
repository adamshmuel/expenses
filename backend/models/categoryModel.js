const mongoose = require("mongoose");

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

categorySchema.pre("deleteMany", async function (next) {
    const docs = await this.model.find(this.getFilter());

    const hasProtectedCategory = docs.some(doc => doc.isProtected === true);

    if (hasProtectedCategory) {
        return next(new Error("Protected categories cannot be deleted"));
    }

    next();
});

categorySchema.set("toJSON", { virtuals: true });
const Category = mongoose.model("Category", categorySchema);
module.exports = Category;