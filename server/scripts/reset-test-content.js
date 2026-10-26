// Explicit, one-off development reset. Never run automatically at startup.
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EJSON } = require('bson');
const Problem = require('../models/problem.model');
const TestCase = require('../models/testCase.model');
const Roadmap = require('../models/roadmap.model');
const fixtures = require('../fixtures/draft-problems.json');
const roadmap = require('../fixtures/cpp-roadmap.json');

async function main() {
    if (!process.argv.includes('--apply')) throw new Error('Pass --apply only for the explicitly requested test-content reset.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const db = mongoose.connection;
    const admin = await db.collection('users').findOne({ role: 'admin' });
    if (!admin) throw new Error('An admin account is required.');
    const old = await db.collection('problems').find({}).toArray();
    const ids = old.map(item => item._id);
    if (await db.collection('contests').countDocuments({ 'problems.problem': { $in: ids } })) throw new Error('Existing contests reference these problems; reset stopped.');
    const filter = { problem: { $in: ids } };
    if (await db.collection('submissions').countDocuments({ ...filter, status: { $in: ['queued', 'running'] } })) throw new Error('Wait for active submissions to finish.');
    const backup = { problems: old };
    for (const name of ['testcases', 'submissions', 'solvedproblems']) backup[name] = await db.collection(name).find(filter).toArray();
    backup.roadmaps = await db.collection('roadmaps').find({ _id: 'main' }).toArray();
    const folder = path.resolve(__dirname, '../../.local-backups');
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, `test-content-${Date.now()}.json`);
    await fs.writeFile(file, EJSON.stringify(backup, null, 2), { flag: 'wx' });
    await Promise.all([Problem.init(), TestCase.init(), Roadmap.init()]);
    await db.transaction(async session => {
        // Lock out concurrent admin writes during the replacement.
        await db.collection('adminlocks').updateOne({ _id: 'admin' }, { $inc: { version: 1 } }, { session });
        if (await db.collection('contests').countDocuments({ 'problems.problem': { $in: ids } }, { session })) throw new Error('Contest references changed; reset stopped.');
        if (await db.collection('submissions').countDocuments({ ...filter, status: { $in: ['queued', 'running'] } }, { session })) throw new Error('A submission started; reset stopped.');
        for (const name of ['testcases', 'submissions', 'solvedproblems']) await db.collection(name).deleteMany(filter, { session });
        await Problem.deleteMany({ _id: { $in: ids } }, { session });
        for (const { testCases, referenceSolution, ...fields } of fixtures) {
            const [problem] = await Problem.create([{ ...fields, createdBy: admin._id }], { session });
            await TestCase.insertMany(testCases.map(test => ({ ...test, problem: problem._id })), { session });
        }
        await Roadmap.findOneAndUpdate({ _id: 'main' }, { $set: roadmap }, { upsert: true, runValidators: true, session });
    });
    console.log(JSON.stringify({ removedProblems: old.length, removedSubmissions: backup.submissions.length, removedSolvedRecords: backup.solvedproblems.length, draftProblems: fixtures.length, roadmapTopics: roadmap.steps.length, backup: file }));
}
main().catch(error => { console.error(error.message.includes('mongodb') ? 'Database operation failed.' : error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
