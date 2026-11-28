const { pool } = require('../config/db');
const { getManagedTeamIds } = require('../utils/teamScope');

let tableEnsured = false;

async function ensureFollowupsTable() {
  if (tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`crm_followups\` (
        \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
        \`report_id\` VARCHAR(64) NULL,
        \`customer_phone\` VARCHAR(30) NOT NULL,
        \`customer_name\` VARCHAR(150) NULL,
        \`due_date\` DATE NOT NULL,
        \`due_time\` TIME NULL,
        \`followup_type\` ENUM('PHONE_CALL', 'WHATSAPP', 'OFFICE_MEETING', 'SITE_VISIT') NOT NULL,
        \`agenda_notes\` TEXT NULL,
        \`opportunity_name\` VARCHAR(255) NULL,
        \`status\` ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
        \`completed_at\` DATETIME NULL,
        \`completed_by_staff_id\` INT NULL,
        \`outcome\` VARCHAR(255) NULL,
        \`call_status\` VARCHAR(100) NULL,
        \`notes\` TEXT NULL,
        \`original_due_date\` DATE NULL,
        \`original_due_time\` TIME NULL,
        \`reschedule_count\` INT NOT NULL DEFAULT 0,
        \`cancelled_reason\` TEXT NULL,
        \`staff_id\` INT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_followup_staff_status\` (\`staff_id\`, \`status\`),
        INDEX \`idx_followup_due_date\` (\`due_date\`, \`status\`),
        INDEX \`idx_followup_customer_phone\` (\`customer_phone\`),
        UNIQUE KEY \`uq_followup_staff_customer_datetime\` (\`staff_id\`, \`customer_phone\`, \`due_date\`, \`due_time\`, \`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    tableEnsured = true;
  } catch (err) {
    console.error('ensureFollowupsTable warning:', err.message);
  }
}

/**
 * Normalize phone number: keep only digits and return last 10 digits
 */
function normalizePhone(phone) {
  if (!phone) return '';
  const digitsOnly = String(phone).replace(/[^0-9]/g, '');
  return digitsOnly.slice(-10);
}

/**
 * Parse and validate date (YYYY-MM-DD)
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse and validate time (HH:MM)
 */
function parseTime(timeStr) {
  if (!timeStr) return null;
  const t = String(timeStr).trim();
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(t)) return t;
  return null;
}

/**
 * Check if due date is in the past
 */
function isDateInPast(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d);
  return due < today;
}

/**
 * 3. POST /followups
 * Create a new follow-up
 */
async function createFollowup(req, res, next) {
  try {
    await ensureFollowupsTable();

    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const {
      reportId,
      customerPhone,
      customerName,
      dueDate,
      dueTime,
      followupType,
      agendaNotes,
      opportunityName
    } = req.body;

    // Validation: customer phone is required
    if (!customerPhone) {
      return res.status(400).json({ success: false, message: 'Customer phone number is required.' });
    }

    const normalizedPhone = normalizePhone(customerPhone);
    if (normalizedPhone.length < 10) {
      return res.status(400).json({ success: false, message: 'Customer phone must be at least 10 digits.' });
    }

    // Validation: due date is required
    if (!dueDate) {
      return res.status(400).json({ success: false, message: 'Due date is required.' });
    }

    const parsedDueDate = parseDate(dueDate);
    if (!parsedDueDate) {
      return res.status(400).json({ success: false, message: 'Invalid due date format. Use YYYY-MM-DD.' });
    }

    // Validation: check if due date is in the past
    if (isDateInPast(dueDate)) {
      return res.status(400).json({ success: false, message: 'Due date cannot be in the past.' });
    }

    // Validation: followupType is required and must be one of the allowed values
    const allowedTypes = ['PHONE_CALL', 'WHATSAPP', 'OFFICE_MEETING', 'SITE_VISIT'];
    if (!followupType || !allowedTypes.includes(followupType.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Invalid followup type. Must be PHONE_CALL, WHATSAPP, OFFICE_MEETING, or SITE_VISIT.' });
    }

    const finalFollowupType = followupType.toUpperCase();

    // For PHONE_CALL and WHATSAPP, dueTime is required
    if ((finalFollowupType === 'PHONE_CALL' || finalFollowupType === 'WHATSAPP') && !dueTime) {
      return res.status(400).json({ success: false, message: 'Due time is required for PHONE_CALL and WHATSAPP follow-ups.' });
    }

    const parsedDueTime = parseTime(dueTime);

    // Validation: customer name is recommended
    const finalCustomerName = customerName ? String(customerName).trim().slice(0, 150) : null;

    // Check for duplicate PENDING follow-up for same customer, employee, date and time
    const [existing] = await pool.query(
      `SELECT id FROM crm_followups 
       WHERE staff_id = ? AND customer_phone = ? AND due_date = ? AND due_time = ? AND status = 'PENDING' 
       LIMIT 1`,
      [staffId, normalizedPhone, parsedDueDate, parsedDueTime || null]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'A pending follow-up already exists for this customer at this date and time.' });
    }

    // Insert the follow-up
    const [result] = await pool.query(
      `INSERT INTO crm_followups 
       (report_id, customer_phone, customer_name, due_date, due_time, followup_type, agenda_notes, opportunity_name, staff_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reportId ? String(reportId).slice(0, 64) : null,
        normalizedPhone,
        finalCustomerName,
        parsedDueDate,
        parsedDueTime,
        finalFollowupType,
        agendaNotes ? String(agendaNotes).trim() : null,
        opportunityName ? String(opportunityName).trim().slice(0, 255) : null,
        staffId
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Follow-up created successfully.',
      data: {
        id: String(result.insertId),
        reportId: reportId ? String(reportId) : null,
        customerPhone: normalizedPhone,
        customerName: finalCustomerName,
        dueDate: parsedDueDate,
        dueTime: parsedDueTime,
        followupType: finalFollowupType,
        agendaNotes: agendaNotes || null,
        opportunityName: opportunityName || null,
        status: 'PENDING',
        staffId: String(staffId),
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. GET /followups
 * Get follow-ups with filters and pagination
 * Query params: status, dueBefore, employeeId, customerPhone, page, limit
 */
async function getFollowups(req, res, next) {
  try {
    await ensureFollowupsTable();

    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const roleUpper = (req.staff?.role || '').toUpperCase();
    const perms = Array.isArray(req.staff?.permissions)
      ? req.staff.permissions
      : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('followups_all') ||
      perms.includes('reports_all');

    const managedTeamIds = await getManagedTeamIds(callerId, req.staff);
    const isLead = !isMD && ['LEAD', 'TEAM_LEAD'].includes(roleUpper);

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const {
      status,
      dueBefore,
      employeeId,
      customerPhone
    } = req.query;

    let whereConditions = ['1=1'];
    let params = [];

    // Role scoping
    if (isMD) {
      // MD sees all
      if (employeeId) {
        whereConditions.push('f.staff_id = ?');
        params.push(employeeId);
      }
    } else if (isLead || managedTeamIds.length > 0) {
      // Team leads see their team + self
      if (employeeId) {
        whereConditions.push('f.staff_id = ?');
        params.push(employeeId);
      } else {
        whereConditions.push('(f.staff_id = ? OR f.staff_id IN (SELECT id FROM staff_users WHERE team_id IN (?)))');
        params.push(callerId, managedTeamIds);
      }
    } else {
      // Single employee sees only their own
      whereConditions.push('f.staff_id = ?');
      params.push(callerId);
    }

    // Status filter (PENDING, COMPLETED, CANCELLED)
    if (status) {
      const validStatus = ['PENDING', 'COMPLETED', 'CANCELLED'];
      if (validStatus.includes(status.toUpperCase())) {
        whereConditions.push('f.status = ?');
        params.push(status.toUpperCase());
      }
    }

    // Due before filter (YYYY-MM-DD)
    if (dueBefore) {
      const parsedDueBefore = parseDate(dueBefore);
      if (parsedDueBefore) {
        whereConditions.push('f.due_date <= ?');
        params.push(parsedDueBefore);
      }
    }

    // Customer phone filter (last 10 digits)
    if (customerPhone) {
      const normalizedPhone = normalizePhone(customerPhone);
      if (normalizedPhone.length >= 10) {
        whereConditions.push('f.customer_phone LIKE ?');
        params.push(`%${normalizedPhone.slice(-10)}`);
      }
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM crm_followups f ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Data query
    const [rows] = await pool.query(
      `SELECT
         f.id,
         f.report_id as reportId,
         f.customer_phone as customerPhone,
         f.customer_name as customerName,
         f.due_date as dueDate,
         f.due_time as dueTime,
         f.followup_type as followupType,
         f.agenda_notes as agendaNotes,
         f.opportunity_name as opportunityName,
         f.status,
         f.completed_at as completedAt,
         f.outcome,
         f.call_status as callStatus,
         f.notes,
         f.original_due_date as originalDueDate,
         f.original_due_time as originalDueTime,
         f.reschedule_count as rescheduleCount,
         f.cancelled_reason as cancelledReason,
         f.staff_id as staffId,
         s.employee_id as staffEmployeeId,
         s.full_name as staffName,
         s.branch_location as staffBranch,
         f.created_at,
         f.updated_at
       FROM crm_followups f
       LEFT JOIN staff_users s ON f.staff_id = s.id
       ${whereClause}
       ORDER BY f.due_date ASC, f.due_time ASC, f.created_at ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // If status filter is PENDING, also count pending follow-ups for bell notification
    let pendingCount = 0;
    if (!status || status.toUpperCase() === 'PENDING') {
      const [pendingResult] = await pool.query(
        `SELECT COUNT(*) as cnt FROM crm_followups f ${whereClause.replace('f.status = ?', 'f.status = ?').replace('f.status = ?', '')}`,
        // Rebuild for PENDING only
        isMD && !employeeId ? [] :
        isLead || managedTeamIds.length > 0 ? [callerId, ...managedTeamIds] :
        [callerId]
      );
      // Simpler query for pending count
      const pendingWhere = [...whereConditions];
      if (isMD) {
        if (employeeId) {
          pendingWhere[pendingWhere.length - 1] = 'f.staff_id = ?';
        }
      } else if (isLead || managedTeamIds.length > 0) {
        pendingWhere[pendingWhere.length - 1] = '(f.staff_id = ? OR f.staff_id IN (SELECT id FROM staff_users WHERE team_id IN (?)))';
      } else {
        pendingWhere[pendingWhere.length - 1] = 'f.staff_id = ?';
      }
      const [pendingCountResult] = await pool.query(
        `SELECT COUNT(*) as cnt FROM crm_followups f WHERE ${pendingWhere.join(' AND ')} AND f.status = 'PENDING'`,
        params
      );
      pendingCount = Number(pendingCountResult[0]?.cnt || 0);
    }

    return res.status(200).json({
      success: true,
      data: rows.map(r => ({
        id: String(r.id),
        reportId: r.reportId || null,
        customerPhone: r.customerPhone,
        customerName: r.customerName || null,
        dueDate: r.dueDate,
        dueTime: r.dueTime,
        followupType: r.followupType,
        agendaNotes: r.agendaNotes || null,
        opportunityName: r.opportunityName || null,
        status: r.status,
        completedAt: r.completedAt || null,
        outcome: r.outcome || null,
        callStatus: r.callStatus || null,
        notes: r.notes || null,
        originalDueDate: r.originalDueDate || null,
        originalDueTime: r.originalDueTime || null,
        rescheduleCount: Number(r.rescheduleCount || 0),
        cancelledReason: r.cancelledReason || null,
        staffId: String(r.staffId),
        staffEmployeeId: r.staffEmployeeId || null,
        staffName: r.staffName || null,
        staffBranch: r.staffBranch || null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      meta: {
        page,
        limit,
        total,
        pendingCount: pendingCount > 0 ? pendingCount : undefined
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. PATCH /followups/:id/complete
 * Mark a follow-up as completed
 */
async function completeFollowup(req, res, next) {
  try {
    await ensureFollowupsTable();

    const followupId = req.params.id;
    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { outcome, callStatus, notes } = req.body;

    // Get the follow-up
    const [followup] = await pool.query(
      `SELECT id, status, staff_id FROM crm_followups WHERE id = ? LIMIT 1`,
      [followupId]
    );

    if (followup.length === 0) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }

    const f = followup[0];

    // Check ownership/scoping
    const roleUpper = (req.staff?.role || '').toUpperCase();
    const perms = Array.isArray(req.staff?.permissions)
      ? req.staff.permissions
      : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('followups_all') ||
      perms.includes('reports_all');

    const managedTeamIds = await getManagedTeamIds(staffId, req.staff);
    const isLead = !isMD && ['LEAD', 'TEAM_LEAD'].includes(roleUpper);

    let canAccess = false;
    if (String(f.staff_id) === String(staffId)) {
      canAccess = true;
    } else if (isMD) {
      canAccess = true;
    } else if (isLead || managedTeamIds.length > 0) {
      // Team leads can complete team members' follow-ups
      canAccess = managedTeamIds.includes(Number(f.staff_id)) || String(f.staff_id) === String(staffId);
    }

    if (!canAccess) {
      return res.status(403).json({ success: false, message: 'Not authorized to complete this follow-up.' });
    }

    // Check status: only PENDING can be completed
    if (f.status !== 'PENDING') {
      return res.status(409).json({ success: false, message: 'Cannot complete a follow-up that is not PENDING.' });
    }

    // Update
    const nowSql = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await pool.query(
      `UPDATE crm_followups 
       SET status = 'COMPLETED', completed_at = ?, completed_by_staff_id = ?, outcome = ?, call_status = ?, notes = ?
       WHERE id = ?`,
      [nowSql, staffId, outcome || null, callStatus || null, notes || null, followupId]
    );

    return res.status(200).json({
      success: true,
      message: 'Follow-up marked as completed.',
      data: {
        id: String(followupId),
        status: 'COMPLETED',
        completedAt: nowSql,
        completedByStaffId: String(staffId),
        outcome: outcome || null,
        callStatus: callStatus || null,
        notes: notes || null
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. PATCH /followups/:id/reschedule
 * Reschedule a pending follow-up
 */
async function rescheduleFollowup(req, res, next) {
  try {
    await ensureFollowupsTable();

    const followupId = req.params.id;
    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { dueDate, dueTime, reason } = req.body;

    // Validation: due date is required
    if (!dueDate) {
      return res.status(400).json({ success: false, message: 'New due date is required.' });
    }

    const parsedDueDate = parseDate(dueDate);
    if (!parsedDueDate) {
      return res.status(400).json({ success: false, message: 'Invalid due date format. Use YYYY-MM-DD.' });
    }

    // Validation: check if due date is in the past
    if (isDateInPast(dueDate)) {
      return res.status(400).json({ success: false, message: 'New due date cannot be in the past.' });
    }

    const parsedDueTime = parseTime(dueTime);

    // Get the follow-up
    const [followup] = await pool.query(
      `SELECT id, status, staff_id, customer_phone, due_date, due_time FROM crm_followups WHERE id = ? LIMIT 1`,
      [followupId]
    );

    if (followup.length === 0) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }

    const f = followup[0];

    // Check ownership/scoping
    const roleUpper = (req.staff?.role || '').toUpperCase();
    const perms = Array.isArray(req.staff?.permissions)
      ? req.staff.permissions
      : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('followups_all') ||
      perms.includes('reports_all');

    const managedTeamIds = await getManagedTeamIds(staffId, req.staff);
    const isLead = !isMD && ['LEAD', 'TEAM_LEAD'].includes(roleUpper);

    let canAccess = false;
    if (String(f.staff_id) === String(staffId)) {
      canAccess = true;
    } else if (isMD) {
      canAccess = true;
    } else if (isLead || managedTeamIds.length > 0) {
      canAccess = managedTeamIds.includes(Number(f.staff_id)) || String(f.staff_id) === String(staffId);
    }

    if (!canAccess) {
      return res.status(403).json({ success: false, message: 'Not authorized to reschedule this follow-up.' });
    }

    // Check status: only PENDING can be rescheduled
    if (f.status !== 'PENDING') {
      return res.status(409).json({ success: false, message: 'Cannot reschedule a follow-up that is not PENDING.' });
    }

    // Check for duplicate PENDING follow-up for same customer, employee, new date and time
    const [existing] = await pool.query(
      `SELECT id FROM crm_followups 
       WHERE staff_id = ? AND customer_phone = ? AND due_date = ? AND due_time = ? AND status = 'PENDING' AND id != ? 
       LIMIT 1`,
      [f.staff_id, f.customer_phone, parsedDueDate, parsedDueTime || null, followupId]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'A pending follow-up already exists for this customer at the new date and time.' });
    }

    // Update with original_due_date and original_due_time preserved, increase reschedule_count
    const nowSql = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await pool.query(
      `UPDATE crm_followups 
       SET 
         original_due_date = due_date,
         original_due_time = due_time,
         due_date = ?,
         due_time = ?,
         reschedule_count = reschedule_count + 1,
         updated_at = ?
       WHERE id = ?`,
      [parsedDueDate, parsedDueTime, nowSql, followupId]
    );

    return res.status(200).json({
      success: true,
      message: 'Follow-up rescheduled successfully.',
      data: {
        id: String(followupId),
        originalDueDate: f.due_date,
        originalDueTime: f.due_time,
        newDueDate: parsedDueDate,
        newDueTime: parsedDueTime,
        rescheduleCount: 1 // Will be incremented in DB
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. PATCH /followups/:id/cancel
 * Cancel a follow-up
 */
async function cancelFollowup(req, res, next) {
  try {
    await ensureFollowupsTable();

    const followupId = req.params.id;
    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Cancellation reason is required.' });
    }

    // Get the follow-up
    const [followup] = await pool.query(
      `SELECT id, status, staff_id FROM crm_followups WHERE id = ? LIMIT 1`,
      [followupId]
    );

    if (followup.length === 0) {
      return res.status(404).json({ success: false, message: 'Follow-up not found.' });
    }

    const f = followup[0];

    // Check ownership/scoping
    const roleUpper = (req.staff?.role || '').toUpperCase();
    const perms = Array.isArray(req.staff?.permissions)
      ? req.staff.permissions
      : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);

    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('followups_all') ||
      perms.includes('reports_all');

    const managedTeamIds = await getManagedTeamIds(staffId, req.staff);
    const isLead = !isMD && ['LEAD', 'TEAM_LEAD'].includes(roleUpper);

    let canAccess = false;
    if (String(f.staff_id) === String(staffId)) {
      canAccess = true;
    } else if (isMD) {
      canAccess = true;
    } else if (isLead || managedTeamIds.length > 0) {
      canAccess = managedTeamIds.includes(Number(f.staff_id)) || String(f.staff_id) === String(staffId);
    }

    if (!canAccess) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this follow-up.' });
    }

    // Check status: only PENDING can be cancelled
    if (f.status !== 'PENDING') {
      return res.status(409).json({ success: false, message: 'Cannot cancel a follow-up that is not PENDING.' });
    }

    // Update
    await pool.query(
      `UPDATE crm_followups 
       SET status = 'CANCELLED', cancelled_reason = ?
       WHERE id = ?`,
      [String(reason).trim().slice(0, 65535), followupId]
    );

    return res.status(200).json({
      success: true,
      message: 'Follow-up cancelled.',
      data: {
        id: String(followupId),
        status: 'CANCELLED',
        cancelledReason: String(reason).trim()
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createFollowup,
  getFollowups,
  completeFollowup,
  rescheduleFollowup,
  cancelFollowup
};
