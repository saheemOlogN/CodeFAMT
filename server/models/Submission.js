import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name, required: true });
const submissionSchema = new Schema(
  {
    user: ref('User'),
    problem: ref('Problem'),
    contest: { type: Schema.Types.ObjectId, ref: 'Contest', default: null },
    requestId: { type: String, required: true },
    kind: { type: String, enum: ['run', 'submit'], required: true },
    language: String,
    source: { type: String, select: false },
    stdin: { type: String, select: false },
    status: { type: String, default: 'Queued' },
    passed: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    runtime: Number,
    output: String,
    error: String,
  },
  { timestamps: true },
);
submissionSchema.index({ user: 1, requestId: 1 }, { unique: true });
submissionSchema.index({ contest: 1, kind: 1, status: 1, createdAt: 1 });
submissionSchema.index({ user: 1, createdAt: -1 });
submissionSchema.index({ status: 1, createdAt: 1 });
export const Submission = model('Submission', submissionSchema);
