const crypto = require("crypto");
const nodemailer = require("nodemailer");
const Otp = require("../models/otp.model");

async function sendOtp(user) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER ||
        !process.env.SMTP_PASS || !process.env.SMTP_FROM || !process.env.OTP_SECRET) {
        const error = new Error("Email delivery is not configured yet");
        error.status = 503;
        throw error;
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const now = new Date();
    const otpHash = crypto.createHmac("sha256", process.env.OTP_SECRET)
        .update(`${user._id}:${otp}`)
        .digest("hex");

    try {
        await Otp.findOneAndUpdate(
            {
                user: user._id,
                lastSentAt: { $lte: new Date(now.getTime() - 60000) },
            },
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
            error.status = 429;
            error.message = "Wait 60 seconds before requesting another OTP";
        }
        throw error;
    }

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: Number(process.env.SMTP_PORT) === 465,
        requireTLS: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: user.email,
            subject: "CODEFAMT email verification",
            text: `Your CODEFAMT verification code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`,
        });
    } catch {
        const error = new Error("Could not send OTP. Try again after 60 seconds");
        error.status = 503;
        throw error;
    }
}

module.exports = sendOtp;
