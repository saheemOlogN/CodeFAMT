const Submission = require("../models/submission.model");

async function getActivity(req, res) {
    const timezone = "Asia/Kolkata";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const currentYear = Number(today.slice(0, 4));
    const year = req.query.year === undefined ? currentYear : Number(req.query.year);
    if (Object.keys(req.query).some(key => key !== "year") ||
        (req.query.year !== undefined && (typeof req.query.year !== "string" || !/^\d{4}$/.test(req.query.year))) ||
        !Number.isInteger(year) || year < 2000 || year > currentYear) {
        return res.status(400).json({ message: "Choose a valid activity year" });
    }
    try {
        const days = await Submission.aggregate([
            { $match: { user: req.user._id, createdAt: {
                $gte: new Date(`${year}-01-01T00:00:00+05:30`),
                $lt: new Date(`${year + 1}-01-01T00:00:00+05:30`),
                $lte: new Date(),
            } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: "$_id", count: 1 } },
        ]);
        return res.status(200).json({ year, timezone, today, days });
    } catch {
        return res.status(500).json({ message: "Could not load submission activity" });
    }
}

module.exports = { getActivity };
