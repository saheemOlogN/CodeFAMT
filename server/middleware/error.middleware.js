function handleError(error, req, res, next) {
    if (res.headersSent) return next(error);
    if (error.type === "entity.too.large") {
        return res.status(413).json({ message: "Request body is too large" });
    }
    if (error.type === "entity.parse.failed") {
        return res.status(400).json({ message: "Request body must be valid JSON" });
    }
    return res.status(500).json({ message: "Something went wrong" });
}

module.exports = handleError;
