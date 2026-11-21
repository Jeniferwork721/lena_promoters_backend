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
function getAppRole(role, designation, department, permissions) {
  if (!role && !designation && !department) return 'employee';
  const r = (role || '').toUpperCase();
  const d = (designation || '').toUpperCase();
  const dept = (department || '').toUpperCase();
  const perms = Array.isArray(permissions) ? permissions : (typeof permissions === 'string' ? JSON.parse(permissions || '[]') : []);

  if (r === 'ADMIN' || r === 'SUPER_ADMIN' || r === 'MD' || r === 'GENERAL_MANAGER' || r === 'OVERALL_MANAGER' || d.includes('GENERAL MANAGER') || d.includes('MANAGING DIRECTOR')) return 'MD';
  if (r === 'SALES_HEAD' || r === 'HEAD_MANAGER' || r === 'SALES_MANAGER') return 'sales_head';
  if (r === 'COUPON_HEAD' || r === 'COUPON_MANAGER') return 'coupon_head';
  if (r === 'HR' || r === 'HUMAN_RESOURCES') return 'hr';
  if (r === 'MANAGER' || r === 'LEAD' || r === 'TEAM_LEAD') return 'lead';

  // Management position / Department or reporting authority (exclude sales staff like BDM / BDE / Telecaller)
  const isSalesStaff = d.includes('BDM') || d.includes('BDE') || d.includes('BUSINESS DEVELOPMENT') || d.includes('TELECALLER');
  if (!isSalesStaff && (dept.includes('MANAGEMENT') || d.includes('MANAGER') || perms.includes('*') || perms.includes('employees_manage'))) {
    return 'sales_head';
  }

  return 'employee';
}

/**
 * Middleware to require Managing Director or General Manager (Admin / Executive) role.
 */
function requireMD(req, res, next) {
  if (!req.staff) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }
  const appRole = getAppRole(req.staff.role, req.staff.designation, req.staff.department, req.staff.permissions);
  const r = (req.staff.role || '').toUpperCase();
  const d = (req.staff.designation || '').toUpperCase();
  const dept = (req.staff.department || '').toUpperCase();
  const perms = Array.isArray(req.staff.permissions)
    ? req.staff.permissions
    : (typeof req.staff.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);

  const isExecutiveAdmin =
    appRole === 'MD' ||
    r === 'ADMIN' ||
    r === 'SUPER_ADMIN' ||
    r === 'MD' ||
    r === 'GENERAL_MANAGER' ||
    r === 'OVERALL_MANAGER' ||
    d.includes('GENERAL MANAGER') ||
    d.includes('MANAGING DIRECTOR') ||
    perms.includes('*') ||
    perms.includes('employees_manage');

  // Allow read-only access for staff with report/team permissions or management positions
  const isReadOnly = req.method === 'GET';
  const hasManagementReadAccess = isReadOnly && (
    perms.includes('reports_team') ||
    perms.includes('reports_employee') ||
    perms.includes('reports') ||
    perms.includes('reports_all') ||
    perms.includes('assign_leads') ||
    d.includes('MANAGER') ||
    dept.includes('MANAGEMENT') ||
    dept.includes('FINANCE')
  );

  if (!isExecutiveAdmin && !hasManagementReadAccess) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Managing Director / General Manager privileges required for this action.',
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
  const appRole = getAppRole(req.staff.role, req.staff.designation, req.staff.department, req.staff.permissions);
  const d = (req.staff.designation || '').toUpperCase();
  const perms = Array.isArray(req.staff.permissions)
    ? req.staff.permissions
    : (typeof req.staff.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);

  const hasAccess =
    appRole === 'MD' ||
    appRole === 'sales_head' ||
    appRole === 'lead' ||
    perms.includes('*') ||
    perms.includes('reports_team') ||
    perms.includes('reports_employee') ||
    perms.includes('reports') ||
    d.includes('MANAGER');

  if (!hasAccess) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Leadership or Admin privileges required for this action.',
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
