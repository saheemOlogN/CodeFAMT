const { languages } = require("./executeCode");

function validDsa(configs) {
    return Array.isArray(configs) && configs.length <= 5 &&
        new Set(configs.map(config => config?.language)).size === configs.length &&
        configs.every(config => config && Object.keys(config).every(key => ["language", "starter", "prefix", "suffix"].includes(key)) &&
            Object.hasOwn(languages, config.language) &&
            ["starter", "prefix", "suffix"].every(key => typeof config[key] === "string" && !config[key].includes("\0") && Buffer.byteLength(config[key]) <= 20000) &&
            config.starter.trim() && (config.prefix.trim() || config.suffix.trim()));
}

function publicProblem(problem) {
    const value = problem.toObject ? problem.toObject() : { ...problem };
    value.dsa = (value.dsa || []).map(({ language, starter }) => ({ language, starter }));
    return value;
}

function buildExecutionCode(problem, mode, language, code) {
    if (mode === "cp") return code;
    const config = problem?.dsa?.find(item => item.language === language);
    if (!config) throw Object.assign(new Error("DSA mode is not configured for this problem and language"), { status: 400 });
    const source = `${config.prefix}\n${code}\n${config.suffix}`;
    if (Buffer.byteLength(source) > 50000) throw Object.assign(new Error("Solution and driver together must be at most 50000 bytes"), { status: 400 });
    return source;
}

module.exports = { validDsa, publicProblem, buildExecutionCode };
