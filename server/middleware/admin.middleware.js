let writing = false;

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
    }
    return next();
}

function adminWrite(controller) {
    return async function (req, res, next) {
        if (writing) {
            return res.status(409).json({ message: "Another admin change is in progress. Please retry" });
        }
        writing = true;
        try {
            return await controller(req, res, next);
        } catch (error) {
            return next(error);
        } finally {
            writing = false;
        }
    };
}

module.exports = { requireAdmin, adminWrite };
