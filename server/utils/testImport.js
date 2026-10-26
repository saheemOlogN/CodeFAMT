function validateTestImport(body) {
    const tests = body?.testCases;
    if (!body || Array.isArray(body) || Object.keys(body).some(key => key !== 'testCases') ||
        !Array.isArray(tests) || !tests.length || tests.length > 100) return 'Upload an object with 1–100 testCases.';
    for (const [index, test] of tests.entries()) {
        if (!test || Array.isArray(test) || Object.keys(test).some(key => !['input', 'expectedOutput'].includes(key)) ||
            ['input', 'expectedOutput'].some(key => typeof test[key] !== 'string' || test[key].includes('\0') ||
                Buffer.byteLength(test[key]) > (key === 'input' ? 100000 : 65536))) {
            return `Test ${index + 1}: input and expectedOutput must be strings without NUL characters (100,000 and 65,536 bytes maximum).`;
        }
    }
    if (Buffer.byteLength(JSON.stringify(body)) > 750000) return 'The JSON payload must be at most 750,000 bytes. Split large imports into smaller files.';
    return null;
}
module.exports = { validateTestImport };
