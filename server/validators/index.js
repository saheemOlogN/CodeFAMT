import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254)
  .refine((email) => email.split('@')[1] === 'famt.ac.in', 'Use your @famt.ac.in college email.');
import { languageOptions, patterns } from '../../shared/catalog.js';
export const languages = languageOptions.map((language) => language.id);
const testCase = z.object({
  input: z.string().max(10000),
  output: z.string().max(998, 'Expected output must be under 999 characters for OnlineCompiler.'),
});
export const problemSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  title: z.string().min(3).max(100),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  pattern: z.enum(patterns),
  description: z.string().min(10).max(15000),
  inputFormat: z.string().min(1).max(3000),
  outputFormat: z.string().min(1).max(3000),
  constraints: z.string().min(1).max(3000),
  samples: z.array(testCase).min(1).max(5),
  testCases: z.array(testCase).min(1).max(30),
  published: z.boolean().default(false),
});
export const contestSchema = z
  .object({
    title: z.string().min(3).max(100),
    startsAt: z.iso.datetime(),
    problems: z
      .array(
        z.object({
          problem: z.string().regex(/^[a-f\d]{24}$/i),
          points: z.number().int().min(1).max(1000),
        }),
      )
      .min(1)
      .max(6),
  })
  .refine(
    (data) => new Set(data.problems.map((p) => p.problem)).size === data.problems.length,
    'Contest problems must be unique.',
  );

export const idSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');
