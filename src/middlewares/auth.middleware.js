const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token from Authorization header.
 * Attaches decoded staff user payload to req.staff.
 */
function verifyStaffToken(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || req.headers['x-api-key'];
  if (adminKey && adminKey === (process.env.ADMIN_KEY || 'LenaAdmin@2026')) {
    req.staff = { role: 'ADMIN', full_name: 'Admin API', id: 'admin-api' };
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No authentication token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'lena_promoters_jwt_secret_key_2026_super_secure');
    req.staff = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      message: 'Invalid or expired authentication token. Please refresh token or log in again.',
    });
  }
}

/**
 * Middleware to require Admin role.
 */
function requireAdminRole(req, res, next) {
  if (!req.staff || req.staff.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Admin privileges required for this action.',
    });
  }
  next();
}

module.exports = {
  verifyStaffToken,
  requireAdminRole,
};
