const { pool } = require('../config/db');

let tableEnsured = false;

async function ensureCallLogsTable() {
  if (tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`staff_call_logs\` (
        \`id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
        \`staff_id\` INT NOT NULL,
        \`employee_id\` VARCHAR(50) NULL,
        \`staff_name\` VARCHAR(150) NULL,
        \`branch_location\` VARCHAR(150) NULL,
        \`phone_number\` VARCHAR(30) NOT NULL,
        \`contact_name\` VARCHAR(150) NULL,
        \`call_type\` VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
        \`duration_seconds\` INT NOT NULL DEFAULT 0,
        \`call_timestamp\` DATETIME NOT NULL,
        \`device_call_key\` VARCHAR(160) NOT NULL,
        \`is_added_to_entry\` TINYINT(1) NOT NULL DEFAULT 0,
        \`crm_report_id\` VARCHAR(64) NULL,
        \`synced_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`uq_staff_device_call\` (\`staff_id\`, \`device_call_key\`),
        INDEX \`idx_call_staff_time\` (\`staff_id\`, \`call_timestamp\`),
        INDEX \`idx_call_phone_time\` (\`phone_number\`, \`call_timestamp\`),
        INDEX \`idx_call_type_time\` (\`call_type\`, \`call_timestamp\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    tableEnsured = true;
  } catch (err) {
    console.error('ensureCallLogsTable warning:', err.message);
  }
}

const ALLOWED_TYPES = new Set(['INCOMING', 'OUTGOING', 'MISSED', 'REJECTED', 'BLOCKED', 'UNKNOWN']);

function normalizeCallType(raw) {
  const up = String(raw || 'UNKNOWN').trim().toUpperCase();
  if (ALLOWED_TYPES.has(up)) return up;
  if (up.includes('IN')) return 'INCOMING';
  if (up.includes('OUT')) return 'OUTGOING';
  if (up.includes('MISS')) return 'MISSED';
  if (up.includes('REJ')) return 'REJECTED';
  if (up.includes('BLOCK')) return 'BLOCKED';
  return 'UNKNOWN';
}

function toMySqlDateTime(input) {
  let d;
  if (typeof input === 'number') {
    d = new Date(input);
  } else if (typeof input === 'string' && /^\d+$/.test(input.trim())) {
    d = new Date(parseInt(input.trim(), 10));
  } else if (input) {
    d = new Date(input);
  } else {
    d = new Date();
  }
  if (Number.isNaN(d.getTime())) d = new Date();

  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * POST /call-logs/sync (Authenticated Staff)
 * Body: { logs: [{ phoneNumber, contactName, callType, durationSeconds, callTimestamp, deviceCallKey }] }
 */
async function syncCallLogs(req, res, next) {
  try {
    await ensureCallLogsTable();

    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }

    const incomingLogs = Array.isArray(req.body?.logs) ? req.body.logs : [];
    if (incomingLogs.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No call logs to sync.',
        syncedCount: 0,
        totalReceived: 0,
      });
    }

    // Fetch latest staff details from staff_users
    const [staffRows] = await pool.query(
      'SELECT id, employee_id, full_name, branch_location FROM staff_users WHERE id = ? LIMIT 1',
      [staffId]
    );
    const staffInfo = staffRows[0] || {
      id: staffId,
      employee_id: req.staff.employeeId || null,
      full_name: req.staff.fullName || req.staff.name || 'Staff',
      branch_location: req.staff.branch || '',
    };

    // Cap batch size at 500 per sync request
    const batch = incomingLogs.slice(0, 500);
    const values = [];

    for (const item of batch) {
      const rawPhone = String(item.phoneNumber || item.number || '').trim();
      if (!rawPhone) continue;
      const phone = rawPhone.slice(0, 30);
      const contactName = String(item.contactName || item.name || '').trim().slice(0, 150) || null;
      const callType = normalizeCallType(item.callType || item.type);
      const durationSeconds = Math.max(0, parseInt(item.durationSeconds ?? item.duration ?? 0, 10) || 0);
      const rawTs = item.callTimestamp ?? item.timestamp ?? Date.now();
      const mysqlTs = toMySqlDateTime(rawTs);
      const keySource = item.deviceCallKey || `${phone}_${rawTs}_${callType}`;
      const deviceCallKey = String(keySource).trim().slice(0, 160);

      values.push([
        staffInfo.id,
        staffInfo.employee_id || null,
        staffInfo.full_name || null,
        staffInfo.branch_location || null,
        phone,
        contactName,
        callType,
        durationSeconds,
        mysqlTs,
        deviceCallKey,
      ]);
    }

    if (values.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No valid call logs in batch.',
        syncedCount: 0,
        totalReceived: incomingLogs.length,
      });
    }

    // Bulk upsert
    const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const flatParams = values.flat();

    await pool.query(
      `INSERT INTO staff_call_logs
        (staff_id, employee_id, staff_name, branch_location, phone_number, contact_name, call_type, duration_seconds, call_timestamp, device_call_key)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
        contact_name = COALESCE(NULLIF(VALUES(contact_name), ''), contact_name),
        duration_seconds = GREATEST(duration_seconds, VALUES(duration_seconds)),
        staff_name = COALESCE(VALUES(staff_name), staff_name),
        branch_location = COALESCE(VALUES(branch_location), branch_location)`,
      flatParams
    );

    return res.status(200).json({
      success: true,
      message: `Synced ${values.length} call logs successfully.`,
      syncedCount: values.length,
      totalReceived: incomingLogs.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /call-logs (MD sees all, Lead sees own team + self, Employee sees own)
 * Query: staffId, type (ALL|INCOMING|OUTGOING|MISSED|REJECTED), status (ALL|PENDING|LOGGED), q, from, to, page, limit
 */
async function getCallLogs(req, res, next) {
  try {
    await ensureCallLogsTable();

    const roleUpper = (req.staff?.role || '').toUpperCase();
    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR', 'SALES_HEAD', 'HEAD_MANAGER'].includes(roleUpper);
    const isLead = ['TEAM_LEAD', 'LEAD', 'MANAGER', 'SALES_MANAGER'].includes(roleUpper);
    const callerId = req.staff?.id;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const offset = (page - 1) * limit;

    const { staffId, type, status, q, from, to, mineOnly } = req.query;

    const baseWhere = [];
    const baseParams = [];

    // Role scoping
    if (mineOnly === 'true' || mineOnly === true || (!isMD && !isLead)) {
      baseWhere.push('cl.staff_id = ?');
      baseParams.push(callerId);
    } else if (isLead && !isMD) {
      // Lead sees own call logs + call logs of employees in their team
      const [teamRows] = await pool.query('SELECT id FROM teams WHERE lead_id = ?', [callerId]);
      const teamIds = teamRows.map((t) => t.id);
      if (teamIds.length > 0) {
        baseWhere.push(`(cl.staff_id = ? OR s.team_id IN (${teamIds.map(() => '?').join(',')}))`);
        baseParams.push(callerId, ...teamIds);
      } else {
        baseWhere.push('cl.staff_id = ?');
        baseParams.push(callerId);
      }
      if (staffId && staffId !== 'ALL') {
        baseWhere.push('cl.staff_id = ?');
        baseParams.push(staffId);
      }
    } else if (isMD) {
      if (staffId && staffId !== 'ALL') {
        baseWhere.push('cl.staff_id = ?');
        baseParams.push(staffId);
      }
    }

    if (from) {
      baseWhere.push('DATE(cl.call_timestamp) >= ?');
      baseParams.push(from);
    }
    if (to) {
      baseWhere.push('DATE(cl.call_timestamp) <= ?');
      baseParams.push(to);
    }
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      baseWhere.push('(cl.phone_number LIKE ? OR cl.contact_name LIKE ? OR cl.staff_name LIKE ? OR s.full_name LIKE ?)');
      baseParams.push(term, term, term, term);
    }

    const baseWhereSql = baseWhere.length > 0 ? `WHERE ${baseWhere.join(' AND ')}` : '';

    // Summary counts (ignoring type/status filter so tabs always show accurate counts)
    const [summaryRows] = await pool.query(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN cl.call_type = 'INCOMING' THEN 1 ELSE 0 END) as incoming,
         SUM(CASE WHEN cl.call_type = 'OUTGOING' THEN 1 ELSE 0 END) as outgoing,
         SUM(CASE WHEN cl.call_type = 'MISSED' THEN 1 ELSE 0 END) as missed,
         SUM(CASE WHEN cl.call_type = 'REJECTED' THEN 1 ELSE 0 END) as rejected,
         SUM(CASE WHEN cl.is_added_to_entry = 1 THEN 1 ELSE 0 END) as logged,
         SUM(CASE WHEN cl.is_added_to_entry = 0 THEN 1 ELSE 0 END) as pending
       FROM staff_call_logs cl
       LEFT JOIN staff_users s ON cl.staff_id = s.id
       ${baseWhereSql}`,
      baseParams
    );

    const summary = {
      total: Number(summaryRows[0]?.total || 0),
      incoming: Number(summaryRows[0]?.incoming || 0),
      outgoing: Number(summaryRows[0]?.outgoing || 0),
      missed: Number(summaryRows[0]?.missed || 0),
      rejected: Number(summaryRows[0]?.rejected || 0),
      logged: Number(summaryRows[0]?.logged || 0),
      pending: Number(summaryRows[0]?.pending || 0),
    };

    // Apply type and status filters for paginated rows
    const listWhere = [...baseWhere];
    const listParams = [...baseParams];

    if (type && type.toUpperCase() !== 'ALL') {
      listWhere.push('cl.call_type = ?');
      listParams.push(type.toUpperCase());
    }
    if (status && status.toUpperCase() === 'LOGGED') {
      listWhere.push('cl.is_added_to_entry = 1');
    } else if (status && status.toUpperCase() === 'PENDING') {
      listWhere.push('cl.is_added_to_entry = 0');
    }

    const listWhereSql = listWhere.length > 0 ? `WHERE ${listWhere.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total
       FROM staff_call_logs cl
       LEFT JOIN staff_users s ON cl.staff_id = s.id
       ${listWhereSql}`,
      listParams
    );
    const filteredTotal = Number(countRows[0]?.total || 0);

    const [rows] = await pool.query(
      `SELECT
         cl.id,
         cl.staff_id as staffId,
         COALESCE(s.employee_id, cl.employee_id) as employeeId,
         COALESCE(s.full_name, cl.staff_name) as staffName,
         COALESCE(s.branch_location, cl.branch_location) as branch,
         s.department as department,
         s.designation as designation,
         cl.phone_number as phoneNumber,
         cl.contact_name as contactName,
         cl.call_type as callType,
         cl.duration_seconds as durationSeconds,
         cl.call_timestamp as callTimestamp,
         cl.is_added_to_entry as isAddedToEntry,
         cl.crm_report_id as crmReportId,
         cl.synced_at as syncedAt
       FROM staff_call_logs cl
       LEFT JOIN staff_users s ON cl.staff_id = s.id
       ${listWhereSql}
       ORDER BY cl.call_timestamp DESC, cl.id DESC
       LIMIT ? OFFSET ?`,
      [...listParams, limit, offset]
    );

    // Distinct staff list for CRM filter dropdown
    let staffList = [];
    if (isMD || isLead) {
      const staffFilterWhere = isMD
        ? ''
        : `WHERE cl.staff_id = ${pool.escape(callerId)} OR s.team_id IN (SELECT id FROM teams WHERE lead_id = ${pool.escape(callerId)})`;
      const [sRows] = await pool.query(
        `SELECT DISTINCT cl.staff_id as id, COALESCE(s.full_name, cl.staff_name) as name, COALESCE(s.employee_id, cl.employee_id) as employeeId
         FROM staff_call_logs cl
         LEFT JOIN staff_users s ON cl.staff_id = s.id
         ${staffFilterWhere}
         ORDER BY name ASC`
      );
      staffList = sRows.map((r) => ({ id: String(r.id), name: r.name || 'Staff', employeeId: r.employeeId || '' }));
    }

    return res.status(200).json({
      success: true,
      summary,
      staffList,
      pagination: {
        total: filteredTotal,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
      },
      data: rows.map((r) => ({
        id: String(r.id),
        staffId: String(r.staffId),
        employeeId: r.employeeId || '',
        staffName: r.staffName || 'Staff',
        branch: r.branch || '',
        department: r.department || '',
        designation: r.designation || '',
        phoneNumber: r.phoneNumber,
        contactName: r.contactName || '',
        callType: r.callType || 'UNKNOWN',
        durationSeconds: Number(r.durationSeconds || 0),
        callTimestamp: r.callTimestamp,
        isAddedToEntry: Boolean(r.isAddedToEntry),
        crmReportId: r.crmReportId || null,
        syncedAt: r.syncedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /call-logs/:id/mark-logged
 * Marks a synced phone call log as converted to a CRM Call Entry.
 * Body: { reportId }
 */
async function markCallLogLogged(req, res, next) {
  try {
    await ensureCallLogsTable();

    const id = req.params.id;
    const reportId = req.body?.reportId ? String(req.body.reportId).slice(0, 64) : null;

    const [result] = await pool.query(
      'UPDATE staff_call_logs SET is_added_to_entry = 1, crm_report_id = COALESCE(?, crm_report_id) WHERE id = ?',
      [reportId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Call log not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Call log marked as added to CRM Call Entry.',
      data: { id: String(id), isAddedToEntry: true, crmReportId: reportId },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  syncCallLogs,
  getCallLogs,
  markCallLogLogged,
};
