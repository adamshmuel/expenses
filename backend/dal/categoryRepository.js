const Category = require('../models/categoryModel');

const getCategoriesByUser = (userId) => {
    return Category.find({owner: userId})
}

const findCategoryById = (id) => {
    return Category.findOne({ _id: id })
}

const findOtherCategory = (userId) => {
    return Category.findOne({name: "Other", owner: userId, parent: null})
}

const createCategory = (obj) => {
    const newCategory = new Category(obj);
    return newCategory.save(); 
}

const updateCategory = (id, obj) => {
    return Category.findOneAndUpdate({ _id: id }, obj, { new: true });
}

const deleteCategory = (id) => {
    return Category.findByIdAndDelete(id);
}

const createManyCategories = (docs) => {
    return Category.insertMany(docs);
}

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