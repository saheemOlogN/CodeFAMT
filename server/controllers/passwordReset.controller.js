const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const User = require("../models/user.model");
const PasswordReset = require("../models/passwordReset.model");

async function forgotPassword(req, res) {
    try {
        const { email } = req.body || {};

        if (typeof email !== "string" || !/^[^\s@]+@famt\.ac\.in$/.test(email.trim().toLowerCase())) {
            return res.status(400).json({ message: "Use your @famt.ac.in email" });
        }

        if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER ||
            !process.env.SMTP_PASS || !process.env.SMTP_FROM || !process.env.OTP_SECRET) {
            return res.status(503).json({ message: "Password recovery is not configured yet" });
        }

        const message = "If this email has a verified account, a password reset code has been requested. Check your inbox and wait 60 seconds before requesting again";
        const user = await User.findOne({ email: email.trim().toLowerCase(), isVerified: true });

        if (!user) {
            return res.status(200).json({ message });
        }

        const otp = crypto.randomInt(100000, 1000000).toString();
        const now = new Date();
        const otpHash = crypto.createHmac("sha256", process.env.OTP_SECRET)
            .update(`reset:${user._id}:${otp}`)
            .digest("hex");

        try {
            await PasswordReset.findOneAndUpdate(
                { user: user._id, lastSentAt: { $lte: new Date(now.getTime() - 60000) } },
                {
                    $set: {
                        otpHash,
                        expiresAt: new Date(now.getTime() + 5 * 60000),
                        attempts: 0,
                        lastSentAt: now,
                    },
                },
                { upsert: true, runValidators: true }
            );
        } catch (error) {
            if (error.code === 11000) {
                return res.status(200).json({ message });
            }
            throw error;
        }

        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT),
                secure: Number(process.env.SMTP_PORT) === 465,
                requireTLS: true,
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 30000,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });

            await transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: user.email,
                subject: "CODEFAMT password reset",
                text: `Your CODEFAMT password reset code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`,
            });
        } catch {
            console.error("Password reset email delivery failed");
        }

        return res.status(200).json({ message });
    } catch {
        return res.status(500).json({ message: "Could not request a password reset. Please try again" });
    }
}

async function resetPassword(req, res) {
    try {
        const { email, otp, newPassword } = req.body || {};

        if (typeof email !== "string" || !/^[^\s@]+@famt\.ac\.in$/.test(email.trim().toLowerCase()) ||
            typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({ message: "Enter your college email and a six-digit OTP" });
        }

        if (typeof newPassword !== "string" || !newPassword.trim() || newPassword.length < 8 ||
            Buffer.byteLength(newPassword, "utf8") > 72) {
            return res.status(400).json({ message: "Password must be at least 8 characters and at most 72 bytes" });
        }

        if (!process.env.OTP_SECRET) {
            return res.status(503).json({ message: "Password recovery is not configured yet" });
        }

        const user = await User.findOne({ email: email.trim().toLowerCase(), isVerified: true })
            .select("+passwordHash +tokenVersion");

        if (!user) {
            return res.status(400).json({ message: "Invalid or expired password reset request" });
        }

        const otpRecord = await PasswordReset.findOneAndUpdate(
            { user: user._id, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
            { $inc: { attempts: 1 } },
            { new: true }
        ).select("+otpHash");

        if (!otpRecord) {
            return res.status(400).json({ message: "Invalid or expired password reset request" });
        }

        const otpHash = crypto.createHmac("sha256", process.env.OTP_SECRET)
            .update(`reset:${user._id}:${otp}`)
            .digest("hex");

        if (typeof otpRecord.otpHash !== "string" || !/^[a-f0-9]{64}$/.test(otpRecord.otpHash) ||
            !crypto.timingSafeEqual(Buffer.from(otpHash, "hex"), Buffer.from(otpRecord.otpHash, "hex"))) {
            return res.status(400).json({ message: "Invalid or expired password reset request" });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);

        await mongoose.connection.transaction(async (session) => {
            const consumedOtp = await PasswordReset.findOneAndDelete(
                {
                    _id: otpRecord._id,
                    otpHash,
                    lastSentAt: otpRecord.lastSentAt,
                    expiresAt: { $gt: new Date() },
                },
                { session }
            );

            if (!consumedOtp) {
                const error = new Error("Invalid or expired password reset request");
                error.status = 400;
                throw error;
            }

            const updatedUser = await User.updateOne(
                { _id: user._id, isVerified: true, passwordHash: user.passwordHash, tokenVersion: user.tokenVersion },
                { $set: { passwordHash }, $inc: { tokenVersion: 1 } },
                { session, runValidators: true }
            );

            if (!updatedUser.matchedCount) {
                const error = new Error("Your account changed. Request a new password reset code");
                error.status = 400;
                throw error;
            }
        });

        try {
            await require("../utils/realtime").disconnectUser(user._id.toString());
        } catch {}

        return res.status(200).json({ message: "Password reset. Log in again" });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: "Could not reset your password. Please try again" });
    }
}

module.exports = { forgotPassword, resetPassword };
