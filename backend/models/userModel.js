const mongoose = require("mongoose");
const validator = require("validator");

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
const User = mongoose.model("User", userSchema);