const Contest = require('../models/contest.model');

async function practiceFilter(now = new Date()) {
    const released = await Contest.distinct('problems.problem', { status: 'published', endTime: { $lte: now } });
    return { $or: [{ visibility: 'public' }, { visibility: 'contest', _id: { $in: released } }] };
}

async function canPractice(problem, now = new Date()) {
    return problem.visibility === 'public' || (problem.visibility === 'contest' && Boolean(await Contest.exists({
        status: 'published', endTime: { $lte: now }, 'problems.problem': problem._id,
    })));
}

module.exports = { practiceFilter, canPractice };
