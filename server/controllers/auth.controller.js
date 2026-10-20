const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Otp = require("../models/otp.model");
const sendOtp = require("../utils/sendOtp");

async function register(req, res) {
    try {
        const { name, email, password, department, year } = req.body || {};

        if (![name, email, password, department, year].every((value) => typeof value === "string" && value.trim())) {
            return res.status(400).json({ message: "Name, email, password, department and year are required" });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!/^[^\s@]+@famt\.ac\.in$/.test(normalizedEmail)) {
            return res.status(400).json({ message: "Use your @famt.ac.in email" });
        }

        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
            return res.status(400).json({ message: "Password must be at least 8 characters and at most 72 bytes" });
        }

        let user = await User.findOne({ email: normalizedEmail });

        if (user && user.isVerified) {
            return res.status(409).json({ message: "This email is already registered" });
        }

        const newUser = new User({
            name,
            email: normalizedEmail,
            passwordHash: await bcrypt.hash(password, 12),
            department,
            year,
            role: "student",
            isVerified: false,
        });

        await newUser.validate();

        if (!user) {
            user = await newUser.save();
        }

        await sendOtp(user);

        return res.status(200).json({ message: "OTP sent. Complete email verification to activate your account" });
    } catch (error) {
        if (error.status === 429 || error.status === 503) {
            return res.status(error.status).json({ message: error.message });
        }
        if (error.code === 11000) {
            return res.status(409).json({ message: "Registration already started. Request a new OTP" });
        }
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: "Check your name, department, year and college email" });
        }
        return res.status(500).json({ message: "Could not register. Please try again" });
    }
}

async function verifyOtp(req, res) {
    try {
        const { name, email, password, department, year, otp } = req.body || {};

        if (![name, email, password, department, year].every((value) => typeof value === "string" && value.trim())) {
            return res.status(400).json({ message: "Send your registration details along with the OTP" });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!/^[^\s@]+@famt\.ac\.in$/.test(normalizedEmail) || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({ message: "Enter your college email and a six-digit OTP" });
        }

        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
            return res.status(400).json({ message: "Password must be at least 8 characters and at most 72 bytes" });
        }

        if (!process.env.OTP_SECRET) {
            return res.status(503).json({ message: "Email verification is not configured yet" });
        }

        const user = await User.findOne({ email: normalizedEmail, isVerified: false });

        if (!user) {
            return res.status(400).json({ message: "Invalid or expired verification request" });
        }

        const otpRecord = await Otp.findOneAndUpdate(
            { user: user._id, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
            { $inc: { attempts: 1 } },
            { returnDocument: "after" }
        ).select("+otpHash");

        if (!otpRecord) {
            return res.status(400).json({ message: "OTP expired or attempt limit reached. Request a new OTP" });
        }

        const otpHash = crypto.createHmac("sha256", process.env.OTP_SECRET)
            .update(`${user._id}:${otp}`)
            .digest("hex");

        if (typeof otpRecord.otpHash !== "string" || !/^[a-f0-9]{64}$/.test(otpRecord.otpHash) ||
            !crypto.timingSafeEqual(Buffer.from(otpHash, "hex"), Buffer.from(otpRecord.otpHash, "hex"))) {
            return res.status(400).json({ message: "Invalid OTP" });
        }

        user.name = name;
        user.department = department;
        user.year = year;
        user.passwordHash = await bcrypt.hash(password, 12);
        await user.validate();

        await mongoose.connection.transaction(async (session) => {
            const consumedOtp = await Otp.findOneAndDelete(
                {
                    _id: otpRecord._id,
                    otpHash,
                    lastSentAt: otpRecord.lastSentAt,
                    expiresAt: { $gt: new Date() },
                },
                { session }
            );

            if (!consumedOtp) {
                const error = new Error("OTP expired, was replaced or has already been used");
                error.status = 400;
                throw error;
            }

            const verifiedUser = await User.findOneAndUpdate(
                { _id: user._id, isVerified: false },
                {
                    $set: {
                        name: user.name,
                        department: user.department,
                        year: user.year,
                        passwordHash: user.passwordHash,
                        isVerified: true,
                    },
                },
                { returnDocument: "after", runValidators: true, session }
            );

            if (!verifiedUser) {
                const error = new Error("Account already verified. Please log in");
                error.status = 409;
                throw error;
            }
        });

        return res.status(200).json({ message: "Email verified. You can now log in" });
    } catch (error) {
        if (error.status === 400 || error.status === 409) {
            return res.status(error.status).json({ message: error.message });
        }
        if (error.name === "ValidationError") {
            return res.status(400).json({ message: "Check your name, department and year" });
        }
        return res.status(500).json({ message: "Could not verify OTP. Please try again" });
    }
}

async function resendOtp(req, res) {
    try {
        const { email } = req.body || {};

        if (typeof email !== "string" || !/^[^\s@]+@famt\.ac\.in$/.test(email.trim().toLowerCase())) {
            return res.status(400).json({ message: "Use your @famt.ac.in email" });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase(), isVerified: false });

        if (user) {
            await sendOtp(user);
        }

        return res.status(200).json({ message: "If your account is awaiting verification, an OTP has been sent" });
    } catch (error) {
        if (error.status === 429 || error.status === 503) {
            return res.status(error.status).json({ message: error.message });
        }
        return res.status(500).json({ message: "Could not resend OTP. Please try again" });
    }
}

async function login(req, res) {
    try {
        const { email, password } = req.body || {};

        if (typeof email !== "string" || typeof password !== "string" || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!/^[^\s@]+@famt\.ac\.in$/.test(normalizedEmail) || Buffer.byteLength(password, "utf8") > 72) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        if (!process.env.JWT_SECRET) {
            return res.status(503).json({ message: "Login is not configured yet" });
        }

        const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash +tokenVersion");

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        if (!user.isVerified) {
            return res.status(403).json({ message: "Verify your college email before logging in" });
        }

        const token = jwt.sign({ version: user.tokenVersion }, process.env.JWT_SECRET, {
            subject: user._id.toString(),
            algorithm: "HS256",
            expiresIn: "1h",
        });

        return res.status(200).json({
            message: "Logged in successfully",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                department: user.department,
                year: user.year,
                role: user.role,
            },
        });
    } catch {
        return res.status(500).json({ message: "Could not log in. Please try again" });
    }
}

async function logout(req, res) {
    try {
        await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
        await require("../utils/realtime").disconnectUser(req.user._id);
        return res.status(200).json({ message: "Logged out on all devices" });
    } catch {
        return res.status(500).json({ message: "Could not log out" });
    }
}

module.exports = { register, verifyOtp, resendOtp, login, logout };
