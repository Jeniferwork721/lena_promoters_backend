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
  return {
    ...la,
    id: la.id,
    employeeId: la.employee_id,
    employeeCode: la.employee_code,
    employeeName: la.employee_name,
    designation: la.designation || '',
    department: la.department || '',
    applicationDate: la.application_date ? String(la.application_date).slice(0, 10) : '',
    leaveFor: la.leave_for,
    periodFrom: la.period_from ? String(la.period_from).slice(0, 10) : '',
    periodTo: la.period_to ? String(la.period_to).slice(0, 10) : '',
    sessionType: la.session_type || 'FULL_DAY',
    permissionHours: la.permission_hours != null ? Number(la.permission_hours) : 0,
    permissionTime: la.permission_time || '',
    numberOfDays: la.number_of_days != null ? Number(la.number_of_days) : 1.0,
    alreadyTookLeaveCount: la.already_took_leave_count != null ? Number(la.already_took_leave_count) : 0,
    alreadyTookPermissionCount: la.already_took_permission_count != null ? Number(la.already_took_permission_count) : 0,
    reason: la.reason || '',
    handoverPersonId: la.handover_person_id || null,
    handoverPersonName: la.handover_person_name || '',
    handoverWorkDetails: la.handover_work_details || '',
    employeeSignature: la.employee_signature || '',
    tlId: la.tl_id || null,
    tlStatus: la.tl_status || 'PENDING',
    tlApprovedBy: la.tl_approved_by || null,
    tlApprovedName: la.tl_approved_name || null,
    tlComments: la.tl_comments || '',
    tlActionAt: la.tl_action_at || null,
    gmId: la.gm_id || null,
    gmStatus: la.gm_status || 'PENDING',
    gmApprovedBy: la.gm_approved_by || null,
    gmApprovedName: la.gm_approved_name || null,
    gmComments: la.gm_comments || '',
    gmActionAt: la.gm_action_at || null,
    hrStatus: la.hr_status || 'PENDING',
    hrApprovedBy: la.hr_approved_by || null,
    hrApprovedName: la.hr_approved_name || null,
    hrComments: la.hr_comments || '',
    hrActionAt: la.hr_action_at || null,
    status: la.status,
    createdAt: la.created_at || '',
    updatedAt: la.updated_at || '',
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

  return {
    month: monthStr,
    paidLeavesTaken: Number(paidLeavesTaken.toFixed(1)),
    permissionsTaken,
    paidLeavesRemaining: Number(Math.max(0, MAX_PAID_LEAVES_PER_MONTH - paidLeavesTaken).toFixed(1)),
    permissionsRemaining: Math.max(0, MAX_PERMISSIONS_PER_MONTH - permissionsTaken),
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
        month,
        employeeId: targetId,
        maxPaidLeaves: MAX_PAID_LEAVES_PER_MONTH,
        maxPermissions: MAX_PERMISSIONS_PER_MONTH,
        maxHoursPerPermission: MAX_HOURS_PER_PERMISSION,
        paidLeavesTaken: usage.paidLeavesTaken,
        paidLeavesRemaining: usage.paidLeavesRemaining,
        permissionsTaken: usage.permissionsTaken,
        permissionsRemaining: usage.permissionsRemaining,
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

    // Validate permission hours if leaveFor is PERMISSION
    let numDays = 1.0;
    let permHours = null;
    if (leaveFor === 'PERMISSION') {
      permHours = Number(permissionHours) || 2.0;
      if (permHours > MAX_HOURS_PER_PERMISSION) {
        return res.status(400).json({
          success: false,
          message: `Permissions are allowed up to a maximum of ${MAX_HOURS_PER_PERMISSION} hours per session.`,
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
        permissionTime || null,
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

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage');
    const isGM = isHR || roleUpper === 'GENERAL_MANAGER' || perms.includes('leaves_gm');
    const isLead = !isGM && (['LEAD', 'TEAM_LEAD'].includes(roleUpper) || perms.includes('reports_own_team'));

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
      // Team lead sees leaves where tl_id = callerId OR employee belongs to team
      where.push('(la.tl_id = ? OR s.team_id = (SELECT team_id FROM staff_users WHERE id = ?))');
      params.push(callerId, callerId);
    } else {
      // Individual employee only sees own leaves
      where.push('la.employee_id = ?');
      params.push(callerId);
    }

    // Filter by stage / pending my approval
    if (stage === 'pending_my_approval') {
      if (isHR) {
        where.push("la.status = 'PENDING_HR'");
      } else if (isGM) {
        where.push("la.status = 'PENDING_GM'");
      } else if (isLead) {
        where.push("la.status = 'PENDING_TL' AND (la.tl_id = ? OR s.team_id = (SELECT team_id FROM staff_users WHERE id = ?))");
        params.push(callerId, callerId);
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

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage');
    const isGM = isHR || roleUpper === 'GENERAL_MANAGER' || perms.includes('leaves_gm');

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

    // Stage 1: PENDING_TL
    if (leave.status === 'PENDING_TL') {
      const isAssignedTL = leave.tl_id && String(leave.tl_id) === String(callerId);
      if (!isAssignedTL && !isGM && !isHR && !isMD) {
        return res.status(403).json({
          success: false,
          message: 'Only the designated Team Lead, General Manager, or HR can approve this stage.',
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

    // Stage 2: PENDING_GM
    if (leave.status === 'PENDING_GM') {
      if (!isGM && !isHR && !isMD) {
        return res.status(403).json({
          success: false,
          message: 'Only the General Manager, HR, or MD can approve this stage.',
        });
      }

      await pool.query(
        `UPDATE leave_applications 
         SET gm_status = 'APPROVED',
             gm_approved_by = ?,
             gm_approved_name = ?,
             gm_comments = ?,
             gm_action_at = ?,
             status = 'PENDING_HR'
         WHERE id = ?`,
        [callerId, callerName, comments, now, leaveId]
      );

      return res.status(200).json({
        success: true,
        message: 'Leave approved by General Manager. Forwarded to HR for final confirmation.',
        stage: 'PENDING_HR',
      });
    }

    // Stage 3: PENDING_HR
    if (leave.status === 'PENDING_HR') {
      if (!isHR && !isMD) {
        return res.status(403).json({
          success: false,
          message: 'Only HR or MD can grant final leave approval.',
        });
      }

      await pool.query(
        `UPDATE leave_applications 
         SET hr_status = 'APPROVED',
             hr_approved_by = ?,
             hr_approved_name = ?,
             hr_comments = ?,
             hr_action_at = ?,
             status = 'APPROVED'
         WHERE id = ?`,
        [callerId, callerName, comments, now, leaveId]
      );

      return res.status(200).json({
        success: true,
        message: 'Leave officially approved by HR.',
        stage: 'APPROVED',
      });
    }

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

module.exports = {
  getLeaveQuota,
  applyLeave,
  getMyLeaves,
  getLeaves,
  getLeaveById,
  approveLeave,
  rejectLeave,
  cancelLeave,
};
