const name = "codefamt-session";
const lifetimeMs = 30 * 24 * 60 * 60 * 1000;
function options() {
    return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" };
}
function readCookie(header) {
    if (typeof header !== "string") return "";
    const entry = header.split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`));
    try { return entry ? decodeURIComponent(entry.slice(name.length + 1)) : ""; } catch { return ""; }
}
function allowedOrigin(origin) {
    return origin === (process.env.CLIENT_ORIGIN || "http://localhost:5173");
}
module.exports = { name, lifetimeMs, options, readCookie, allowedOrigin };
