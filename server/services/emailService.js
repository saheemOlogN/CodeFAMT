import nodemailer from 'nodemailer';

export async function sendOtpEmail(email, code) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Your CodeFAMT sign-in code',
    text: 'Your CodeFAMT code is ' + code + '. It expires in 10 minutes. Never share this code.',
  });
}
