const Expense = require('../models/expenseModel');

const createExpense = (obj) => {
    const newExpense = new Expense(obj);
    return newExpense.save();
}

const createManyExpenses = (docs) => {
    return Expense.insertMany(docs);
}

const queryExpenses = (userId, filters) => {
    const query = { user: userId };
    if (filters.from || filters.to) {
        query.date = {};
        if (filters.from) query.date.$gte = filters.from;
        if (filters.to) query.date.$lte = filters.to;
    }
    if (filters.text) {
        const pattern = new RegExp(filters.text, 'i');
        query.$or = [{ store: pattern }, { description: pattern }];
    }
    return Expense.find(query);
}


const getExpenseTotalByCategory = (userId, from, to) => {

    const match = { user: userId };
    if (from || to) {
        match.date = {};
        if (from) match.date.$gte = from;
        if (to) match.date.$lte = to;
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

const updateExpense = (id, obj) => {
    return Expense.findOneAndUpdate({ _id: id }, obj, { new: true });
}

const deleteExpense = (id) => {
    return Expense.findByIdAndDelete(id);
}



module.exports = {
    createExpense,
    createManyExpenses,
    queryExpenses,
    getExpenseTotalByCategory,
    updateExpense,
    deleteExpense
}