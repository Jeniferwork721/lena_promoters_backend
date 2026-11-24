const { pool } = require('../config/db');

// Monthly Quotas
const MAX_PAID_LEAVES_PER_MONTH = 4.0;
const MAX_PERMISSIONS_PER_MONTH = 2;
const MAX_HOURS_PER_PERMISSION = 2.0;

function getCurrentMonthString(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function parsePermissions(permissions) {
  if (Array.isArray(permissions)) return permissions;
  if (typeof permissions === 'string') {
    try {
      return JSON.parse(permissions || '[]');
    } catch (_) {
      return [];
    }
  }
  return [];
}

/**
 * Normalizes leave application row to guarantee both camelCase and snake_case properties
 */
function formatLeaveRow(la) {
  if (!la) return null;
  const appDate = la.application_date ? String(la.application_date).slice(0, 10) : '';
  const fromDate = la.period_from ? String(la.period_from).slice(0, 10) : '';
  const toDate = la.period_to ? String(la.period_to).slice(0, 10) : '';
  const numDays = la.number_of_days != null ? Number(la.number_of_days) : 1.0;
  const permHours = la.permission_hours != null ? Number(la.permission_hours) : 0;
  const leaveCount = la.already_took_leave_count != null ? Number(la.already_took_leave_count) : 0;
  const permCount = la.already_took_permission_count != null ? Number(la.already_took_permission_count) : 0;

  return {
    ...la,
    id: la.id,
    employeeId: la.employee_id,
    employee_id: la.employee_id,
    employeeCode: la.employee_code,
    employee_code: la.employee_code,
    employeeName: la.employee_name,
    employee_name: la.employee_name,
    designation: la.designation || '',
    department: la.department || '',
    applicationDate: appDate,
    application_date: appDate,
    leaveFor: la.leave_for,
    leave_for: la.leave_for,
    periodFrom: fromDate,
    period_from: fromDate,
    periodTo: toDate,
    period_to: toDate,
    sessionType: la.session_type || 'FULL_DAY',
    session_type: la.session_type || 'FULL_DAY',
    permissionHours: permHours,
    permission_hours: permHours,
    permissionTime: la.permission_time || '',
    permission_time: la.permission_time || '',
    numberOfDays: numDays,
    number_of_days: numDays,
    alreadyTookLeaveCount: leaveCount,
    already_took_leave_count: leaveCount,
    alreadyTookPermissionCount: permCount,
    already_took_permission_count: permCount,
    reason: la.reason || '',
    handoverPersonId: la.handover_person_id || null,
    handover_person_id: la.handover_person_id || null,
    handoverPersonName: la.handover_person_name || '',
    handover_person_name: la.handover_person_name || '',
    handoverWorkDetails: la.handover_work_details || '',
    handover_work_details: la.handover_work_details || '',
    employeeSignature: la.employee_signature || '',
    employee_signature: la.employee_signature || '',
    tlId: la.tl_id || null,
    tl_id: la.tl_id || null,
    tlStatus: la.tl_status || 'PENDING',
    tl_status: la.tl_status || 'PENDING',
    tlApprovedBy: la.tl_approved_by || null,
    tl_approved_by: la.tl_approved_by || null,
    tlApprovedName: la.tl_approved_name || null,
    tl_approved_name: la.tl_approved_name || null,
    tlComments: la.tl_comments || '',
    tl_comments: la.tl_comments || '',
    tlActionAt: la.tl_action_at || null,
    tl_action_at: la.tl_action_at || null,
    gmId: la.gm_id || null,
    gm_id: la.gm_id || null,
    gmStatus: la.gm_status || 'PENDING',
    gm_status: la.gm_status || 'PENDING',
    gmApprovedBy: la.gm_approved_by || null,
    gm_approved_by: la.gm_approved_by || null,
    gmApprovedName: la.gm_approved_name || null,
    gm_approved_name: la.gm_approved_name || null,
    gmComments: la.gm_comments || '',
    gm_comments: la.gm_comments || '',
    gmActionAt: la.gm_action_at || null,
    gm_action_at: la.gm_action_at || null,
    hrStatus: la.hr_status || 'PENDING',
    hr_status: la.hr_status || 'PENDING',
    hrApprovedBy: la.hr_approved_by || null,
    hr_approved_by: la.hr_approved_by || null,
    hrApprovedName: la.hr_approved_name || null,
    hr_approved_name: la.hr_approved_name || null,
    hrComments: la.hr_comments || '',
    hr_comments: la.hr_comments || '',
    hrActionAt: la.hr_action_at || null,
    hr_action_at: la.hr_action_at || null,
    status: la.status,
    createdAt: la.created_at || '',
    created_at: la.created_at || '',
    updatedAt: la.updated_at || '',
    updated_at: la.updated_at || '',
  };
}

/**
 * Helper to compute leave & permission counts for an employee in a given month (YYYY-MM)
 */
async function computeMonthlyLeaveUsage(employeeId, monthStr) {
  const [rows] = await pool.query(
    `SELECT 
      leave_for,
      session_type,
      permission_hours,
      number_of_days,
      status
     FROM leave_applications
     WHERE employee_id = ?
       AND DATE_FORMAT(period_from, '%Y-%m') = ?
       AND status NOT IN ('REJECTED', 'CANCELLED')`,
    [employeeId, monthStr]
  );

  let paidLeavesTaken = 0;
  let permissionsTaken = 0;

  rows.forEach((r) => {
    if (r.leave_for === 'PERMISSION') {
      permissionsTaken += 1;
    } else {
      paidLeavesTaken += Number(r.number_of_days) || 0;
    }
  });

  const remainingPaid = Number(Math.max(0, MAX_PAID_LEAVES_PER_MONTH - paidLeavesTaken).toFixed(1));
  const remainingPerm = Math.max(0, MAX_PERMISSIONS_PER_MONTH - permissionsTaken);

  return {
    month: monthStr,
    maxPaidLeaves: MAX_PAID_LEAVES_PER_MONTH,
    maxPermissions: MAX_PERMISSIONS_PER_MONTH,
    maxHoursPerPermission: MAX_HOURS_PER_PERMISSION,
    paidLeavesLimit: MAX_PAID_LEAVES_PER_MONTH,
    permissionsLimit: MAX_PERMISSIONS_PER_MONTH,
    paidLeavesTaken: Number(paidLeavesTaken.toFixed(1)),
    paidLeavesRemaining: remainingPaid,
    paidLeavesBalance: remainingPaid,
    permissionsTaken,
    permissionsRemaining: remainingPerm,
    permissionsBalance: remainingPerm,
  };
}

/**
 * 1. GET /leaves/quota
 * Returns caller's (or queried employeeId's) monthly leave & permission quota balance
 */
async function getLeaveQuota(req, res, next) {
  try {
    const callerId = req.staff?.id;
    const targetId = req.query.employeeId || callerId;
    const month = req.query.month || getCurrentMonthString();

    const usage = await computeMonthlyLeaveUsage(targetId, month);

    return res.status(200).json({
      success: true,
      data: {
        employeeId: targetId,
        ...usage,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. POST /leaves
 * Apply for leave or short permission
 */
async function applyLeave(req, res, next) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Get fresh employee details and team info
    const [staffRows] = await pool.query(
      `SELECT s.id, s.employee_id as employeeCode, s.full_name as name, s.designation, s.department, s.team_id,
              t.lead_id, t.name as teamName
       FROM staff_users s
       LEFT JOIN teams t ON s.team_id = t.id
       WHERE s.id = ?`,
      [callerId]
    );

    if (staffRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const staff = staffRows[0];
    const {
      leaveFor, // 'CASUAL_LEAVE', 'SICK_LEAVE', 'EMERGENCY_LEAVE', 'PAID_LEAVE', 'PERMISSION', 'UNPAID_LEAVE', 'OTHER'
      periodFrom,
      periodTo,
      sessionType = 'FULL_DAY', // 'FULL_DAY', 'FIRST_HALF', 'SECOND_HALF', 'PERMISSION_HOURS'
      permissionHours,
      permissionTime,
      fromTime,
      toTime,
      numberOfDays = 1.0,
      reason,
      handoverPersonId,
      handoverPersonName,
      handoverWorkDetails,
      signature,
    } = req.body;

    if (!leaveFor || !periodFrom || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Leave type (leaveFor), start date (periodFrom), and reason are required.',
      });
    }

    const applicationDate = new Date().toISOString().slice(0, 10);
    const toDate = periodTo || periodFrom;
    const leaveMonth = getCurrentMonthString(periodFrom);

    // Calculate current usage
    const usage = await computeMonthlyLeaveUsage(callerId, leaveMonth);
    const alreadyTookLeaveCount = usage.paidLeavesTaken;
    const alreadyTookPermissionCount = usage.permissionsTaken;

    // Validate permission hours & time window if leaveFor is PERMISSION
    let numDays = 1.0;
    let permHours = null;
    let finalPermTime = permissionTime || null;

    if (leaveFor === 'PERMISSION') {
      const fTime = fromTime || (permissionTime && permissionTime.includes('–') ? permissionTime.split('–')[0].trim() : (permissionTime && permissionTime.includes('-') ? permissionTime.split('-')[0].trim() : null));
      const tTime = toTime || (permissionTime && permissionTime.includes('–') ? permissionTime.split('–')[1].trim() : (permissionTime && permissionTime.includes('-') ? permissionTime.split('-')[1].trim() : null));

      if (fTime && tTime) {
        try {
          const [h1, m1] = String(fTime).split(':').map(Number);
          const [h2, m2] = String(tTime).split(':').map(Number);
          const diffMin = (h2 * 60 + (m2 || 0)) - (h1 * 60 + (m1 || 0));
          if (diffMin <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Permission To Time must be after From Time.',
            });
          }
          if (diffMin > 120) {
            return res.status(400).json({
              success: false,
              message: `Permission cannot exceed 2 hours (selected: ${Math.floor(diffMin / 60)}h ${diffMin % 60}m). Must be 2 hours or below.`,
            });
          }
          permHours = Number((diffMin / 60).toFixed(1));
          finalPermTime = `${fTime} – ${tTime}`;
        } catch (_) {
          permHours = Number(permissionHours) || 2.0;
        }
      } else {
        permHours = Number(permissionHours) || 2.0;
      }

      if (permHours > MAX_HOURS_PER_PERMISSION) {
        return res.status(400).json({
          success: false,
          message: `Permissions are allowed up to a maximum of ${MAX_HOURS_PER_PERMISSION} hours per session (Below 2h or exact 2h).`,
        });
      }
      numDays = 0; // Permission does not count as full/half day leave
    } else if (sessionType === 'FIRST_HALF' || sessionType === 'SECOND_HALF') {
      numDays = 0.5;
    } else {
      try {
        const [y1, m1, d1] = String(periodFrom).slice(0, 10).split('-').map(Number);
        const [y2, m2, d2] = String(toDate).slice(0, 10).split('-').map(Number);
        const dt1 = new Date(y1, m1 - 1, d1);
        const dt2 = new Date(y2, m2 - 1, d2);
        const diff = Math.round((dt2.getTime() - dt1.getTime()) / 86400000) + 1;
        numDays = diff > 0 ? diff : 1.0;
      } catch (_) {
        numDays = Number(numberOfDays) || 1.0;
      }
    }

    const finalSign = signature || req.body.employeeSignature || staff.name || null;

    // Determine 3-tier approval starting stage
    // TL -> GM -> HR
    let tlId = staff.lead_id ? Number(staff.lead_id) : null;
    let tlStatus = 'PENDING';
    let gmStatus = 'PENDING';
    let hrStatus = 'PENDING';
    let initialStatus = 'PENDING_TL';

    const roleUpper = (req.staff?.role || '').toUpperCase();
    const desigLower = (staff.designation || '').toLowerCase();
    const perms = parsePermissions(req.staff?.permissions);

    const isGM = roleUpper === 'GENERAL_MANAGER' || desigLower.includes('general manager') || desigLower.includes('gm') || perms.includes('leaves_gm');
    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isTeamLead = staff.lead_id && String(staff.lead_id) === String(callerId);

    if (isMD) {
      // MD applies -> auto-approved
      tlStatus = 'SKIPPED';
      gmStatus = 'SKIPPED';
      hrStatus = 'APPROVED';
      initialStatus = 'APPROVED';
    } else if (isGM) {
      // GM applies -> skips TL & GM, goes directly to HR
      tlStatus = 'SKIPPED';
      gmStatus = 'SKIPPED';
      initialStatus = 'PENDING_HR';
    } else if (isTeamLead || !tlId || String(tlId) === String(callerId)) {
      // Team lead or staff with no team lead -> skips TL, goes to GM
      tlStatus = 'SKIPPED';
      initialStatus = 'PENDING_GM';
    }

    const [result] = await pool.query(
      `INSERT INTO leave_applications (
        employee_id, employee_code, employee_name, designation, department,
        application_date, leave_for, period_from, period_to, session_type,
        permission_hours, permission_time, number_of_days,
        already_took_leave_count, already_took_permission_count,
        reason, handover_person_id, handover_person_name, handover_work_details,
        employee_signature, tl_id, tl_status, gm_status, hr_status, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        callerId,
        staff.employeeCode,
        staff.name,
        staff.designation || 'Staff',
        staff.department || 'General',
        applicationDate,
        leaveFor,
        periodFrom,
        toDate,
        sessionType,
        permHours,
        finalPermTime || null,
        numDays,
        alreadyTookLeaveCount,
        alreadyTookPermissionCount,
        reason,
        handoverPersonId || null,
        handoverPersonName || null,
        handoverWorkDetails || null,
        finalSign,
        tlId,
        tlStatus,
        gmStatus,
        hrStatus,
        initialStatus,
      ]
    );

    const newId = result.insertId;

    return res.status(201).json({
      success: true,
      message: 'Leave application submitted successfully.',
      data: formatLeaveRow({
        id: newId,
        employee_id: callerId,
        employee_code: staff.employeeCode,
        employee_name: staff.name,
        designation: staff.designation,
        department: staff.department,
        application_date: applicationDate,
        leave_for: leaveFor,
        period_from: periodFrom,
        period_to: toDate,
        session_type: sessionType,
        permission_hours: permHours,
        permission_time: permissionTime,
        number_of_days: numDays,
        status: initialStatus,
        already_took_leave_count: alreadyTookLeaveCount,
        already_took_permission_count: alreadyTookPermissionCount,
        reason,
        handover_person_id: handoverPersonId,
        handover_person_name: handoverPersonName,
        handover_work_details: handoverWorkDetails,
        employee_signature: finalSign,
        tl_status: tlStatus,
        gm_status: gmStatus,
        hr_status: hrStatus,
      }),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. GET /leaves/my
 * View all leaves applied by logged-in staff
 */
async function getMyLeaves(req, res, next) {
  try {
    const callerId = req.staff?.id;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { status, month, leaveFor } = req.query;
    let where = ['employee_id = ?'];
    let params = [callerId];

    if (status && status !== 'ALL') {
      where.push('status = ?');
      params.push(status);
    }
    if (month) {
      where.push("DATE_FORMAT(period_from, '%Y-%m') = ?");
      params.push(month);
    }
    if (leaveFor && leaveFor !== 'ALL') {
      where.push('leave_for = ?');
      params.push(leaveFor);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM leave_applications ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT * FROM leave_applications ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Current month usage
    const currentMonthUsage = await computeMonthlyLeaveUsage(callerId, getCurrentMonthString());

    return res.status(200).json({
      success: true,
      data: rows.map(formatLeaveRow),
      quota: currentMonthUsage,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. GET /leaves
 * Approvals inbox and company/team leaves list based on role:
 * - HR / MD / leaves_manage: sees all leaves
 * - GM / leaves_gm: sees all company leaves or managed team leaves
 * - Team Lead: sees team members' leaves
 */
async function getLeaves(req, res, next) {
  try {
    const callerId = req.staff?.id;
    const perms = parsePermissions(req.staff?.permissions);
    const roleUpper = (req.staff?.role || '').toUpperCase();

    // Dynamically resolve caller's team lead / management context
    const [callerProfile] = await pool.query(
      `SELECT id, team_id, managed_teams, role, permissions FROM staff_users WHERE id = ?`,
      [callerId]
    );
    const callerStaff = callerProfile[0] || {};

    const [leadTeamRows] = await pool.query(
      `SELECT id FROM teams WHERE lead_id = ?`,
      [callerId]
    );

    const leadTeamIds = new Set();
    leadTeamRows.forEach((t) => leadTeamIds.add(Number(t.id)));
    if (callerStaff.team_id) leadTeamIds.add(Number(callerStaff.team_id));
    if (callerStaff.managed_teams) {
      try {
        const mt = typeof callerStaff.managed_teams === 'string'
          ? JSON.parse(callerStaff.managed_teams)
          : callerStaff.managed_teams;
        if (Array.isArray(mt)) {
          mt.forEach((tid) => leadTeamIds.add(Number(tid)));
        }
      } catch (_) {}
    }
    const teamIdList = [...leadTeamIds].filter(Boolean);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage');
    const isGM = isHR || roleUpper === 'GENERAL_MANAGER' || perms.includes('leaves_gm');
    const isLead = !isGM && (
      leadTeamIds.size > 0 ||
      ['LEAD', 'TEAM_LEAD'].includes(roleUpper) ||
      perms.includes('reports_own_team') ||
      perms.includes('leaves_lead')
    );

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { status, stage, department, q, month, from, to } = req.query;

    let where = ['1=1'];
    let params = [];

    // Role-based scope
    if (isHR || isMD) {
      // HR/MD sees all staff leaves
    } else if (isGM) {
      // GM sees all company leaves (except MD)
      where.push("s.role NOT IN ('ADMIN', 'SUPER_ADMIN')");
    } else if (isLead) {
      // Team lead sees own leaves + leaves assigned to them as TL + leaves of all teammates in lead teams
      if (teamIdList.length > 0) {
        where.push(`(la.employee_id = ? OR la.tl_id = ? OR s.team_id IN (${teamIdList.join(',')}))`);
        params.push(callerId, callerId);
      } else {
        where.push('(la.employee_id = ? OR la.tl_id = ?)');
        params.push(callerId, callerId);
      }
    } else {
      // Individual employee only sees own leaves
      where.push('la.employee_id = ?');
      params.push(callerId);
    }

    // Filter by stage / pending my approval
    if (stage === 'pending_my_approval') {
      if (isHR) {
        where.push("la.status IN ('PENDING_HR', 'PENDING_GM', 'PENDING_TL')");
      } else if (isGM) {
        where.push("la.status IN ('PENDING_GM', 'PENDING_TL')");
      } else if (isLead) {
        if (teamIdList.length > 0) {
          where.push(`la.status = 'PENDING_TL' AND (la.tl_id = ? OR s.team_id IN (${teamIdList.join(',')}))`);
          params.push(callerId);
        } else {
          where.push("la.status = 'PENDING_TL' AND la.tl_id = ?");
          params.push(callerId);
        }
      }
    } else if (status && status !== 'ALL') {
      where.push('la.status = ?');
      params.push(status);
    }

    if (department && department !== 'ALL') {
      where.push('la.department = ?');
      params.push(department);
    }

    if (month) {
      where.push("DATE_FORMAT(la.period_from, '%Y-%m') = ?");
      params.push(month);
    }

    if (from) {
      where.push('la.period_from >= ?');
      params.push(from);
    }
    if (to) {
      where.push('la.period_to <= ?');
      params.push(to);
    }

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      where.push('(la.employee_name LIKE ? OR la.employee_code LIKE ? OR la.reason LIKE ?)');
      params.push(term, term, term);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM leave_applications la
       LEFT JOIN staff_users s ON la.employee_id = s.id
       ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT la.*, s.phone_number as employeePhone, s.email as employeeEmail,
              s.branch_location as branch
       FROM leave_applications la
       LEFT JOIN staff_users s ON la.employee_id = s.id
       ${whereSql}
       ORDER BY la.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Summary counts for quick badges
    const [countsRows] = await pool.query(
      `SELECT 
        SUM(CASE WHEN la.status = 'PENDING_TL' THEN 1 ELSE 0 END) as pendingTL,
        SUM(CASE WHEN la.status = 'PENDING_GM' THEN 1 ELSE 0 END) as pendingGM,
        SUM(CASE WHEN la.status = 'PENDING_HR' THEN 1 ELSE 0 END) as pendingHR,
        SUM(CASE WHEN la.status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN la.status = 'REJECTED' THEN 1 ELSE 0 END) as rejected
       FROM leave_applications la
       LEFT JOIN staff_users s ON la.employee_id = s.id
       ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(formatLeaveRow),
      summary: countsRows[0] || {},
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. GET /leaves/:id
 * Get single leave application with full timeline details
 */
async function getLeaveById(req, res, next) {
  try {
    const leaveId = req.params.id;
    const [rows] = await pool.query(
      `SELECT la.*, s.phone_number as employeePhone, s.email as employeeEmail, s.branch_location as branch
       FROM leave_applications la
       LEFT JOIN staff_users s ON la.employee_id = s.id
       WHERE la.id = ?`,
      [leaveId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave application not found' });
    }

    return res.status(200).json({
      success: true,
      data: formatLeaveRow(rows[0]),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. PATCH /leaves/:id/approve
 * Approves leave application at current stage:
 * - TL approves -> advances to PENDING_GM
 * - GM approves -> advances to PENDING_HR
 * - HR approves -> finalizes as APPROVED
 */
async function approveLeave(req, res, next) {
  try {
    const leaveId = req.params.id;
    const callerId = req.staff?.id;
    const callerName = req.staff?.fullName || req.staff?.name || 'Authorized Approver';
    const comments = req.body.comments || '';

    const perms = parsePermissions(req.staff?.permissions);
    const roleUpper = (req.staff?.role || '').toUpperCase();
    const desigLower = (req.staff?.designation || '').toLowerCase();

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage');
    const isGM = !isHR && (
      roleUpper === 'GENERAL_MANAGER' ||
      roleUpper === 'SALES_HEAD' ||
      desigLower.includes('general manager') ||
      desigLower.includes('gm') ||
      perms.includes('leaves_gm')
    );

    const [rows] = await pool.query(
      'SELECT * FROM leave_applications WHERE id = ?',
      [leaveId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave application not found' });
    }

    const leave = rows[0];

    if (leave.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Leave is already fully approved.' });
    }
    if (leave.status === 'REJECTED' || leave.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: `Cannot approve a leave that is ${leave.status}.` });
    }

    const now = new Date();

    // 1. HR or MD Approval -> Grants final leave approval directly
    // If TL or GM had not acted yet, mark them as SKIPPED so it's clear HR approved directly
    if (isHR || isMD) {
      const tlStatus = leave.tl_status === 'APPROVED' ? 'APPROVED' : 'SKIPPED';
      const gmStatus = leave.gm_status === 'APPROVED' ? 'APPROVED' : 'SKIPPED';

      await pool.query(
        `UPDATE leave_applications 
         SET tl_status = ?,
             gm_status = ?,
             hr_status = 'APPROVED',
             hr_approved_by = ?,
             hr_approved_name = ?,
             hr_comments = ?,
             hr_action_at = ?,
             status = 'APPROVED'
         WHERE id = ?`,
        [tlStatus, gmStatus, callerId, callerName, comments, now, leaveId]
      );

      return res.status(200).json({
        success: true,
        message: 'Leave officially approved by HR.',
        stage: 'APPROVED',
      });
    }

    // 2. General Manager (GM) Approval -> Approves directly as GM and forwards to HR
    // If TL had not acted yet, TL is marked as SKIPPED so it's recorded in GM approval only
    if (isGM) {
      if (leave.status === 'PENDING_HR') {
        return res.status(403).json({
          success: false,
          message: 'This leave is already awaiting final HR approval.',
        });
      }

      const tlStatus = leave.tl_status === 'APPROVED' ? 'APPROVED' : 'SKIPPED';

      await pool.query(
        `UPDATE leave_applications 
         SET tl_status = ?,
             gm_status = 'APPROVED',
             gm_approved_by = ?,
             gm_approved_name = ?,
             gm_comments = ?,
             gm_action_at = ?,
             status = 'PENDING_HR'
         WHERE id = ?`,
        [tlStatus, callerId, callerName, comments, now, leaveId]
      );

      return res.status(200).json({
        success: true,
        message: 'Leave approved by General Manager. Forwarded to HR for final confirmation.',
        stage: 'PENDING_HR',
      });
    }

    // 3. Team Lead (TL) Approval -> Approves as TL and forwards to GM
    if (leave.status === 'PENDING_TL') {
      const isAssignedTL = leave.tl_id && String(leave.tl_id) === String(callerId);
      const isLead = isAssignedTL || ['LEAD', 'TEAM_LEAD'].includes(roleUpper) || perms.includes('reports_own_team') || perms.includes('leaves_lead');
      if (!isLead) {
        return res.status(403).json({
          success: false,
          message: 'Only the designated Team Lead, General Manager, or HR can approve this leave.',
        });
      }

      await pool.query(
        `UPDATE leave_applications 
         SET tl_status = 'APPROVED',
             tl_approved_by = ?,
             tl_approved_name = ?,
             tl_comments = ?,
             tl_action_at = ?,
             status = 'PENDING_GM'
         WHERE id = ?`,
        [callerId, callerName, comments, now, leaveId]
      );

      return res.status(200).json({
        success: true,
        message: 'Leave approved by Team Lead. Forwarded to General Manager for review.',
        stage: 'PENDING_GM',
      });
    }

    return res.status(403).json({
      success: false,
      message: 'You do not have permission to approve at this stage.',
    });

    return res.status(400).json({ success: false, message: 'Invalid leave approval state.' });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. PATCH /leaves/:id/reject
 * Only HR (or MD) has authority to reject leave applications
 */
async function rejectLeave(req, res, next) {
  try {
    const leaveId = req.params.id;
    const callerId = req.staff?.id;
    const callerName = req.staff?.fullName || req.staff?.name || 'HR Department';
    const comments = req.body.comments;

    if (!comments || !comments.trim()) {
      return res.status(400).json({ success: false, message: 'Rejection reason/comments are required.' });
    }

    const perms = parsePermissions(req.staff?.permissions);
    const roleUpper = (req.staff?.role || '').toUpperCase();

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage');

    if (!isHR && !isMD) {
      return res.status(403).json({
        success: false,
        message: 'Only Human Resources (HR) or MD has the authority to reject a leave application.',
      });
    }

    const [rows] = await pool.query('SELECT * FROM leave_applications WHERE id = ?', [leaveId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave application not found' });
    }

    const leave = rows[0];
    if (leave.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Cannot reject a leave that is already approved.' });
    }
    if (leave.status === 'REJECTED') {
      return res.status(400).json({ success: false, message: 'Leave is already rejected.' });
    }

    const now = new Date();

    await pool.query(
      `UPDATE leave_applications 
       SET hr_status = 'REJECTED',
           hr_approved_by = ?,
           hr_approved_name = ?,
           hr_comments = ?,
           hr_action_at = ?,
           status = 'REJECTED'
       WHERE id = ?`,
      [callerId, callerName, comments.trim(), now, leaveId]
    );

    return res.status(200).json({
      success: true,
      message: 'Leave application rejected by HR.',
      stage: 'REJECTED',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 8. PATCH /leaves/:id/cancel
 * Allows applicant to cancel their own pending leave request
 */
async function cancelLeave(req, res, next) {
  try {
    const leaveId = req.params.id;
    const callerId = req.staff?.id;

    const [rows] = await pool.query('SELECT * FROM leave_applications WHERE id = ?', [leaveId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave application not found' });
    }

    const leave = rows[0];
    if (String(leave.employee_id) !== String(callerId)) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own leave requests.' });
    }

    if (leave.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Cannot cancel an already approved leave. Please contact HR.' });
    }

    await pool.query(
      "UPDATE leave_applications SET status = 'CANCELLED' WHERE id = ?",
      [leaveId]
    );

    return res.status(200).json({
      success: true,
      message: 'Leave request cancelled successfully.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 9. GET /leaves/monthly-summary
 * Returns monthly leave & permission quota usage for every employee in caller's scope
 * - 4 paid leaves per month limit
 * - 2 permissions per month limit (max 2h each)
 * - Computes paid leaves taken, balance, permissions taken, balance, unpaid/excess, gatepasses
 */
async function getMonthlyLeaveSummary(req, res, next) {
  try {
    const callerId = req.staff?.id;
    const perms = parsePermissions(req.staff?.permissions);
    const roleUpper = (req.staff?.role || '').toUpperCase();

    const [callerProfile] = await pool.query(
      `SELECT id, team_id, managed_teams, role, permissions FROM staff_users WHERE id = ?`,
      [callerId]
    );
    const callerStaff = callerProfile[0] || {};

    const [leadTeamRows] = await pool.query(
      `SELECT id FROM teams WHERE lead_id = ?`,
      [callerId]
    );

    const leadTeamIds = new Set();
    leadTeamRows.forEach((t) => leadTeamIds.add(Number(t.id)));
    if (callerStaff.team_id) leadTeamIds.add(Number(callerStaff.team_id));
    if (callerStaff.managed_teams) {
      try {
        const mt = typeof callerStaff.managed_teams === 'string'
          ? JSON.parse(callerStaff.managed_teams)
          : callerStaff.managed_teams;
        if (Array.isArray(mt)) {
          mt.forEach((tid) => leadTeamIds.add(Number(tid)));
        }
      } catch (_) {}
    }
    const teamIdList = [...leadTeamIds].filter(Boolean);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage');
    const isGM = isHR || roleUpper === 'GENERAL_MANAGER' || perms.includes('leaves_gm');
    const isLead = !isGM && (
      leadTeamIds.size > 0 ||
      ['LEAD', 'TEAM_LEAD'].includes(roleUpper) ||
      perms.includes('reports_own_team') ||
      perms.includes('leaves_lead')
    );

    const targetMonth = req.query.month || getCurrentMonthString();
    const department = req.query.department;
    const q = req.query.q;

    let staffWhere = ["s.is_active = 1 AND s.role NOT IN ('ADMIN', 'SUPER_ADMIN')"];
    let staffParams = [];

    if (isHR || isMD) {
      // HR/MD sees all active staff
    } else if (isGM) {
      // GM sees company staff
    } else if (isLead) {
      if (teamIdList.length > 0) {
        staffWhere.push(`(s.id = ? OR s.team_id IN (${teamIdList.join(',')}))`);
        staffParams.push(callerId);
      } else {
        staffWhere.push('s.id = ?');
        staffParams.push(callerId);
      }
    } else {
      staffWhere.push('s.id = ?');
      staffParams.push(callerId);
    }

    if (department && department !== 'ALL') {
      staffWhere.push('s.department = ?');
      staffParams.push(department);
    }
    if (q && q.trim()) {
      staffWhere.push('(s.full_name LIKE ? OR s.employee_id LIKE ?)');
      staffParams.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    const staffWhereSql = staffWhere.length > 0 ? `WHERE ${staffWhere.join(' AND ')}` : '';
    const [staffList] = await pool.query(
      `SELECT s.id, s.employee_id as employeeCode, s.full_name as name, s.department, s.designation, s.role
       FROM staff_users s
       ${staffWhereSql}
       ORDER BY s.full_name ASC`,
      staffParams
    );

    if (staffList.length === 0) {
      return res.status(200).json({
        success: true,
        month: targetMonth,
        data: [],
        summary: { totalStaff: 0, totalPaidTaken: 0, totalPermTaken: 0, totalGatePasses: 0 },
      });
    }

    const staffIds = staffList.map((s) => s.id);

    // Query leaves for targetMonth
    const [leaveRows] = await pool.query(
      `SELECT 
         employee_id,
         leave_for,
         number_of_days,
         permission_hours,
         status
       FROM leave_applications
       WHERE employee_id IN (?)
         AND DATE_FORMAT(period_from, '%Y-%m') = ?
         AND status NOT IN ('REJECTED', 'CANCELLED')`,
      [staffIds, targetMonth]
    );

    // Query gate passes for targetMonth
    const [gpRows] = await pool.query(
      `SELECT
         employee_id,
         purpose,
         approval_status
       FROM gate_passes
       WHERE employee_id IN (?)
         AND DATE_FORMAT(date, '%Y-%m') = ?
         AND approval_status NOT IN ('REJECTED', 'CANCELLED')`,
      [staffIds, targetMonth]
    );

    const leaveMap = {};
    leaveRows.forEach((r) => {
      const eid = r.employee_id;
      if (!leaveMap[eid]) {
        leaveMap[eid] = {
          paidLeavesTaken: 0,
          permissionsTaken: 0,
          permissionHoursTotal: 0,
          unpaidLeavesTaken: 0,
          leaveRecordsCount: 0,
        };
      }
      leaveMap[eid].leaveRecordsCount += 1;
      if (r.leave_for === 'PERMISSION') {
        leaveMap[eid].permissionsTaken += 1;
        leaveMap[eid].permissionHoursTotal += Number(r.permission_hours || 0);
      } else if (['UNPAID', 'UNPAID_LEAVE', 'LOP'].includes(String(r.leave_for).toUpperCase())) {
        leaveMap[eid].unpaidLeavesTaken += Number(r.number_of_days || 0);
      } else {
        leaveMap[eid].paidLeavesTaken += Number(r.number_of_days || 0);
      }
    });

    const gpMap = {};
    gpRows.forEach((r) => {
      const eid = r.employee_id;
      if (!gpMap[eid]) {
        gpMap[eid] = {
          gatePassesCount: 0,
          officialWorkCount: 0,
          personalWorkCount: 0,
          emergencyCount: 0,
        };
      }
      gpMap[eid].gatePassesCount += 1;
      if (r.purpose === 'OFFICIAL_WORK') gpMap[eid].officialWorkCount += 1;
      else if (r.purpose === 'PERSONAL_WORK') gpMap[eid].personalWorkCount += 1;
      else if (r.purpose === 'EMERGENCY') gpMap[eid].emergencyCount += 1;
    });

    let sumPaidTaken = 0;
    let sumPermTaken = 0;
    let sumGatePasses = 0;

    const data = staffList.map((s) => {
      const lm = leaveMap[s.id] || { paidLeavesTaken: 0, permissionsTaken: 0, permissionHoursTotal: 0, unpaidLeavesTaken: 0, leaveRecordsCount: 0 };
      const gm = gpMap[s.id] || { gatePassesCount: 0, officialWorkCount: 0, personalWorkCount: 0, emergencyCount: 0 };

      const paidTaken = Number(lm.paidLeavesTaken.toFixed(1));
      const paidRemaining = Number(Math.max(0, MAX_PAID_LEAVES_PER_MONTH - paidTaken).toFixed(1));
      const permTaken = lm.permissionsTaken;
      const permRemaining = Math.max(0, MAX_PERMISSIONS_PER_MONTH - permTaken);
      const unpaid = Number((lm.unpaidLeavesTaken + Math.max(0, paidTaken - MAX_PAID_LEAVES_PER_MONTH)).toFixed(1));

      sumPaidTaken += paidTaken;
      sumPermTaken += permTaken;
      sumGatePasses += gm.gatePassesCount;

      return {
        id: s.id,
        employeeCode: s.employeeCode || `EMP${s.id}`,
        name: s.name,
        department: s.department || 'General',
        designation: s.designation || 'Staff',
        paidLeavesLimit: MAX_PAID_LEAVES_PER_MONTH,
        paidLeavesTaken: paidTaken,
        paidLeavesRemaining: paidRemaining,
        permissionsLimit: MAX_PERMISSIONS_PER_MONTH,
        permissionsTaken: permTaken,
        permissionsRemaining: permRemaining,
        permissionHoursTotal: Number(lm.permissionHoursTotal.toFixed(1)),
        unpaidLeavesTaken: unpaid,
        gatePassesCount: gm.gatePassesCount,
        officialWorkCount: gm.officialWorkCount,
        personalWorkCount: gm.personalWorkCount,
        emergencyCount: gm.emergencyCount,
        leaveRecordsCount: lm.leaveRecordsCount,
        isOverLimit: paidTaken > MAX_PAID_LEAVES_PER_MONTH || permTaken > MAX_PERMISSIONS_PER_MONTH,
      };
    });

    return res.status(200).json({
      success: true,
      month: targetMonth,
      data,
      summary: {
        totalStaff: staffList.length,
        totalPaidTaken: Number(sumPaidTaken.toFixed(1)),
        totalPermTaken: sumPermTaken,
        totalGatePasses: sumGatePasses,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLeaveQuota,
  getMonthlyLeaveSummary,
  applyLeave,
  getMyLeaves,
  getLeaves,
  getLeaveById,
  approveLeave,
  rejectLeave,
  cancelLeave,
};
