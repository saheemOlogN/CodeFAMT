import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, required: true });
const registrationSchema = new Schema(
  { user: ref('User'), contest: ref('Contest') },
  { timestamps: true },
);
registrationSchema.index({ user: 1, contest: 1 }, { unique: true });
export const Registration = model('Registration', registrationSchema);
