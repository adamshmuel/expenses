/**
 * The default category set copied to every new user at sign-up, and again on
 * reset — see docs/specs/04-data-model.md. Plain data, not Category
 * documents: no `owner`, and subcategory names are plain strings, not
 * `parent` references. `categoryService.seedDefaultCategories` is what turns
 * this into real documents for one user.
 *
 * @type {{ name: string, subcategories: string[], isProtected?: boolean }[]}
 */
module.exports = [
  { name: "Food", subcategories: ["Groceries", "Restaurants", "Coffee"] },
  { name: "Transport", subcategories: ["Fuel", "Public transport", "Parking"] },
  { name: "Home", subcategories: ["Rent", "Utilities", "Internet"] },
  { name: "Health", subcategories: [] },
  { name: "Clothing", subcategories: [] },
  { name: "Entertainment", subcategories: [] },
  { name: "Education", subcategories: [] },
  { name: "Other", subcategories: [], isProtected: true },
];
