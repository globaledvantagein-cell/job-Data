import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

// 1. Verify Token (Is the user logged in?) — REJECTS if no/invalid token
export const verifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: "Access Denied. No token provided." });
    }

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified; // Add user info to the request object
        next();
    } catch (err) {
        res.status(400).json({ error: "Invalid Token" });
    }
};

// 2. Verify Admin (Is the user an Admin?)
export const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Access Denied. Admins only." });
    }
};

// 3. Soft Verify Token — populates req.user IF a valid token is present,
//    otherwise leaves req.user undefined and continues. Used by routes that
//    behave differently for anonymous vs authenticated users (like the
//    gated job-detail endpoint).
export const softVerifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return next();

    try {
        req.user = jwt.verify(token, JWT_SECRET);
    } catch {
        // Invalid token → treat as anonymous, don't reject
    }
    next();
};
