const mongoose = require("mongoose");

const adminLockSchema = new mongoose.Schema({
    _id: String,
    version: { type: Number, default: 0 },
});

module.exports = mongoose.model("AdminLock", adminLockSchema);
