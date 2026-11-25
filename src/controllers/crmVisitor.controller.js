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

function formatVisitor(v) {
  if (!v) return null;
  return {
    ...v,
    id: v.id,
    visitorId: v.visitor_id || `LP-VIS-${v.id}`,
    ticketId: v.ticket_id || `TKT-VIS-${v.id}`,
    name: v.name,
    mobileNumber: v.mobile_number,
    purposeOfVisit: v.purpose_of_visit,
    personToMeet: v.person_to_meet,
    personToMeetId: v.person_to_meet_id,
    branchId: v.branch_id,
    branchName: v.branch_name,
    referredBy: v.referred_by || '',
    refreshmentStatus: v.refreshment_status || 'Not Offered',
    initialRemarks: v.initial_remarks || '',
    registeredById: v.registered_by_id,
    registeredByName: v.registered_by_name,
    visitDate: formatDateToYmd(v.visit_date),
    visitTime: v.visit_time || '',
    ticketStatus: v.ticket_status || 'Open',
    conclusion: v.conclusion || '',
    conclusionRemarks: v.conclusion_remarks || '',
    followUpDate: formatDateToYmd(v.follow_up_date),
    siteVisitDate: formatDateToYmd(v.site_visit_date),
    interviewDate: formatDateToYmd(v.interview_date),
    closedAt: v.closed_at || null,
    closedById: v.closed_by_id || null,
    closedByName: v.closed_by_name || null,
    createdAt: v.created_at || '',
    updatedAt: v.updated_at || '',
  };
}

function formatHistory(h) {
  if (!h) return null;
  return {
    ...h,
    id: h.id,
    visitorId: h.visitor_id,
    ticketId: h.ticket_id,
    action: h.action,
    oldStatus: h.old_status,
    newStatus: h.new_status,
    conclusion: h.conclusion || '',
    remarks: h.remarks || '',
    followUpDate: formatDateToYmd(h.follow_up_date),
    siteVisitDate: formatDateToYmd(h.site_visit_date),
    interviewDate: formatDateToYmd(h.interview_date),
    updatedById: h.updated_by_id,
    updatedByName: h.updated_by_name,
    updatedByRole: h.updated_by_role,
    createdAt: h.created_at || '',
  };
}

/**
 * Generate unique Visitor ID: LP-VIS-YYYYMM-XXXX
 */
async function generateNextVisitorId() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = `LP-VIS-${yyyy}${mm}-`;

  const [rows] = await pool.query(
    `SELECT visitor_id FROM visitors 
     WHERE visitor_id LIKE ? 
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0 && rows[0].visitor_id) {
    const parts = rows[0].visitor_id.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Generate unique Ticket ID: TKT-VIS-YYYYMM-XXXX
 */
async function generateNextTicketId() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = `TKT-VIS-${yyyy}${mm}-`;

  const [rows] = await pool.query(
    `SELECT ticket_id FROM visitors 
     WHERE ticket_id LIKE ? 
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let seq = 1;
  if (rows.length > 0 && rows[0].ticket_id) {
    const parts = rows[0].ticket_id.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) seq = lastNum + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

/**
 * Helper to fetch caller staff user details and access level
 */
async function getCallerStaff(staffId) {
  const [rows] = await pool.query(
    `SELECT id, employee_id, full_name, role, department, designation, branch_location, permissions
     FROM staff_users WHERE id = ?`,
    [staffId]
  );
  if (rows.length === 0) return null;

  const staff = rows[0];
  const perms = parsePermissions(staff.permissions);
  const roleUpper = (staff.role || '').toUpperCase();
  const desig = (staff.designation || '').toLowerCase();

  const isMD = roleUpper === 'MD' || roleUpper === 'ADMIN' || roleUpper === 'SUPER_ADMIN' || perms.includes('*');
  const isManager = isMD || roleUpper === 'SALES_HEAD' || roleUpper === 'GENERAL_MANAGER' ||
                    desig.includes('manager') || desig.includes('head') ||
                    perms.includes('visitors_manage') || perms.includes('visitors') || perms.includes('visitor_management') || perms.includes('visitor');
  const isFrontOffice = isManager || perms.includes('visitors_front_office') || perms.includes('front_office') || perms.includes('visitor_desk');

  return {
    ...staff,
    perms,
    isMD,
    isManager,
    isFrontOffice,
    branch: staff.branch_location || 'Karaikudi – Head Office',
  };
}

/**
 * 1. POST /visitors
 * Register a new visitor & auto-create visitor ticket
 */
async function registerVisitor(req, res) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const caller = await getCallerStaff(callerId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'Staff user profile not found' });
    }

    const {
      name,
      mobileNumber,
      mobile_number,
      purposeOfVisit,
      purpose_of_visit,
      personToMeet,
      person_to_meet,
      personToMeetId,
      person_to_meet_id,
      branchName,
      branch_name,
      branchId,
      branch_id,
      referredBy,
      referred_by,
      refreshmentStatus,
      refreshment_status,
      initialRemarks,
      initial_remarks,
      visitDate,
      visit_date,
      visitTime,
      visit_time,
    } = req.body;

    const visitorName = (name || '').trim();
    const phone = String(mobileNumber || mobile_number || '').trim().replace(/\D/g, '').slice(-10);
    const purpose = (purposeOfVisit || purpose_of_visit || 'Land Enquiry').trim();
    const toMeet = (personToMeet || person_to_meet || '').trim();
    const toMeetId = personToMeetId || person_to_meet_id || null;

    if (!visitorName) {
      return res.status(400).json({ success: false, message: 'Visitor name is required' });
    }
    if (!phone || phone.length < 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }
    if (!toMeet) {
      return res.status(400).json({ success: false, message: 'Person to meet is required' });
    }

    // Branch: auto-identified from logged-in Front Office user's branch; MD can optionally specify branch
    let finalBranch = caller.branch;
    if (caller.isMD && (branchName || branch_name)) {
      finalBranch = (branchName || branch_name).trim();
    }

    const finalBranchId = branchId || branch_id || null;
    const finalReferred = (referredBy || referred_by || '').trim();
    const finalRefreshment = (refreshmentStatus || refreshment_status || 'Not Offered');
    const finalInitialRemarks = (initialRemarks || initial_remarks || '').trim();

    // Automatic visit date & time if not provided
    const now = new Date();
    const finalVisitDate = formatDateToYmd(visitDate || visit_date) || formatDateToYmd(now);
    const finalVisitTime = (visitTime || visit_time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`).trim();

    const visitorId = await generateNextVisitorId();
    const ticketId = await generateNextTicketId();

    const [insertResult] = await pool.query(
      `INSERT INTO visitors (
        visitor_id, ticket_id, name, mobile_number, purpose_of_visit,
        person_to_meet, person_to_meet_id, branch_id, branch_name, referred_by,
        refreshment_status, initial_remarks, registered_by_id, registered_by_name,
        visit_date, visit_time, ticket_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open')`,
      [
        visitorId,
        ticketId,
        visitorName,
        phone,
        purpose,
        toMeet,
        toMeetId,
        finalBranchId,
        finalBranch,
        finalReferred || null,
        finalRefreshment,
        finalInitialRemarks || null,
        caller.id,
        caller.full_name,
        finalVisitDate,
        finalVisitTime,
      ]
    );

    const insertedId = insertResult.insertId;

    // Log initial ticket creation history event
    await pool.query(
      `INSERT INTO visitor_ticket_history (
        visitor_id, ticket_id, action, old_status, new_status, remarks,
        updated_by_id, updated_by_name, updated_by_role
      ) VALUES (?, ?, 'REGISTERED', NULL, 'Open', ?, ?, ?, ?)`,
      [
        insertedId,
        ticketId,
        finalInitialRemarks || 'Visitor arrived and registered at front office desk',
        caller.id,
        caller.full_name,
        caller.role || 'Staff',
      ]
    );

    const [createdRows] = await pool.query('SELECT * FROM visitors WHERE id = ?', [insertedId]);
    const createdVisitor = formatVisitor(createdRows[0]);

    return res.status(201).json({
      success: true,
      message: `Visitor registered successfully with Ticket ID: ${ticketId}`,
      data: createdVisitor,
    });
  } catch (err) {
    console.error('Error in registerVisitor:', err);
    return res.status(500).json({ success: false, message: err.message || 'Internal server error registering visitor' });
  }
}

/**
 * 2. GET /visitors
 * List visitors with branch scoping, search, and status/date filters
 */
async function getVisitors(req, res) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const caller = await getCallerStaff(callerId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'Staff user profile not found' });
    }

    const {
      branch,
      today,
      date_from,
      date_to,
      status,
      purpose,
      conclusion,
      q,
      page = 1,
      limit = 50,
    } = req.query;

    const conditions = [];
    const params = [];

    // Branch scoping:
    // Front Office staff and Branch Managers only see their own branch records
    // MD can access all branches or filter by branch
    if (!caller.isMD) {
      conditions.push('v.branch_name = ?');
      params.push(caller.branch);
    } else if (branch && branch !== 'ALL') {
      conditions.push('v.branch_name = ?');
      params.push(branch.trim());
    }

    // Today filter
    if (today === 'true' || today === '1') {
      conditions.push('v.visit_date = CURDATE()');
    } else {
      if (date_from) {
        conditions.push('v.visit_date >= ?');
        params.push(formatDateToYmd(date_from));
      }
      if (date_to) {
        conditions.push('v.visit_date <= ?');
        params.push(formatDateToYmd(date_to));
      }
    }

    // Status filter
    if (status && status !== 'ALL') {
      conditions.push('v.ticket_status = ?');
      params.push(status.trim());
    }

    // Purpose filter
    if (purpose && purpose !== 'ALL') {
      conditions.push('v.purpose_of_visit = ?');
      params.push(purpose.trim());
    }

    // Conclusion filter
    if (conclusion && conclusion !== 'ALL') {
      conditions.push('v.conclusion = ?');
      params.push(conclusion.trim());
    }

    // Search query: visitor name or mobile number
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      conditions.push('(v.name LIKE ? OR v.mobile_number LIKE ? OR v.visitor_id LIKE ? OR v.ticket_id LIKE ?)');
      params.push(term, term, term, term);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const offset = Math.max(0, (parseInt(page, 10) - 1) * parseInt(limit, 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));

    const [rows] = await pool.query(
      `SELECT v.* 
       FROM visitors v
       ${whereClause}
       ORDER BY v.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total 
       FROM visitors v
       ${whereClause}`,
      params
    );

    const total = countRows[0]?.total || 0;
    const formatted = rows.map(formatVisitor);

    return res.status(200).json({
      success: true,
      data: formatted,
      total,
      page: parseInt(page, 10),
      limit: limitNum,
    });
  } catch (err) {
    console.error('Error in getVisitors:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error fetching visitors' });
  }
}

/**
 * 3. GET /visitors/:id
 * Get visitor details and full chronological ticket activity history
 */
async function getVisitorById(req, res) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const caller = await getCallerStaff(callerId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'Staff user profile not found' });
    }

    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM visitors WHERE id = ? OR visitor_id = ? OR ticket_id = ?', [id, id, id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor record not found' });
    }

    const visitor = formatVisitor(rows[0]);

    // Branch scoping check
    if (!caller.isMD && visitor.branchName !== caller.branch) {
      return res.status(403).json({ success: false, message: 'Access denied to visitor records outside your branch' });
    }

    // Fetch ticket activity history
    const [historyRows] = await pool.query(
      `SELECT * FROM visitor_ticket_history 
       WHERE visitor_id = ? 
       ORDER BY created_at ASC, id ASC`,
      [visitor.id]
    );

    const history = historyRows.map(formatHistory);

    return res.status(200).json({
      success: true,
      data: {
        ...visitor,
        history,
      },
    });
  } catch (err) {
    console.error('Error in getVisitorById:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error fetching visitor details' });
  }
}

/**
 * 4. PATCH /visitors/:id/conclusion
 * Management update conclusion, schedule follow-ups/site visits/interviews, and update status
 */
async function updateVisitorConclusion(req, res) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const caller = await getCallerStaff(callerId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'Staff user profile not found' });
    }

    // Business Rule: Front Office staff cannot update management conclusions
    if (!caller.isManager && !caller.isMD) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only Managers and MD can update visitor conclusions and ticket status',
      });
    }

    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM visitors WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor record not found' });
    }

    const visitor = rows[0];

    // Branch check for managers
    if (!caller.isMD && visitor.branch_name !== caller.branch) {
      return res.status(403).json({ success: false, message: 'Access denied: You can only manage visitors from your branch' });
    }

    const {
      conclusion,
      conclusionRemarks,
      conclusion_remarks,
      remarks,
      ticketStatus,
      ticket_status,
      followUpDate,
      follow_up_date,
      siteVisitDate,
      site_visit_date,
      interviewDate,
      interview_date,
    } = req.body;

    const finalRemarks = (conclusionRemarks || conclusion_remarks || remarks || '').trim();
    if (!finalRemarks) {
      return res.status(400).json({ success: false, message: 'Remarks are mandatory when updating conclusion' });
    }

    const finalConclusion = (conclusion || visitor.conclusion || 'Meeting Completed').trim();
    let newStatus = (ticketStatus || ticket_status || visitor.ticket_status || 'In Progress').trim();

    // Auto status suggestion based on conclusion if not explicitly set
    if (!ticketStatus && !ticket_status) {
      if (finalConclusion === 'Follow-up Required') {
        newStatus = 'Follow-up Required';
      } else if (finalConclusion === 'Site Visit Planned') {
        newStatus = 'In Progress';
      } else if (finalConclusion === 'Completed' || finalConclusion === 'Meeting Completed') {
        newStatus = 'Completed';
      }
    }

    const finalFollowUpDate = formatDateToYmd(followUpDate || follow_up_date) || null;
    const finalSiteVisitDate = formatDateToYmd(siteVisitDate || site_visit_date) || null;
    const finalInterviewDate = formatDateToYmd(interviewDate || interview_date) || null;

    const oldStatus = visitor.ticket_status;

    await pool.query(
      `UPDATE visitors SET
        conclusion = ?,
        conclusion_remarks = ?,
        ticket_status = ?,
        follow_up_date = ?,
        site_visit_date = ?,
        interview_date = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [
        finalConclusion,
        finalRemarks,
        newStatus,
        finalFollowUpDate,
        finalSiteVisitDate,
        finalInterviewDate,
        visitor.id,
      ]
    );

    // Record ticket activity history
    await pool.query(
      `INSERT INTO visitor_ticket_history (
        visitor_id, ticket_id, action, old_status, new_status, conclusion, remarks,
        follow_up_date, site_visit_date, interview_date,
        updated_by_id, updated_by_name, updated_by_role
      ) VALUES (?, ?, 'CONCLUSION_UPDATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        visitor.id,
        visitor.ticket_id,
        oldStatus,
        newStatus,
        finalConclusion,
        finalRemarks,
        finalFollowUpDate,
        finalSiteVisitDate,
        finalInterviewDate,
        caller.id,
        caller.full_name,
        caller.isMD ? 'MD' : (caller.role || 'Manager'),
      ]
    );

    const [updatedRows] = await pool.query('SELECT * FROM visitors WHERE id = ?', [visitor.id]);
    return res.status(200).json({
      success: true,
      message: 'Visitor conclusion and ticket status updated successfully',
      data: formatVisitor(updatedRows[0]),
    });
  } catch (err) {
    console.error('Error in updateVisitorConclusion:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error updating visitor conclusion' });
  }
}

/**
 * 5. PATCH /visitors/:id/close
 * Close a completed ticket (Management only)
 */
async function closeVisitorTicket(req, res) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const caller = await getCallerStaff(callerId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'Staff user profile not found' });
    }

    // Business Rule: Front Office staff cannot close tickets
    if (!caller.isManager && !caller.isMD) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only Managers and MD can close visitor tickets',
      });
    }

    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM visitors WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Visitor record not found' });
    }

    const visitor = rows[0];

    // Branch check for managers
    if (!caller.isMD && visitor.branch_name !== caller.branch) {
      return res.status(403).json({ success: false, message: 'Access denied: You can only close tickets from your branch' });
    }

    const { remarks } = req.body;
    const closeRemarks = (remarks || '').trim();
    if (!closeRemarks) {
      return res.status(400).json({
        success: false,
        message: 'Remarks are mandatory before closing a ticket',
      });
    }

    const oldStatus = visitor.ticket_status;

    await pool.query(
      `UPDATE visitors SET
        ticket_status = 'Closed',
        closed_at = NOW(),
        closed_by_id = ?,
        closed_by_name = ?,
        conclusion_remarks = CONCAT(IFNULL(conclusion_remarks, ''), '\n[Closed]: ', ?)
       WHERE id = ?`,
      [caller.id, caller.full_name, closeRemarks, visitor.id]
    );

    // Record ticket history event
    await pool.query(
      `INSERT INTO visitor_ticket_history (
        visitor_id, ticket_id, action, old_status, new_status, conclusion, remarks,
        updated_by_id, updated_by_name, updated_by_role
      ) VALUES (?, ?, 'CLOSED', ?, 'Closed', ?, ?, ?, ?, ?)`,
      [
        visitor.id,
        visitor.ticket_id,
        oldStatus,
        visitor.conclusion || 'Closed',
        closeRemarks,
        caller.id,
        caller.full_name,
        caller.isMD ? 'MD' : (caller.role || 'Manager'),
      ]
    );

    const [updatedRows] = await pool.query('SELECT * FROM visitors WHERE id = ?', [visitor.id]);
    return res.status(200).json({
      success: true,
      message: 'Visitor ticket closed successfully',
      data: formatVisitor(updatedRows[0]),
    });
  } catch (err) {
    console.error('Error in closeVisitorTicket:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error closing visitor ticket' });
  }
}

/**
 * 6. GET /visitors/reports/summary
 * Consolidated reports and KPIs across branches or scoped by manager branch
 */
async function getVisitorSummaryReport(req, res) {
  try {
    const callerId = req.staff?.id;
    if (!callerId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const caller = await getCallerStaff(callerId);
    if (!caller) {
      return res.status(404).json({ success: false, message: 'Staff user profile not found' });
    }

    const { branch, date_from, date_to } = req.query;

    const conditions = [];
    const params = [];

    if (!caller.isMD) {
      conditions.push('branch_name = ?');
      params.push(caller.branch);
    } else if (branch && branch !== 'ALL') {
      conditions.push('branch_name = ?');
      params.push(branch.trim());
    }

    if (date_from) {
      conditions.push('visit_date >= ?');
      params.push(formatDateToYmd(date_from));
    }
    if (date_to) {
      conditions.push('visit_date <= ?');
      params.push(formatDateToYmd(date_to));
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total metrics
    const [overallRows] = await pool.query(`
      SELECT 
        COUNT(*) as totalVisitors,
        SUM(IF(visit_date = CURDATE(), 1, 0)) as todayVisitors,
        SUM(IF(ticket_status = 'Open', 1, 0)) as openTickets,
        SUM(IF(ticket_status = 'In Progress', 1, 0)) as inProgressTickets,
        SUM(IF(ticket_status = 'Follow-up Required', 1, 0)) as followUpRequiredTickets,
        SUM(IF(ticket_status = 'Completed', 1, 0)) as completedTickets,
        SUM(IF(ticket_status = 'Closed', 1, 0)) as closedTickets,
        SUM(IF(conclusion = 'Interested', 1, 0)) as interestedCount,
        SUM(IF(conclusion = 'Not Interested', 1, 0)) as notInterestedCount,
        SUM(IF(conclusion = 'Site Visit Planned' OR site_visit_date IS NOT NULL, 1, 0)) as siteVisitsPlannedCount,
        SUM(IF(follow_up_date IS NOT NULL AND ticket_status NOT IN ('Completed', 'Closed'), 1, 0)) as pendingFollowUpsCount
      FROM visitors
      ${whereClause}
    `, params);

    const metrics = overallRows[0] || {};

    // Branch-wise distribution
    const [branchRows] = await pool.query(`
      SELECT branch_name as branchName, COUNT(*) as count
      FROM visitors
      ${whereClause}
      GROUP BY branch_name
      ORDER BY count DESC
    `, params);

    // Purpose-wise distribution
    const [purposeRows] = await pool.query(`
      SELECT purpose_of_visit as purpose, COUNT(*) as count
      FROM visitors
      ${whereClause}
      GROUP BY purpose_of_visit
      ORDER BY count DESC
    `, params);

    // Conclusion-wise distribution
    const [conclusionRows] = await pool.query(`
      SELECT IFNULL(conclusion, 'Pending Review') as conclusion, COUNT(*) as count
      FROM visitors
      ${whereClause}
      GROUP BY conclusion
      ORDER BY count DESC
    `, params);

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalVisitors: Number(metrics.totalVisitors || 0),
          todayVisitors: Number(metrics.todayVisitors || 0),
          openTickets: Number(metrics.openTickets || 0),
          inProgressTickets: Number(metrics.inProgressTickets || 0),
          followUpRequiredTickets: Number(metrics.followUpRequiredTickets || 0),
          completedTickets: Number(metrics.completedTickets || 0),
          closedTickets: Number(metrics.closedTickets || 0),
          interestedCount: Number(metrics.interestedCount || 0),
          notInterestedCount: Number(metrics.notInterestedCount || 0),
          siteVisitsPlannedCount: Number(metrics.siteVisitsPlannedCount || 0),
          pendingFollowUpsCount: Number(metrics.pendingFollowUpsCount || 0),
        },
        branchWise: branchRows.map((r) => ({ branchName: r.branchName, count: Number(r.count) })),
        purposeWise: purposeRows.map((r) => ({ purpose: r.purpose, count: Number(r.count) })),
        conclusionWise: conclusionRows.map((r) => ({ conclusion: r.conclusion, count: Number(r.count) })),
      },
    });
  } catch (err) {
    console.error('Error in getVisitorSummaryReport:', err);
    return res.status(500).json({ success: false, message: err.message || 'Error generating visitor summary report' });
  }
}

module.exports = {
  registerVisitor,
  getVisitors,
  getVisitorById,
  updateVisitorConclusion,
  closeVisitorTicket,
  getVisitorSummaryReport,
};
