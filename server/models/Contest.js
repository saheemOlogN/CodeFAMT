import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, required: true });
const contestSchema = new Schema(
  {
    title: String,
    startsAt: Date,
    endsAt: Date,
    problems: [{ _id: false, problem: ref('Problem'), points: Number }],
  },
  { timestamps: true },
);
contestSchema.index({ startsAt: -1 });
export const Contest = model('Contest', contestSchema);
