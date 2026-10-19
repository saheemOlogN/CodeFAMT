const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        department: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            enum: [
                "mechanical",
                "cybersecurity",
                "aiml",
                "it",
                "chemical",
                "electrical",
                "entc",
                "mca",
            ],
        },
        year: {
            type: String,
            required: true,
            enum: ["1st", "2nd", "3rd", "4th"],
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            match: [/^[^\s@]+@famt\.ac\.in$/, "Use your @famt.ac.in email"],
        },
        passwordHash: {
            type: String,
            required: true,
            select: false,
        },
        role: {
            type: String,
            enum: ["student", "admin"],
            default: "student",
        },
        isVerified: {
            type: Boolean,
            default: false,
        },
        tokenVersion: {
            type: Number,
            default: 0,
            select: false,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
