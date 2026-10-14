import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const problemSchema = new Schema(
  {
    slug: { type: String, unique: true, required: true },
    title: String,
    difficulty: String,
    pattern: String,
    description: String,
    inputFormat: String,
    outputFormat: String,
    constraints: String,
    samples: [{ _id: false, input: String, output: String }],
    testCases: { type: [{ _id: false, input: String, output: String }], select: false },
    published: { type: Boolean, default: false },
  },
  { timestamps: true },
);
problemSchema.index({ published: 1, pattern: 1, difficulty: 1 });
export const Problem = model('Problem', problemSchema);
