import { Submission, User } from '../models/index.js';

export async function getCommunity(req, res) {
  const leaders = await Submission.aggregate([
    { $match: { kind: 'submit', status: 'Accepted' } },
    { $group: { _id: { user: '$user', problem: '$problem' } } },
    { $group: { _id: '$_id.user', solved: { $sum: 1 } } },
    { $sort: { solved: -1, _id: 1 } },
    { $limit: 50 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'student' } },
    { $unwind: '$student' },
    { $project: { name: '$student.name', solved: 1 } },
  ]);
  res.json({ leaders, members: await User.countDocuments() });
}
