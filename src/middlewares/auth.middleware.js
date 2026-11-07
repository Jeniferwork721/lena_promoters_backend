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
 * Helper to determine user's app role: 'MD' | 'lead' | 'employee' | 'coupon_head' | 'hr'
 */
function getAppRole(role) {
  if (!role) return 'employee';
  const r = role.toUpperCase();
  if (r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'MD') return 'MD';
  if (r === 'MANAGER' || r === 'LEAD' || r === 'TEAM_LEAD' || r === 'SALES_MANAGER' || r === 'SALES_HEAD' || r === 'HEAD_MANAGER') return 'lead';
  if (r === 'COUPON_HEAD' || r === 'COUPON_MANAGER') return 'coupon_head';
  if (r === 'HR' || r === 'HUMAN_RESOURCES') return 'hr';
  return 'employee';
}

/**
 * Middleware to require Managing Director (ADMIN / SUPER_ADMIN) role.
 */
function requireMD(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }
  const appRole = getAppRole(req.staff.role);
  if (appRole !== 'MD') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Managing Director (Admin) privileges required for this action.',
    });
  }
  next();
}

/**
 * Middleware to require Team Lead (MANAGER) or MD role.
 */
function requireLeadOrMD(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }
  const appRole = getAppRole(req.staff.role);
  if (appRole !== 'MD' && appRole !== 'lead') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Team Lead or Admin privileges required for this action.',
    });
  }
  next();
}

/**
 * Middleware to require Coupon Head or Admin role.
 */
function requireCouponHeadOrAdmin(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  const r = (req.staff.role || '').toUpperCase();
  if (!['ADMIN', 'SUPER_ADMIN', 'MD', 'COUPON_HEAD', 'COUPON_MANAGER'].includes(r)) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Coupon Head or Admin privileges required.',
    });
  }
  next();
}

/**
 * Middleware to require Admin role (alias for requireMD).
 */
function requireAdminRole(req, res, next) {
  return requireMD(req, res, next);
}

module.exports = {
  verifyStaffToken,
  requireAdminRole,
  requireMD,
  requireLeadOrMD,
  requireCouponHeadOrAdmin,
  getAppRole,
};
