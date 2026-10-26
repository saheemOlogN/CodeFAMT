const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const requireAuth = require("../middleware/auth.middleware");
const cookies = require("../utils/sessionCookie");
const userId = "507f1f77bcf86cd799439011";
function response() { return { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { this.body = body; return this; } }; }
test("cookie parsing tolerates unrelated cookies and rejects malformed encodings", () => {
    assert.equal(cookies.readCookie("other=value; codefamt-session=abc.def; theme=dark"), "abc.def");
    assert.equal(cookies.readCookie("codefamt-session=%broken"), "");
    assert.equal(cookies.readCookie(undefined), "");
});
test("persistent session cookie is HttpOnly and secure in production", t => {
    const previous = process.env.NODE_ENV;
    t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
    process.env.NODE_ENV = "production";
    assert.deepEqual(cookies.options(), { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    assert.equal(cookies.lifetimeMs, 2592000000);
});
test("cookie sessions authenticate reads, require a trusted write origin, and remain revocable", async t => {
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "cookie-session-test-secret";
    t.after(() => { if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
    let version = 0;
    t.mock.method(User, "findById", () => ({ select: async () => ({ _id: userId, isVerified: true, tokenVersion: version }) }));
    const token = jwt.sign({ version: 0 }, process.env.JWT_SECRET, { subject: userId, expiresIn: "30d" });
    const decoded = jwt.decode(token);
    assert.doesNotThrow(() => jwt.verify(token, process.env.JWT_SECRET, { clockTimestamp: decoded.iat + 29 * 86400 }));
    assert.throws(() => jwt.verify(token, process.env.JWT_SECRET, { clockTimestamp: decoded.iat + 30 * 86400 }));
    for (const [method, origin, expected] of [["GET", undefined, 200], ["PATCH", process.env.CLIENT_ORIGIN || "http://localhost:5173", 200], ["PATCH", "https://untrusted.example", 403], ["POST", undefined, 403]]) {
        const res = response();
        let nextCalled = false;
        await requireAuth({ method, headers: { cookie: `codefamt-session=${token}`, origin } }, res, () => { nextCalled = true; });
        assert.equal(res.statusCode, expected);
        assert.equal(nextCalled, expected === 200);
    }
    version++;
    const res = response();
    await requireAuth({ method: "GET", headers: { cookie: `codefamt-session=${token}` } }, res, () => assert.fail("revoked token accepted"));
    assert.equal(res.statusCode, 401);
});
