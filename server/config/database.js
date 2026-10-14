import mongoose from 'mongoose';
import { config, requireConfig } from './env.js';
import '../models/index.js';

export async function connectDatabase() {
  requireConfig();
  await mongoose.connect(config.mongo, { serverSelectionTimeoutMS: 5000 });
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}
