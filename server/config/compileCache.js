// Node 24 persists compiled dependencies between development restarts.
// A cache failure is harmless: Node continues without it.
const { enableCompileCache } = require("node:module");
enableCompileCache();
