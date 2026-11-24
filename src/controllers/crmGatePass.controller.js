const { pool } = require('../config/db');

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
 * Normalizes gate pass row to guarantee both camelCase and snake_case properties
 */
function formatGatePass(gp) {
  if (!gp) return null;
  return {
    ...gp,
    id: gp.id,
    passNumber: gp.pass_number || `GP-${gp.id}`,
    employeeId: gp.employee_id,
    employeeCode: gp.employee_code,
    employeeName: gp.employee_name,
    department: gp.department,
    date: gp.date ? String(gp.date).slice(0, 10) : '',
    purpose: gp.purpose,
    purposeOther: gp.purpose_other || '',
    reason: gp.reason || '',
    outTime: gp.out_time || '',
    expectedReturn: gp.expected_return || '',
    actualReturnTime: gp.actual_return_time || null,
    employeeSignature: gp.employee_signature || '',
    approvalStatus: gp.approval_status,
    approvedById: gp.approved_by_id || null,
    approvedByName: gp.approved_by_name || null,
    approvedAt: gp.approved_at || null,
    returnRecordedAt: gp.return_recorded_at || null,
    returnRecordedBy: gp.return_recorded_by || null,
    returnRecordedName: gp.return_recorded_name || null,
    remarks: gp.remarks || '',
    createdAt: gp.created_at || '',
  };
}

/**
 * Generate unique Gate Pass Number: GP-YYYYMM-XXXX
 */
async function generateNextGatePassNumber() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = `GP-${yyyy}${mm}-`;

  const [rows] = await pool.query(
    `SELECT pass_number FROM gate_passes 
     WHERE pass_number LIKE ? 
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0 && rows[0].pass_number) {
    const parts = rows[0].pass_number.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * 1. POST /gate-passes
 * Apply for a gate pass
 */
async function applyGatePass(req, res, next) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const [staffRows] = await pool.query(
      `SELECT s.id, s.employee_id as employeeCode, s.full_name as name, s.department
       FROM staff_users s WHERE s.id = ?`,
      [callerId]
    );

    if (staffRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee profile not found' });
    }

    const staff = staffRows[0];
    const {
      department,
      purpose, // 'OFFICIAL_WORK', 'PERSONAL_WORK', 'EMERGENCY'
      purposeOther,
      reason,
      outTime,
      expectedReturn,
      signature,
      employeeSignature,
      date,
    } = req.body;

    if (!purpose || !reason || !outTime) {
      return res.status(400).json({
        success: false,
        message: 'Purpose, reason, and outTime are required for a gate pass.',
      });
    }

    // Strict 15-minute enforcement for PERSONAL_WORK
    let finalExpectedReturn = expectedReturn;
    if (purpose === 'PERSONAL_WORK') {
      try {
        const outParts = String(outTime).split(':').map(Number);
        const outMin = (outParts[0] || 0) * 60 + (outParts[1] || 0);
        // Strictly lock to outTime + 15 mins
        const retMin = (outMin + 15) % (24 * 60);
        const rh = String(Math.floor(retMin / 60)).padStart(2, '0');
        const rm = String(retMin % 60).padStart(2, '0');
        finalExpectedReturn = `${rh}:${rm}`;
      } catch (_) {
        finalExpectedReturn = expectedReturn;
      }
    } else if (!finalExpectedReturn) {
      return res.status(400).json({
        success: false,
        message: 'Expected return time is required.',
      });
    }

    const finalSign = signature || employeeSignature || staff.name || null;
    const passNumber = await generateNextGatePassNumber();
    const passDate = date || new Date().toISOString().slice(0, 10);
    const dept = department || staff.department || 'Other';

    const [result] = await pool.query(
      `INSERT INTO gate_passes (
        pass_number, employee_id, employee_code, employee_name, department,
        date, purpose, purpose_other, reason, out_time, expected_return,
        employee_signature, approval_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      [
        passNumber,
        callerId,
        staff.employeeCode,
        staff.name,
        dept,
        passDate,
        purpose,
        purposeOther || null,
        reason,
        outTime,
        finalExpectedReturn,
        finalSign,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Gate pass requested successfully.',
      data: formatGatePass({
        id: result.insertId,
        pass_number: passNumber,
        employee_id: callerId,
        employee_code: staff.employeeCode,
        employee_name: staff.name,
        department: dept,
        date: passDate,
        purpose,
        purpose_other: purposeOther || '',
        reason,
        out_time: outTime,
        expected_return: finalExpectedReturn,
        employee_signature: finalSign,
        approval_status: 'PENDING',
      }),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. GET /gate-passes/my
 * View caller's own gate passes
 */
async function getMyGatePasses(req, res, next) {
  try {
    const callerId = req.staff?.id;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { status, date } = req.query;
    let where = ['employee_id = ?'];
    let params = [callerId];

    if (status && status !== 'ALL') {
      where.push('approval_status = ?');
      params.push(status);
    }
    if (date) {
      where.push('date = ?');
      params.push(date);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM gate_passes ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT * FROM gate_passes ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.status(200).json({
      success: true,
      data: rows.map(formatGatePass),
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
 * 3. GET /gate-passes
 * List all gate passes (for HR, GM, TL, Admin, or security check-in)
 */
async function getGatePasses(req, res, next) {
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
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage') || perms.includes('gatepass_manage');
    const isGM = isHR || roleUpper === 'GENERAL_MANAGER' || perms.includes('leaves_gm') || perms.includes('gatepass_approve');
    const isLead = !isGM && (
      leadTeamIds.size > 0 ||
      ['LEAD', 'TEAM_LEAD'].includes(roleUpper) ||
      perms.includes('reports_own_team')
    );

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { status, purpose, department, date, q } = req.query;

    let where = ['1=1'];
    let params = [];

    if (isHR || isMD || isGM) {
      // HR/GM/MD can see all gate passes
    } else if (isLead) {
      // Team lead sees teammates' gate passes + own
      if (teamIdList.length > 0) {
        where.push(`(gp.employee_id = ? OR gp.employee_id IN (SELECT id FROM staff_users WHERE team_id IN (${teamIdList.join(',')})))`);
        params.push(callerId);
      } else {
        where.push('gp.employee_id = ?');
        params.push(callerId);
      }
    } else {
      // Normal employee sees only own
      where.push('gp.employee_id = ?');
      params.push(callerId);
    }

    if (status && status !== 'ALL') {
      where.push('gp.approval_status = ?');
      params.push(status);
    }
    if (purpose && purpose !== 'ALL') {
      where.push('gp.purpose = ?');
      params.push(purpose);
    }
    if (department && department !== 'ALL') {
      where.push('gp.department = ?');
      params.push(department);
    }
    if (date) {
      where.push('gp.date = ?');
      params.push(date);
    }
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      where.push('(gp.employee_name LIKE ? OR gp.employee_code LIKE ? OR gp.pass_number LIKE ? OR gp.reason LIKE ?)');
      params.push(term, term, term, term);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM gate_passes gp ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT gp.*, s.phone_number as employeePhone, s.branch_location as branch
       FROM gate_passes gp
       LEFT JOIN staff_users s ON gp.employee_id = s.id
       ${whereSql}
       ORDER BY gp.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Summary counts for quick tiles
    const [countsRows] = await pool.query(
      `SELECT 
        SUM(CASE WHEN gp.approval_status = 'PENDING' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN gp.approval_status = 'APPROVED' THEN 1 ELSE 0 END) as approvedCount,
        SUM(CASE WHEN gp.approval_status = 'OUT' THEN 1 ELSE 0 END) as outCount,
        SUM(CASE WHEN gp.approval_status = 'RETURNED' THEN 1 ELSE 0 END) as returnedCount,
        SUM(CASE WHEN gp.approval_status = 'REJECTED' THEN 1 ELSE 0 END) as rejectedCount
       FROM gate_passes gp ${whereSql}`,
      params
    );

    return res.status(200).json({
      success: true,
      data: rows.map(formatGatePass),
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
 * 4. GET /gate-passes/:id
 */
async function getGatePassById(req, res, next) {
  try {
    const id = req.params.id;
    const [rows] = await pool.query(
      `SELECT gp.*, s.phone_number as employeePhone, s.email as employeeEmail, s.branch_location as branch
       FROM gate_passes gp
       LEFT JOIN staff_users s ON gp.employee_id = s.id
       WHERE gp.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gate pass not found' });
    }

    return res.status(200).json({ success: true, data: formatGatePass(rows[0]) });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. PATCH /gate-passes/:id/approve
 * Approves a gate pass (by TL, GM, HR, or Admin)
 */
async function approveGatePass(req, res, next) {
  try {
    const id = req.params.id;
    const callerId = req.staff?.id;
    const callerName = req.staff?.fullName || req.staff?.name || 'Authorized Signatory';

    const perms = parsePermissions(req.staff?.permissions);
    const roleUpper = (req.staff?.role || '').toUpperCase();

    const canApprove =
      ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR', 'GENERAL_MANAGER', 'LEAD', 'TEAM_LEAD'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('leaves_manage') ||
      perms.includes('leaves_gm') ||
      perms.includes('gatepass_approve') ||
      perms.includes('reports_own_team');

    if (!canApprove) {
      return res.status(403).json({
        success: false,
        message: 'Only Team Leads, General Managers, HR, or Admin can approve gate passes.',
      });
    }

    const [rows] = await pool.query('SELECT * FROM gate_passes WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gate pass not found' });
    }

    const now = new Date();
    await pool.query(
      `UPDATE gate_passes 
       SET approval_status = 'APPROVED',
           approved_by_id = ?,
           approved_by_name = ?,
           approved_at = ?
       WHERE id = ?`,
      [callerId, callerName, now, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Gate pass approved successfully.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. PATCH /gate-passes/:id/reject
 */
async function rejectGatePass(req, res, next) {
  try {
    const id = req.params.id;
    const callerId = req.staff?.id;
    const callerName = req.staff?.fullName || req.staff?.name || 'Approver';
    const remarks = req.body.remarks || 'Rejected';

    const perms = parsePermissions(req.staff?.permissions);
    const roleUpper = (req.staff?.role || '').toUpperCase();

    const canApprove =
      ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR', 'GENERAL_MANAGER', 'LEAD', 'TEAM_LEAD'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('leaves_manage') ||
      perms.includes('leaves_gm') ||
      perms.includes('gatepass_approve') ||
      perms.includes('reports_own_team');

    if (!canApprove) {
      return res.status(403).json({ success: false, message: 'Unauthorized to reject gate pass.' });
    }

    await pool.query(
      `UPDATE gate_passes 
       SET approval_status = 'REJECTED',
           approved_by_id = ?,
           approved_by_name = ?,
           approved_at = NOW(),
           remarks = ?
       WHERE id = ?`,
      [callerId, callerName, remarks, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Gate pass rejected.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. PATCH /gate-passes/:id/return
 * Record employee return time upon arrival
 */
async function recordReturn(req, res, next) {
  try {
    const id = req.params.id;
    const callerId = req.staff?.id;
    const callerName = req.staff?.fullName || req.staff?.name || 'Admin / Security';
    const { actualReturnTime, remarks } = req.body;

    const returnTime = actualReturnTime || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const [rows] = await pool.query('SELECT * FROM gate_passes WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gate pass not found' });
    }

    await pool.query(
      `UPDATE gate_passes 
       SET actual_return_time = ?,
           return_recorded_at = NOW(),
           return_recorded_by = ?,
           return_recorded_name = ?,
           remarks = COALESCE(?, remarks),
           approval_status = 'RETURNED'
       WHERE id = ?`,
      [returnTime, callerId, callerName, remarks || null, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Return recorded successfully.',
      data: {
        id,
        actualReturnTime: returnTime,
        status: 'RETURNED',
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  applyGatePass,
  getMyGatePasses,
  getGatePasses,
  getGatePassById,
  approveGatePass,
  rejectGatePass,
  recordReturn,
};
