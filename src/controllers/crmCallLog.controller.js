const { pool } = require('../config/db');
const { getManagedTeamIds } = require('../utils/teamScope');

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
    try {
      const [col] = await pool.query("SHOW COLUMNS FROM `staff_users` LIKE 'call_log_tracking_since'");
      if (col.length === 0) {
        await pool.query('ALTER TABLE `staff_users` ADD COLUMN `call_log_tracking_since` DATETIME NULL');
      }
    } catch (_) {}
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

function toEpochMs(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && /^\d+$/.test(input.trim())) {
    return parseInt(input.trim(), 10);
  }
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.getTime();
  }
  if (input) {
    const str = String(input).trim();
    // Handle MySQL 'YYYY-MM-DD HH:mm:ss' stored in UTC
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) {
      const parsed = Date.parse(str.replace(' ', 'T') + 'Z');
      if (!Number.isNaN(parsed)) return parsed;
    }
    const parsed = Date.parse(str);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function toMySqlDateTime(input) {
  const ms = toEpochMs(input);
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * GET /call-logs/tracking-status (Authenticated Staff)
 * Returns the staff member's upcoming-only tracking anchor timestamp.
 */
async function getTrackingStatus(req, res, next) {
  try {
    await ensureCallLogsTable();
    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }

    const [rows] = await pool.query(
      'SELECT call_log_tracking_since as trackingSince FROM staff_users WHERE id = ? LIMIT 1',
      [staffId]
    );
    const raw = rows[0]?.trackingSince || null;
    const ms = raw ? toEpochMs(raw) : null;

    return res.status(200).json({
      success: true,
      trackingSince: ms,
      trackingSinceIso: ms ? new Date(ms).toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /call-logs/enable-tracking (Authenticated Staff)
 * Anchors upcoming-only call log tracking from NOW() when employee grants permission.
 * Automatically removes any older pre-tracking call logs for this employee.
 */
async function enableTracking(req, res, next) {
  try {
    await ensureCallLogsTable();
    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }

    const forceReset = Boolean(req.body?.forceReset);

    const [rows] = await pool.query(
      'SELECT call_log_tracking_since as trackingSince FROM staff_users WHERE id = ? LIMIT 1',
      [staffId]
    );
    const existingRaw = rows[0]?.trackingSince || null;

    if (existingRaw && !forceReset) {
      const existingMs = toEpochMs(existingRaw);
      return res.status(200).json({
        success: true,
        newlyEnabled: false,
        trackingSince: existingMs,
        trackingSinceIso: new Date(existingMs).toISOString(),
        message: 'Upcoming-only call log tracking is already active.',
      });
    }

    const nowMs = Date.now();
    const nowSql = toMySqlDateTime(nowMs);

    await pool.query(
      'UPDATE staff_users SET call_log_tracking_since = ? WHERE id = ?',
      [nowSql, staffId]
    );

    // Clean out any old pre-tracking logs for this employee so only upcoming calls are kept
    await pool.query(
      'DELETE FROM staff_call_logs WHERE staff_id = ? AND call_timestamp < ?',
      [staffId, nowSql]
    );

    return res.status(200).json({
      success: true,
      newlyEnabled: true,
      trackingSince: nowMs,
      trackingSinceIso: new Date(nowMs).toISOString(),
      message: 'Call log tracking enabled. Only upcoming calls from now will be stored.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /call-logs/sync (Authenticated Staff)
 * Strictly stores ONLY upcoming calls with callTimestamp >= call_log_tracking_since.
 */
async function syncCallLogs(req, res, next) {
  try {
    await ensureCallLogsTable();

    const staffId = req.staff?.id;
    if (!staffId) {
      return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }

    const incomingLogs = Array.isArray(req.body?.logs) ? req.body.logs : [];

    // Fetch latest staff details + call_log_tracking_since anchor
    const [staffRows] = await pool.query(
      'SELECT id, employee_id, full_name, branch_location, call_log_tracking_since FROM staff_users WHERE id = ? LIMIT 1',
      [staffId]
    );
    const staffInfo = staffRows[0] || {
      id: staffId,
      employee_id: req.staff.employeeId || null,
      full_name: req.staff.fullName || req.staff.name || 'Staff',
      branch_location: req.staff.branch || '',
      call_log_tracking_since: null,
    };

    // If tracking anchor was never set yet, initialize it to NOW() and purge old pre-tracking logs
    let trackingSinceMs;
    if (!staffInfo.call_log_tracking_since) {
      trackingSinceMs = Date.now();
      const nowSql = toMySqlDateTime(trackingSinceMs);
      await pool.query(
        'UPDATE staff_users SET call_log_tracking_since = ? WHERE id = ?',
        [nowSql, staffId]
      );
      await pool.query(
        'DELETE FROM staff_call_logs WHERE staff_id = ? AND call_timestamp < ?',
        [staffId, nowSql]
      );
      return res.status(200).json({
        success: true,
        message: 'Upcoming-only call tracking initialized. Only new calls from now will be saved.',
        syncedCount: 0,
        skippedOldCount: incomingLogs.length,
        totalReceived: incomingLogs.length,
        trackingSince: trackingSinceMs,
      });
    } else {
      trackingSinceMs = toEpochMs(staffInfo.call_log_tracking_since);
    }

    if (incomingLogs.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No call logs to sync.',
        syncedCount: 0,
        skippedOldCount: 0,
        totalReceived: 0,
        trackingSince: trackingSinceMs,
      });
    }

    // Cap batch size at 500 per sync request and strictly ignore calls older than trackingSinceMs
    const batch = incomingLogs.slice(0, 500);
    const values = [];
    let skippedOldCount = 0;

    for (const item of batch) {
      const rawPhone = String(item.phoneNumber || item.number || '').trim();
      if (!rawPhone) continue;

      const rawTs = item.callTimestamp ?? item.timestamp ?? Date.now();
      const callMs = toEpochMs(rawTs);

      // Strictly skip any old call from before tracking was enabled!
      if (callMs < trackingSinceMs) {
        skippedOldCount++;
        continue;
      }

      const phone = rawPhone.slice(0, 30);
      const contactName = String(item.contactName || item.name || '').trim().slice(0, 150) || null;
      const callType = normalizeCallType(item.callType || item.type);
      const durationSeconds = Math.max(0, parseInt(item.durationSeconds ?? item.duration ?? 0, 10) || 0);
      const mysqlTs = toMySqlDateTime(callMs);
      const keySource = item.deviceCallKey || `${phone}_${callMs}_${callType}`;
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
        message: skippedOldCount > 0
          ? `Skipped ${skippedOldCount} older calls before tracking started.`
          : 'No valid upcoming call logs in batch.',
        syncedCount: 0,
        skippedOldCount,
        totalReceived: incomingLogs.length,
        trackingSince: trackingSinceMs,
      });
    }

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
      message: `Synced ${values.length} upcoming call logs successfully.`,
      syncedCount: values.length,
      skippedOldCount,
      totalReceived: incomingLogs.length,
      trackingSince: trackingSinceMs,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /call-logs (MD sees all, Lead sees own team + self, Employee sees own)
 */
async function getCallLogs(req, res, next) {
  try {
    await ensureCallLogsTable();

    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Staff authentication required.' });
    }

    const roleUpper = (req.staff?.role || '').toUpperCase();
    const perms = Array.isArray(req.staff?.permissions)
      ? req.staff.permissions
      : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);
    // Company-wide Call Logs oversight: strictly MD, HR, or explicit all-staff oversight permissions
    const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('call_logs_all') ||
      perms.includes('reports_all') ||
      perms.includes('reports_employee');

    const managedTeamIds = await getManagedTeamIds(callerId, req.staff);
    const hasManagedTeams = managedTeamIds.length > 0;

    // Team lead (sees own team members + self)
    const isLead = !isMD && ['TEAM_LEAD', 'LEAD'].includes(roleUpper);

    // Single individual employee (ONLY ever sees their own call logs)
    const isSingleEmployee = !isMD && !isLead && !hasManagedTeams;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const offset = (page - 1) * limit;

    const { staffId, type, status, q, from, to, mineOnly } = req.query;

    const baseWhere = [];
    const baseParams = [];

    // Role scoping
    if (staffId === 'MINE' || mineOnly === 'true' || mineOnly === true) {
      // Any user (MD, Manager, Lead, Employee) can track their own call logs exclusively
      baseWhere.push('cl.staff_id = ?');
      baseParams.push(callerId);
    } else if (isSingleEmployee) {
      // Single employee ALWAYS only sees their own call logs
      baseWhere.push('cl.staff_id = ?');
      baseParams.push(callerId);
    } else if (!isMD && (isLead || hasManagedTeams)) {
      if (staffId && staffId !== 'ALL') {
        baseWhere.push('cl.staff_id = ?');
        baseParams.push(staffId);
      } else if (hasManagedTeams) {
        // Multi-team manager: view all members across all their managed teams + caller's own logs
        baseWhere.push('(cl.staff_id = ? OR s.team_id IN (?))');
        baseParams.push(callerId, managedTeamIds);
      } else {
        const [teamRows] = await pool.query('SELECT id FROM teams WHERE lead_id = ?', [callerId]);
        const teamIds = teamRows.map((t) => t.id);
        if (teamIds.length > 0) {
          baseWhere.push(`(cl.staff_id = ? OR s.team_id IN (${teamIds.map(() => '?').join(',')}))`);
          baseParams.push(callerId, ...teamIds);
        } else {
          baseWhere.push('cl.staff_id = ?');
          baseParams.push(callerId);
        }
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

    let staffList = [];
    if (isMD || isLead || hasManagedTeams) {
      let staffFilterWhere = '';
      let staffFilterParams = [];
      if (!isMD) {
        if (hasManagedTeams) {
          staffFilterWhere = 'WHERE cl.staff_id = ? OR s.team_id IN (?)';
          staffFilterParams = [callerId, managedTeamIds];
        } else {
          staffFilterWhere = `WHERE cl.staff_id = ${pool.escape(callerId)} OR s.team_id IN (SELECT id FROM teams WHERE lead_id = ${pool.escape(callerId)})`;
        }
      }
      const [sRows] = await pool.query(
        `SELECT DISTINCT cl.staff_id as id, COALESCE(s.full_name, cl.staff_name) as name, COALESCE(s.employee_id, cl.employee_id) as employeeId
         FROM staff_call_logs cl
         LEFT JOIN staff_users s ON cl.staff_id = s.id
         ${staffFilterWhere}
         ORDER BY name ASC`,
        staffFilterParams
      );
      staffList = sRows.map((r) => ({
        id: String(r.id),
        staffId: r.employeeId || String(r.id),
        employeeId: r.employeeId || '',
        name: r.name || 'Staff',
        staffName: r.name || 'Staff',
      }));

      // Ensure caller is present in staffList and labeled as Me
      const callerItem = {
        id: String(callerId),
        staffId: req.staff.employeeId || String(callerId),
        employeeId: req.staff.employeeId || '',
        name: `${req.staff.fullName || req.staff.name || 'Me'} (Me)`,
        staffName: `${req.staff.fullName || req.staff.name || 'Me'} (Me)`,
        isMe: true,
      };
      const meIdx = staffList.findIndex((s) => String(s.id) === String(callerId));
      if (meIdx >= 0) {
        staffList[meIdx] = callerItem;
      } else {
        staffList.unshift(callerItem);
      }
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
        phone: r.phoneNumber,
        phoneNumber: r.phoneNumber,
        contactName: r.contactName || '',
        type: String(r.callType || 'unknown').toLowerCase(),
        callType: r.callType || 'UNKNOWN',
        duration: Number(r.durationSeconds || 0),
        durationSeconds: Number(r.durationSeconds || 0),
        calledAt: r.callTimestamp,
        callTimestamp: r.callTimestamp,
        logged: Boolean(r.isAddedToEntry),
        isAddedToEntry: Boolean(r.isAddedToEntry),
        reportId: r.crmReportId || null,
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

/**
 * DELETE /call-logs/clear-old (MD/Admin only)
 * Clears previously synced test/old call logs and sets tracking anchor to NOW()
 * so only upcoming calls are recorded going forward.
 */
async function clearOldCallLogs(req, res, next) {
  try {
    await ensureCallLogsTable();
    const targetStaffId = req.query.staffId || req.body?.staffId || null;
    const nowSql = toMySqlDateTime(Date.now());

    if (targetStaffId && targetStaffId !== 'ALL') {
      const [del] = await pool.query('DELETE FROM staff_call_logs WHERE staff_id = ?', [targetStaffId]);
      await pool.query('UPDATE staff_users SET call_log_tracking_since = ? WHERE id = ?', [nowSql, targetStaffId]);
      return res.status(200).json({
        success: true,
        deletedCount: del.affectedRows || 0,
        message: `Cleared ${del.affectedRows || 0} old call logs for employee and anchored upcoming-only tracking from now.`,
      });
    }

    const [del] = await pool.query('DELETE FROM staff_call_logs');
    await pool.query('UPDATE staff_users SET call_log_tracking_since = ? WHERE call_log_tracking_since IS NOT NULL', [nowSql]);
    return res.status(200).json({
      success: true,
      deletedCount: del.affectedRows || 0,
      message: `Cleared ${del.affectedRows || 0} old call logs. Only upcoming calls will be recorded going forward.`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTrackingStatus,
  enableTracking,
  syncCallLogs,
  getCallLogs,
  markCallLogLogged,
  clearOldCallLogs,
};
