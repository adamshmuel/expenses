const mongoose = require("mongoose");
const validator = require("validator");

/**
 * Mongoose schema for a User document.
 *
 * @typedef {Object} User
 * @property {string} username - Required, unique, 3-20 characters, trimmed.
 * @property {string} email - Required, unique, trimmed, lowercased, must be
 *   a valid email address.
 * @property {string} password - Required. Stored as a bcrypt hash; hashing
 *   happens outside this schema, and this field should never be sent back
 *   to the client.
 * @property {Date} createdAt - Set automatically to the creation time.
 */
const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'Username is required'],
        unique: true,
        minLength: [3, 'Username must be at least 3 characters long'],
        maxLength: [20, 'Username cannot exceed 20 characters'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true,
        validate: {
            validator: (value) => validator.isEmail(value),
            message: "Please enter a valid email address"
        }
    },
    password: { type: String, required: true },
    createdAt: {type: Date, default: Date.now}
});

userSchema.set("toJSON", { virtuals: true });

/**
 * The User model. Use this to create, read, update, and delete users.
 * @type {mongoose.Model<User>}
 */
const User = mongoose.model("User", userSchema);