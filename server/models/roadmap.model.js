const mongoose = require('mongoose');
const roadmapSchema = new mongoose.Schema({
    _id: { type: String, default: 'main' },
    title: { type: String, default: 'Learning roadmap' },
    description: { type: String, default: '' },
    sheetUrl: { type: String, default: '' },
    steps: [{ _id: false, id: String, title: String, description: String, resourceUrl: String }],
}, { timestamps: true });
module.exports = mongoose.model('Roadmap', roadmapSchema);
