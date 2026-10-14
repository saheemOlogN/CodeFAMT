import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const userSchema = new Schema(
  { email: { type: String, unique: true, required: true }, name: { type: String, required: true } },
  { timestamps: true },
);
export const User = model('User', userSchema);
