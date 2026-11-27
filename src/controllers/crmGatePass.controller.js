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

function formatDateToYmd(d) {
  if (!d) return '';
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return s;
}

/**
 * Helper to get currently active delegations for a staff member.
 */
async function getActiveDelegations(staffId) {
  if (!staffId) return [];
  try {
    const today = new Date().toISOString().slice(0, 10);
    // 1. Delegations from approved leave applications
    const [leaveRows] = await pool.query(
      `SELECT la.id as leave_id, la.employee_id as delegator_id, la.employee_name as delegator_name,
              s.role as delegator_role, s.designation as delegator_designation,
              s.permissions as delegator_permissions, s.managed_teams as delegator_managed_teams,
              s.team_id as delegator_team_id
       FROM leave_applications la
       JOIN staff_users s ON la.employee_id = s.id
       WHERE la.acting_representative_id = ?
         AND la.status = 'APPROVED'
         AND ? BETWEEN la.period_from AND la.period_to`,
      [staffId, today]
    );

    // 2. Direct delegations configured on staff profile (+1 person delegation)
    const [directRows] = await pool.query(
      `SELECT NULL as leave_id, s.id as delegator_id, s.full_name as delegator_name,
              s.role as delegator_role, s.designation as delegator_designation,
              s.permissions as delegator_permissions, s.managed_teams as delegator_managed_teams,
              s.team_id as delegator_team_id
       FROM staff_users s
       WHERE s.acting_delegate_id = ?
         AND (s.acting_delegate_until IS NULL OR s.acting_delegate_until >= CURDATE())`,
      [staffId]
    );

    const combined = [...leaveRows, ...directRows];
    const seen = new Set();
    const result = [];
    for (const r of combined) {
      if (!seen.has(r.delegator_id)) {
        seen.add(r.delegator_id);
        let managedTeams = [];
        try {
          if (r.delegator_managed_teams) {
            managedTeams = typeof r.delegator_managed_teams === 'string'
              ? JSON.parse(r.delegator_managed_teams)
              : r.delegator_managed_teams;
          }
        } catch (_) {}
        result.push({
          leaveId: r.leave_id,
          delegatorId: r.delegator_id,
          delegatorName: r.delegator_name,
          delegatorRole: r.delegator_role,
          delegatorDesignation: r.delegator_designation,
          delegatorPermissions: parsePermissions(r.delegator_permissions),
          delegatorManagedTeams: managedTeams,
          delegatorTeamId: r.delegator_team_id,
        });
      }
    }
    return result;
  } catch (_) {
    return [];
  }
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
    date: formatDateToYmd(gp.date),
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
 * Generate unique daily Gate Pass Number: DDMMYYYY001, DDMMYYYY002...
 * Daily sequence resetting to 001 every day.
 */
async function generateNextGatePassNumber() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  const datePrefix = `${dd}${mm}${yyyy}`; // e.g. 27112026

  const [rows] = await pool.query(
    `SELECT pass_number FROM gate_passes 
     WHERE pass_number LIKE ? 
     ORDER BY pass_number DESC LIMIT 1`,
    [`${datePrefix}%`]
  );

  let seq = 1;
  if (rows.length > 0 && rows[0].pass_number) {
    const lastNumStr = rows[0].pass_number.slice(datePrefix.length);
    const lastNum = parseInt(lastNumStr, 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }

  return `${datePrefix}${String(seq).padStart(3, '0')}`;
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

    const { status, date, month } = req.query;
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
    if (month && month !== 'ALL') {
      where.push("DATE_FORMAT(date, '%Y-%m') = ?");
      params.push(month);
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
    const activeDelegations = await getActiveDelegations(callerId);
    let actingHR = false;
    let actingGM = false;
    let actingLead = false;

    activeDelegations.forEach((d) => {
      const dRole = (d.delegatorRole || '').toUpperCase();
      const dDesig = (d.delegatorDesignation || '').toLowerCase();
      const dPerms = d.delegatorPermissions || [];

      if (['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(dRole) || dPerms.includes('*') || dPerms.includes('leaves_manage') || dPerms.includes('gatepass_manage')) {
        actingHR = true;
      }
      if (actingHR || dRole === 'GENERAL_MANAGER' || dDesig.includes('general manager') || dDesig.includes('gm') || dPerms.includes('leaves_gm') || dPerms.includes('gatepass_approve')) {
        actingGM = true;
      }
      if (['LEAD', 'TEAM_LEAD'].includes(dRole) || dPerms.includes('reports_own_team') || (d.delegatorManagedTeams && d.delegatorManagedTeams.length > 0)) {
        actingLead = true;
      }
      if (Array.isArray(d.delegatorManagedTeams)) {
        d.delegatorManagedTeams.forEach((tid) => leadTeamIds.add(Number(tid)));
      }
      if (d.delegatorTeamId) {
        leadTeamIds.add(Number(d.delegatorTeamId));
      }
    });

    const teamIdList = [...leadTeamIds].filter(Boolean);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = isMD || roleUpper === 'HR' || perms.includes('leaves_manage') || perms.includes('gatepass_manage') || actingHR;
    const isGM = isHR || roleUpper === 'GENERAL_MANAGER' || perms.includes('leaves_gm') || perms.includes('gatepass_approve') || actingGM;
    const isLead = !isGM && (
      leadTeamIds.size > 0 ||
      ['LEAD', 'TEAM_LEAD'].includes(roleUpper) ||
      perms.includes('reports_own_team') ||
      actingLead
    );

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { status, purpose, department, date, month, q } = req.query;

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
    if (month && month !== 'ALL') {
      where.push("DATE_FORMAT(gp.date, '%Y-%m') = ?");
      params.push(month);
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

    const activeDelegations = await getActiveDelegations(callerId);
    let actingHR = false;
    let delegatorName = null;
    activeDelegations.forEach((d) => {
      const dRole = (d.delegatorRole || '').toUpperCase();
      const dPerms = d.delegatorPermissions || [];
      if (['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(dRole) || dPerms.includes('*') || dPerms.includes('leaves_manage') || dPerms.includes('gatepass_approve')) {
        actingHR = true;
        if (!delegatorName) delegatorName = d.delegatorName;
      }
    });

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = roleUpper === 'HR' || perms.includes('leaves_manage') || perms.includes('gatepass_approve') || actingHR || isMD;

    if (!isHR) {
      return res.status(403).json({
        success: false,
        message: 'Gate pass must be approved by HR or Management only.',
      });
    }

    const [rows] = await pool.query('SELECT * FROM gate_passes WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gate pass not found' });
    }

    const recordedName = delegatorName ? `${callerName} (Acting for ${delegatorName})` : callerName;
    const now = new Date();
    await pool.query(
      `UPDATE gate_passes 
       SET approval_status = 'APPROVED',
           approved_by_id = ?,
           approved_by_name = ?,
           approved_at = ?
       WHERE id = ?`,
      [callerId, recordedName, now, id]
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

    const activeDelegations = await getActiveDelegations(callerId);
    let actingHR = false;
    let delegatorName = null;
    activeDelegations.forEach((d) => {
      const dRole = (d.delegatorRole || '').toUpperCase();
      const dPerms = d.delegatorPermissions || [];
      if (['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(dRole) || dPerms.includes('*') || dPerms.includes('leaves_manage') || dPerms.includes('gatepass_approve')) {
        actingHR = true;
        if (!delegatorName) delegatorName = d.delegatorName;
      }
    });

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD'].includes(roleUpper) || perms.includes('*');
    const isHR = roleUpper === 'HR' || perms.includes('leaves_manage') || perms.includes('gatepass_approve') || actingHR || isMD;

    if (!isHR) {
      return res.status(403).json({ success: false, message: 'Gate pass can only be rejected by HR or Management.' });
    }

    const recordedName = delegatorName ? `${callerName} (Acting for ${delegatorName})` : callerName;

    await pool.query(
      `UPDATE gate_passes 
       SET approval_status = 'REJECTED',
           approved_by_id = ?,
           approved_by_name = ?,
           approved_at = NOW(),
           remarks = ?
       WHERE id = ?`,
      [callerId, recordedName, remarks, id]
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
