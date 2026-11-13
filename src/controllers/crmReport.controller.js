const { pool } = require('../config/db');

/**
 * Validate phone number: accepts 10-digit Indian numbers or foreign numbers with +<country code><number>
 */
function isValidPhoneNumber(phone) {
  if (!phone) return false;
  const clean = String(phone).trim();
  const digitsOnly = clean.replace(/[^0-9]/g, '');
  if (clean.startsWith('+')) {
    return digitsOnly.length >= 7 && digitsOnly.length <= 15;
  }
  return digitsOnly.length === 10;
}

/**
 * Helper: Ensures new work_reports columns exist dynamically
 */
async function ensureWorkReportsColumns() {
  const extraCols = [
    { name: 'discussed_layout', type: 'TEXT NULL' },
    { name: 'corner_plot', type: 'VARCHAR(10) NULL' },
    { name: 'not_interested_reason', type: 'TEXT NULL' },
    { name: 'client_location', type: 'VARCHAR(255) NULL' },
  ];
  for (const col of extraCols) {
    try {
      const [exists] = await pool.query(`SHOW COLUMNS FROM work_reports LIKE '${col.name}'`);
      if (exists.length === 0) {
        await pool.query(`ALTER TABLE work_reports ADD COLUMN ${col.name} ${col.type}`);
      }
    } catch (_) {}
  }
  // Ensure columns that are nullable according to v2.1 spec allow NULL in MySQL
  const nullableCols = [
    { name: 'customer_name', type: 'VARCHAR(150) NULL' },
    { name: 'whatsapp_phone', type: 'VARCHAR(25) NULL' },
    { name: 'source', type: 'VARCHAR(100) NULL' },
    { name: 'next_action', type: 'VARCHAR(100) NULL' },
    { name: 'work_status', type: 'VARCHAR(50) NULL DEFAULT "Ongoing"' },
  ];
  for (const col of nullableCols) {
    try {
      await pool.query(`ALTER TABLE work_reports MODIFY COLUMN ${col.name} ${col.type}`);
    } catch (_) {}
  }
}

/**
 * 29. POST /reports (Lead, Employee)
 * Save one call entry with v2.1 conditional validations.
 */
async function createReport(req, res, next) {
  try {
    await ensureWorkReportsColumns();
    const employeeId = req.staff?.id;
    if (!employeeId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const {
      date,
      taskDesc,
      customer,
      contact,
      whatsapp,
      source,
      customerLeadId,
      callType,
      callStatus,
      callTime,
      callDuration,
      callNotes,
      project,
      offer,
      propertyType,
      purpose,
      payment,
      plot,
      budget,
      stage,
      qualification,
      followUp,
      followUpType,
      siteVisit = 'Not Planned',
      workStatus = 'Ongoing',
      requirement,
      nextAction,
      remarks,
      calls = 1,
      // New separate fields
      discussedLayout,
      cornerPlot,
      notInterestedReason,
      clientLocation,
    } = req.body;

    // 1. Mandatory base fields check
    const errors = {};
    const reportDate = date ? String(date).trim() : new Date().toISOString().split('T')[0];
    const cleanContact = (contact || '').trim();
    const cleanWhatsapp = (whatsapp && String(whatsapp).trim()) ? String(whatsapp).trim() : cleanContact;
    const statusTrim = (callStatus || '').trim();
    const typeTrim = (callType || '').trim();

    if (!cleanContact) {
      errors.contact = 'Customer contact number is required';
    } else if (!isValidPhoneNumber(cleanContact)) {
      errors.contact = 'Contact phone must be a 10-digit number or +<country code><number>';
    }

    if (cleanWhatsapp && !isValidPhoneNumber(cleanWhatsapp)) {
      errors.whatsapp = 'WhatsApp phone must be a 10-digit number or +<country code><number>';
    }

    if (!typeTrim) {
      errors.callType = 'Call type is required ("Outgoing" | "Incoming")';
    }

    if (!statusTrim) {
      errors.callStatus = 'Call status is required';
    }

    // 2. Conditional Validations based on callStatus
    const UNCONNECTED_STATUSES = ['Switched Off', 'Not Answering', 'Busy', 'Out of Service', 'Wrong Number'];
    const isUnconnected = UNCONNECTED_STATUSES.includes(statusTrim);
    const isConnectedWilling = statusTrim === 'Connected - Willing';
    const isStageRequired = ['Connected - Willing', 'Follow Up Calls', 'WhatsApp Follow-up'].includes(statusTrim);
    const isDraft = Boolean(req.body.isDraft || req.body.draft || req.body.isPartial);

    // Customer name is mandatory for connected calls, optional/nullable for unconnected calls
    if (!isUnconnected && (!customer || !String(customer).trim())) {
      errors.customer = 'Customer name is required when call was connected';
    }

    // Project is mandatory only for Connected - Willing (skip when saving draft/exit)
    if (!isDraft && isConnectedWilling && (!project || !String(project).trim())) {
      errors.project = 'Project is required for Connected - Willing';
    }

    // Stage is required when callStatus is Connected - Willing, Follow Up Calls, or WhatsApp Follow-up (skip when saving draft/exit)
    if (!isDraft && isStageRequired && (!stage || !String(stage).trim())) {
      errors.stage = `Stage is required when call status is '${statusTrim}'`;
    }

    // FollowUp is optional and nullable for every call status. If provided, check date order.
    if (followUp && reportDate && new Date(followUp) < new Date(reportDate)) {
      errors.followUp = 'Follow-up date cannot be earlier than report date';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please fill in all required fields.',
        errors,
      });
    }

    // Defaults & Clean values
    const finalCustomer = (customer && String(customer).trim()) ? String(customer).trim() : null;
    const finalSource = (source && String(source).trim()) ? String(source).trim() : 'Meta FB';
    const finalWorkStatus = (workStatus && String(workStatus).trim()) ? String(workStatus).trim() : 'Ongoing';
    const finalNextAction = (nextAction && String(nextAction).trim())
      ? String(nextAction).trim()
      : (isUnconnected ? 'Reschedule call to next day' : 'Follow-up Call');
    const finalSiteVisit = (siteVisit && String(siteVisit).trim()) ? String(siteVisit).trim() : 'Not Planned';
    const finalQual = (qualification && String(qualification).trim()) ? String(qualification).trim() : 'Cold';
    const finalStage = stage ? String(stage).trim() : '';
    const finalReq = requirement ? String(requirement).trim() : '';
    const finalProject = project ? String(project).trim() : null;
    const finalOffer = offer ? String(offer).trim() : null;
    const finalPropertyType = propertyType ? String(propertyType).trim() : null;
    const finalPurpose = purpose ? String(purpose).trim() : null;
    const finalPayment = payment ? String(payment).trim() : null;
    const finalPlot = plot ? String(plot).trim() : null;
    const finalBudget = budget ? String(budget).trim() : null;

    const [insertResult] = await pool.query(`
      INSERT INTO work_reports (
        employee_id, customer_lead_id, report_date, task_desc, customer_name,
        contact_phone, whatsapp_phone, source, call_type, call_status,
        call_time, call_duration, call_notes, project, offer,
        property_type, purpose, payment, plot, budget,
        stage, qualification, follow_up_date, site_visit, work_status,
        requirement, next_action, remarks, calls,
        discussed_layout, corner_plot, not_interested_reason, client_location
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      employeeId,
      customerLeadId || null,
      reportDate,
      taskDesc || null,
      finalCustomer,
      cleanContact,
      cleanWhatsapp,
      finalSource,
      typeTrim,
      statusTrim,
      callTime || null,
      callDuration ? parseInt(callDuration, 10) : 0,
      callNotes || null,
      finalProject,
      finalOffer,
      finalPropertyType,
      finalPurpose,
      finalPayment,
      finalPlot,
      finalBudget,
      finalStage,
      finalQual,
      followUp || null,
      finalSiteVisit,
      finalWorkStatus,
      finalReq,
      finalNextAction,
      remarks || null,
      parseInt(calls, 10) || 1,
      discussedLayout || null,
      cornerPlot || null,
      notInterestedReason || null,
      clientLocation || null,
    ]);

    const reportId = insertResult.insertId;

    return res.status(201).json({
      success: true,
      message: 'Call report created successfully',
      data: {
        id: `rep_${reportId}`,
        reportId: String(reportId),
        contact: cleanContact,
        createdAt: new Date().toISOString(),
        employeeId: String(employeeId),
        customerLeadId: customerLeadId || null,
        date: reportDate,
        customer: finalCustomer,
        whatsapp: cleanWhatsapp,
        callType: typeTrim,
        callStatus: statusTrim,
        workStatus: finalWorkStatus,
        stage: finalStage,
        calls: parseInt(calls, 10) || 1,
        discussedLayout: discussedLayout || null,
        cornerPlot: cornerPlot || null,
        notInterestedReason: notInterestedReason || null,
        clientLocation: clientLocation || null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Lookup previous call history for a contact number across all employees
 * GET /reports/by-contact?contact=<number>&history=true
 */
async function getReportByContact(req, res, next) {
  try {
    await ensureWorkReportsColumns();
    const contact = (req.query.contact || '').trim();
    if (!contact) {
      return res.status(200).json({ success: true, count: 0, last: null, history: [] });
    }

    const cleanPhone = contact.replace(/[^0-9+]/g, '');
    const digitsOnly = contact.replace(/[^0-9]/g, '');
    const last10 = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

    // 1. Total earlier calls count across ALL employees
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM work_reports 
       WHERE contact_phone = ? 
          OR contact_phone = ? 
          OR contact_phone LIKE ?`,
      [cleanPhone, digitsOnly, `%${last10}`]
    );
    const count = parseInt(countRows[0]?.total || 0, 10);

    if (count === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        last: null,
        history: [],
      });
    }

    // 2. Fetch the most recent report with employee name and full fields
    const [lastRows] = await pool.query(
      `SELECT 
         wr.id,
         wr.customer_name as customer,
         wr.contact_phone as contact,
         wr.whatsapp_phone as whatsapp,
         wr.client_location as clientLocation,
         wr.source,
         wr.project,
         wr.stage,
         wr.site_visit as siteVisit,
         wr.qualification,
         wr.call_status as callStatus,
         DATE_FORMAT(wr.report_date, '%Y-%m-%d') as date,
         wr.call_time as callTime,
         wr.call_notes as callNotes,
         s.full_name as employee
       FROM work_reports wr
       LEFT JOIN staff_users s ON s.id = wr.employee_id
       WHERE wr.contact_phone = ? 
          OR wr.contact_phone = ? 
          OR wr.contact_phone LIKE ?
       ORDER BY wr.report_date DESC, wr.id DESC
       LIMIT 1`,
      [cleanPhone, digitsOnly, `%${last10}`]
    );

    const last = lastRows[0] ? {
      id: `rep_${lastRows[0].id}`,
      customer: lastRows[0].customer || null,
      contact: lastRows[0].contact || cleanPhone,
      whatsapp: lastRows[0].whatsapp || cleanPhone,
      clientLocation: lastRows[0].clientLocation || null,
      source: lastRows[0].source || 'Meta FB',
      project: lastRows[0].project || null,
      stage: lastRows[0].stage || null,
      siteVisit: lastRows[0].siteVisit || 'Not Planned',
      qualification: lastRows[0].qualification || 'Cold',
      callStatus: lastRows[0].callStatus || null,
      date: lastRows[0].date || null,
      callTime: lastRows[0].callTime || null,
      employee: lastRows[0].employee || 'Staff Member',
      callNotes: lastRows[0].callNotes || '',
    } : null;

    // 3. Fetch call interaction history
    const [historyRows] = await pool.query(
      `SELECT 
         wr.id,
         DATE_FORMAT(wr.report_date, '%Y-%m-%d') as date,
         wr.call_status as callStatus,
         s.full_name as employee,
         wr.call_notes as callNotes
       FROM work_reports wr
       LEFT JOIN staff_users s ON s.id = wr.employee_id
       WHERE wr.contact_phone = ? 
          OR wr.contact_phone = ? 
          OR wr.contact_phone LIKE ?
       ORDER BY wr.report_date DESC, wr.id DESC
       LIMIT 50`,
      [cleanPhone, digitsOnly, `%${last10}`]
    );

    const history = historyRows.map(h => ({
      id: `rep_${h.id}`,
      date: h.date || null,
      callStatus: h.callStatus || '',
      employee: h.employee || 'Staff Member',
      callNotes: h.callNotes || '',
    }));

    return res.status(200).json({
      success: true,
      count,
      last,
      history,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 30. GET /reports (Scoped: MD all, Lead own team, Employee own)
 * Filters: employeeId, teamId, callStatus, callType, date, from, to, source, project, qualification, siteVisit, workStatus, hasFollowUp=true, q.
 * Order: Newest first.
 */
async function getReports(req, res, next) {
  try {
    await ensureWorkReportsColumns();
    // If contact query parameter is passed, redirect to contact lookup
    if (req.query.contact && !req.query.page && !req.query.limit && !req.query.from && !req.query.to) {
      return getReportByContact(req, res, next);
    }
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '100', 10)));
    const offset = (page - 1) * limit;

    const {
      employeeId,
      teamId,
      callStatus,
      callType,
      date,
      from,
      to,
      source,
      project,
      qualification,
      siteVisit,
      workStatus,
      hasFollowUp,
      q,
    } = req.query;

    let whereConditions = ['1=1'];
    let params = [];

    // Role-based scoping
    if (isMD) {
      if (employeeId) {
        whereConditions.push('(wr.employee_id = ? OR s.employee_id = ?)');
        params.push(employeeId, employeeId);
      }
      if (teamId) {
        whereConditions.push('s.team_id = ?');
        params.push(teamId);
      }
    } else if (isLead) {
      // Lead sees reports of own team
      whereConditions.push('s.team_id = ?');
      params.push(req.staff.teamId || req.staff.team_id || 0);

      if (employeeId) {
        whereConditions.push('(wr.employee_id = ? OR s.employee_id = ?)');
        params.push(employeeId, employeeId);
      }
    } else {
      // Employee sees only their own reports
      whereConditions.push('wr.employee_id = ?');
      params.push(callerId);
    }

    if (date && date.trim()) {
      whereConditions.push('wr.report_date = ?');
      params.push(date.trim());
    }

    if (callType && callType.trim()) {
      whereConditions.push('wr.call_type = ?');
      params.push(callType.trim());
    }

    if (callStatus && callStatus.trim()) {
      whereConditions.push('wr.call_status = ?');
      params.push(callStatus.trim());
    }

    if (from) {
      whereConditions.push('wr.report_date >= ?');
      params.push(from);
    }

    if (to) {
      whereConditions.push('wr.report_date <= ?');
      params.push(to);
    }

    if (source && source.trim()) {
      whereConditions.push('wr.source = ?');
      params.push(source.trim());
    }

    if (project && project.trim()) {
      whereConditions.push('wr.project = ?');
      params.push(project.trim());
    }

    if (qualification && qualification.trim()) {
      whereConditions.push('wr.qualification = ?');
      params.push(qualification.trim());
    }

    if (siteVisit && siteVisit.trim()) {
      whereConditions.push('wr.site_visit = ?');
      params.push(siteVisit.trim());
    }

    if (workStatus && workStatus.trim()) {
      whereConditions.push('wr.work_status = ?');
      params.push(workStatus.trim());
    }

    if (hasFollowUp === 'true' || hasFollowUp === true) {
      whereConditions.push('wr.follow_up_date IS NOT NULL');
    }

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      whereConditions.push('(wr.customer_name LIKE ? OR wr.contact_phone LIKE ?)');
      params.push(searchTerm, searchTerm);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Total count query
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      ${whereClause}
    `, params);
    const total = countResult[0].total;

    // Data query (Newest first)
    const [rows] = await pool.query(`
      SELECT 
        wr.id,
        wr.employee_id as employeeId,
        s.employee_id as staffEmployeeId,
        s.full_name as employeeName,
        s.team_id as teamId,
        t.name as teamName,
        wr.customer_lead_id as customerLeadId,
        DATE_FORMAT(wr.report_date, '%Y-%m-%d') as date,
        wr.task_desc as taskDesc,
        wr.customer_name as customer,
        wr.contact_phone as contact,
        wr.whatsapp_phone as whatsapp,
        wr.source,
        wr.call_type as callType,
        wr.call_status as callStatus,
        wr.call_time as callTime,
        wr.call_duration as callDuration,
        wr.call_notes as callNotes,
        wr.project,
        wr.offer,
        wr.property_type as propertyType,
        wr.purpose,
        wr.payment,
        wr.plot,
        wr.budget,
        wr.stage,
        wr.qualification,
        DATE_FORMAT(wr.follow_up_date, '%Y-%m-%d') as followUp,
        wr.site_visit as siteVisit,
        wr.work_status as workStatus,
        wr.requirement,
        wr.next_action as nextAction,
        wr.remarks,
        wr.calls,
        wr.discussed_layout as discussedLayout,
        wr.corner_plot as cornerPlot,
        wr.not_interested_reason as notInterestedReason,
        wr.client_location as clientLocation,
        wr.created_at as createdAt
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      LEFT JOIN teams t ON s.team_id = t.id
      ${whereClause}
      ORDER BY wr.report_date DESC, wr.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const data = rows.map(r => ({
      id: `rep_${r.id}`,
      reportId: String(r.id),
      employeeId: String(r.employeeId),
      staffEmployeeId: r.staffEmployeeId || String(r.employeeId),
      employeeCode: r.staffEmployeeId || String(r.employeeId),
      employee: r.employeeName || 'Staff Member',
      employeeName: r.employeeName || 'Staff Member',
      teamId: r.teamId ? String(r.teamId) : null,
      teamName: r.teamName || null,
      customerLeadId: r.customerLeadId || null,
      date: r.date,
      taskDesc: r.taskDesc || '',
      customer: r.customer || '',
      contact: r.contact || '',
      whatsapp: r.whatsapp || '',
      clientLocation: r.clientLocation || null,
      source: r.source || '',
      callType: r.callType || 'Outgoing',
      callStatus: r.callStatus || '',
      callTime: r.callTime || '',
      callDuration: r.callDuration || 0,
      callNotes: r.callNotes || '',
      project: r.project || '',
      offer: r.offer || '',
      propertyType: r.propertyType || '',
      purpose: r.purpose || '',
      payment: r.payment || '',
      plot: r.plot || '',
      budget: r.budget || '',
      stage: r.stage || '',
      qualification: r.qualification || 'Cold',
      followUp: r.followUp || null,
      siteVisit: r.siteVisit || 'Not Planned',
      workStatus: r.workStatus || 'Ongoing',
      requirement: r.requirement || '',
      nextAction: r.nextAction || '',
      remarks: r.remarks || '',
      discussedLayout: r.discussedLayout || null,
      cornerPlot: r.cornerPlot || null,
      notInterestedReason: r.notInterestedReason || null,
      calls: r.calls || 1,
      createdAt: r.createdAt,
    }));

    return res.status(200).json({
      success: true,
      total,
      count: data.length,
      reports: data,
      data,
      meta: {
        page,
        limit,
        total,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 31. GET /reports/:id
 * Single entry details.
 */
async function getReportById(req, res, next) {
  try {
    const rawId = req.params.id;
    const reportId = String(rawId).replace(/^rep_/, '');
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = String(req.staff?.id || '');

    const [rows] = await pool.query(`
      SELECT 
        wr.*,
        s.employee_id as staffEmployeeId,
        s.full_name as employeeName,
        s.team_id as teamId,
        t.name as teamName,
        t.lead_id as leadId
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      LEFT JOIN teams t ON s.team_id = t.id
      WHERE wr.id = ? LIMIT 1
    `, [reportId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Work report not found.' });
    }

    const r = rows[0];

    // Scoping check
    if (!isMD) {
      if (isLead && String(r.leadId) !== callerId && String(r.employee_id) !== callerId) {
        return res.status(403).json({ success: false, message: 'Access denied to this report.' });
      } else if (!isLead && String(r.employee_id) !== callerId) {
        return res.status(403).json({ success: false, message: 'Access denied to this report.' });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        id: `rep_${r.id}`,
        reportId: String(r.id),
        employeeId: String(r.employee_id),
        staffEmployeeId: r.staffEmployeeId || String(r.employee_id),
        employeeCode: r.staffEmployeeId || String(r.employee_id),
        employee: r.employeeName || 'Staff Member',
        employeeName: r.employeeName,
        teamId: r.teamId ? String(r.teamId) : null,
        teamName: r.teamName || null,
        customerLeadId: r.customer_lead_id || null,
        date: r.report_date ? r.report_date.toISOString().slice(0, 10) : '',
        taskDesc: r.task_desc || '',
        customer: r.customer_name || '',
        contact: r.contact_phone || '',
        whatsapp: r.whatsapp_phone || '',
        clientLocation: r.client_location || null,
        source: r.source || '',
        callType: r.call_type || 'Outgoing',
        callStatus: r.call_status || '',
        callTime: r.call_time || '',
        callDuration: r.call_duration || 0,
        callNotes: r.call_notes || '',
        project: r.project || '',
        offer: r.offer || '',
        propertyType: r.property_type || '',
        purpose: r.purpose || '',
        payment: r.payment || '',
        plot: r.plot || '',
        budget: r.budget || '',
        stage: r.stage || '',
        qualification: r.qualification || '',
        followUp: r.follow_up_date ? r.follow_up_date.toISOString().slice(0, 10) : null,
        siteVisit: r.site_visit || 'Not Planned',
        workStatus: r.work_status || 'Ongoing',
        requirement: r.requirement || '',
        nextAction: r.next_action || '',
        remarks: r.remarks || '',
        discussedLayout: r.discussed_layout || null,
        cornerPlot: r.corner_plot || null,
        notInterestedReason: r.not_interested_reason || null,
        calls: r.calls || 1,
        createdAt: r.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 31b. PATCH /reports/:id
 * Partial update for previously submitted customer details without creating redundant reports.
 */
async function updateReport(req, res, next) {
  try {
    await ensureWorkReportsColumns();
    const rawId = req.params.id;
    if (!rawId) {
      return res.status(400).json({ success: false, message: 'Report ID is required.' });
    }
    const reportId = String(rawId).replace(/^rep_/, '').trim();

    const [existing] = await pool.query('SELECT * FROM work_reports WHERE id = ? LIMIT 1', [reportId]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    const {
      customer,
      clientLocation,
      project,
      stage,
      siteVisit,
      remarks,
      callNotes,
      whatsapp,
      qualification,
      budget,
      plot,
      payment,
      purpose,
      offer,
      propertyType,
      workStatus,
      nextAction,
      followUp,
      discussedLayout,
      cornerPlot,
      notInterestedReason,
      source,
      callStatus,
      requirement,
    } = req.body;

    const updates = [];
    const values = [];

    if (source !== undefined) {
      updates.push('source = ?');
      values.push(source ? String(source).trim() : null);
    }
    if (callStatus !== undefined) {
      updates.push('call_status = ?');
      values.push(callStatus ? String(callStatus).trim() : null);
    }
    if (requirement !== undefined) {
      updates.push('requirement = ?');
      values.push(requirement ? String(requirement).trim() : null);
    }

    if (customer !== undefined) {
      updates.push('customer_name = ?');
      values.push(customer ? String(customer).trim() : null);
    }
    if (clientLocation !== undefined) {
      updates.push('client_location = ?');
      values.push(clientLocation ? String(clientLocation).trim() : null);
    }
    if (project !== undefined) {
      updates.push('project = ?');
      values.push(project ? String(project).trim() : null);
    }
    if (stage !== undefined) {
      updates.push('stage = ?');
      values.push(stage ? String(stage).trim() : null);
    }
    if (siteVisit !== undefined) {
      updates.push('site_visit = ?');
      values.push(siteVisit ? String(siteVisit).trim() : 'Not Planned');
    }
    if (remarks !== undefined) {
      updates.push('remarks = ?');
      values.push(remarks ? String(remarks).trim() : null);
    }
    if (callNotes !== undefined) {
      updates.push('call_notes = ?');
      values.push(callNotes ? String(callNotes).trim() : null);
    }
    if (whatsapp !== undefined) {
      updates.push('whatsapp_phone = ?');
      values.push(whatsapp ? String(whatsapp).trim() : null);
    }
    if (qualification !== undefined) {
      updates.push('qualification = ?');
      values.push(qualification ? String(qualification).trim() : null);
    }
    if (budget !== undefined) {
      updates.push('budget = ?');
      values.push(budget ? String(budget).trim() : null);
    }
    if (plot !== undefined) {
      updates.push('plot = ?');
      values.push(plot ? String(plot).trim() : null);
    }
    if (payment !== undefined) {
      updates.push('payment = ?');
      values.push(payment ? String(payment).trim() : null);
    }
    if (purpose !== undefined) {
      updates.push('purpose = ?');
      values.push(purpose ? String(purpose).trim() : null);
    }
    if (offer !== undefined) {
      updates.push('offer = ?');
      values.push(offer ? String(offer).trim() : null);
    }
    if (propertyType !== undefined) {
      updates.push('property_type = ?');
      values.push(propertyType ? String(propertyType).trim() : null);
    }
    if (workStatus !== undefined) {
      updates.push('work_status = ?');
      values.push(workStatus ? String(workStatus).trim() : 'Ongoing');
    }
    if (nextAction !== undefined) {
      updates.push('next_action = ?');
      values.push(nextAction ? String(nextAction).trim() : null);
    }
    if (followUp !== undefined) {
      updates.push('follow_up_date = ?');
      values.push(followUp || null);
    }
    if (discussedLayout !== undefined) {
      updates.push('discussed_layout = ?');
      values.push(discussedLayout ? String(discussedLayout).trim() : null);
    }
    if (cornerPlot !== undefined) {
      updates.push('corner_plot = ?');
      values.push(cornerPlot ? String(cornerPlot).trim() : null);
    }
    if (notInterestedReason !== undefined) {
      updates.push('not_interested_reason = ?');
      values.push(notInterestedReason ? String(notInterestedReason).trim() : null);
    }

    if (updates.length > 0) {
      values.push(reportId);
      await pool.query(`UPDATE work_reports SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    const [updatedRows] = await pool.query(
      `SELECT wr.*, s.full_name as employeeName, s.employee_id as staffEmployeeId
       FROM work_reports wr
       LEFT JOIN staff_users s ON s.id = wr.employee_id
       WHERE wr.id = ? LIMIT 1`,
      [reportId]
    );
    const updated = updatedRows[0];

    return res.status(200).json({
      success: true,
      message: 'Customer details updated successfully',
      data: {
        id: `rep_${reportId}`,
        reportId: parseInt(reportId, 10),
        customer: updated.customer_name || null,
        clientLocation: updated.client_location || null,
        project: updated.project || null,
        stage: updated.stage || null,
        siteVisit: updated.site_visit || null,
        remarks: updated.remarks || null,
        qualification: updated.qualification || null,
        budget: updated.budget || null,
        plot: updated.plot || null,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 31c. GET /reports/daily-register
 * Pre-aggregated column lists for the Daily Call Register workbook (.xls) and modal preview.
 */
async function getDailyRegister(req, res, next) {
  try {
    await ensureWorkReportsColumns();
    const queryDate = req.query.date ? req.query.date.trim() : new Date().toISOString().split('T')[0];
    const employeeIdFilter = req.query.employeeId ? req.query.employeeId.trim() : null;
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN', 'MD'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    let whereConditions = ['wr.report_date = ?'];
    let params = [queryDate];

    let employeeName = 'Lena Promoters Staff';
    let teamName = 'Lena Promoters';

    if (employeeIdFilter) {
      whereConditions.push('(wr.employee_id = ? OR s.employee_id = ?)');
      params.push(employeeIdFilter, employeeIdFilter);

      const [stRows] = await pool.query(
        `SELECT s.full_name, t.name as team_name 
         FROM staff_users s 
         LEFT JOIN teams t ON s.team_id = t.id 
         WHERE s.id = ? OR s.employee_id = ? LIMIT 1`,
        [employeeIdFilter, employeeIdFilter]
      );
      if (stRows.length > 0) {
        employeeName = stRows[0].full_name;
        teamName = stRows[0].team_name || 'Lena Promoters';
      }
    } else if (!isMD && !isLead) {
      // Regular telecaller: filter to own calls
      whereConditions.push('wr.employee_id = ?');
      params.push(callerId);
      employeeName = req.staff.fullName || req.staff.full_name || req.staff.name || 'Telecaller';
      if (req.staff.teamId || req.staff.team_id) {
        const [tRows] = await pool.query('SELECT name FROM teams WHERE id = ? LIMIT 1', [req.staff.teamId || req.staff.team_id]);
        if (tRows.length > 0) teamName = tRows[0].name;
      }
    } else if (isLead && !isMD) {
      // Team lead: filter to own team
      const leadTeamId = req.staff.teamId || req.staff.team_id;
      if (leadTeamId) {
        whereConditions.push('s.team_id = ?');
        params.push(leadTeamId);
      }
      employeeName = req.staff.fullName || req.staff.full_name || req.staff.name || 'Team Lead';
    }

    const [rows] = await pool.query(
      `SELECT 
         wr.id,
         wr.contact_phone as contact,
         wr.call_type as callType,
         wr.call_status as callStatus,
         wr.budget,
         wr.qualification,
         s.full_name as employeeName,
         t.name as teamName
       FROM work_reports wr
       JOIN staff_users s ON wr.employee_id = s.id
       LEFT JOIN teams t ON s.team_id = t.id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY wr.id ASC`,
      params
    );

    if (rows.length > 0 && !employeeIdFilter && (isMD || isLead)) {
      teamName = rows[0].teamName || 'Lena Promoters';
      employeeName = isMD ? 'All Telecallers' : (rows[0].teamName ? `${rows[0].teamName} Team` : 'Team Members');
    }

    const newCalls = [];
    const fuCalls = [];
    const incCalls = [];
    const willingClients = [];
    const notWillingClients = [];
    const noAnswerCalls = [];
    let totalValuePipeline = 0;

    const noAnswerSet = new Set([
      'Switched Off',
      'Not Answering',
      'Busy',
      'Out of Service',
      'Wrong Number',
    ]);

    for (const r of rows) {
      const phone = r.contact || '';
      if (!phone) continue;

      const cType = (r.callType || '').trim();
      const cStatus = (r.callStatus || '').trim();

      // 1. Column categorizations
      if (cType.toLowerCase() === 'incoming') {
        incCalls.push(phone);
      } else if (
        cStatus === 'Follow Up Calls' ||
        cStatus === 'WhatsApp Follow-up' ||
        cStatus === 'Call Back Requested' ||
        cType.toLowerCase().includes('follow')
      ) {
        fuCalls.push(phone);
      } else {
        newCalls.push(phone);
      }

      if (cStatus === 'Connected - Willing') {
        willingClients.push(phone);

        // Calculate pipeline value from budget
        if (r.budget) {
          const num = parseFloat(String(r.budget).replace(/[^0-9.]/g, ''));
          if (!isNaN(num) && num > 0) {
            totalValuePipeline += num;
          }
        }
      } else if (cStatus === 'Connected - Not Willing') {
        notWillingClients.push(phone);
      }

      if (noAnswerSet.has(cStatus)) {
        noAnswerCalls.push(phone);
      }
    }

    return res.status(200).json({
      success: true,
      date: queryDate,
      employee: employeeName,
      team: teamName,
      target: 50,
      columns: {
        newCalls,
        fuCalls,
        incCalls,
        willingClients,
        notWillingClients,
        noAnswerCalls,
      },
      counts: {
        newCalls: newCalls.length,
        fuCalls: fuCalls.length,
        incCalls: incCalls.length,
        willingClients: willingClients.length,
        notWillingClients: notWillingClients.length,
        noAnswerCalls: noAnswerCalls.length,
      },
      totalValuePipeline,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 32. GET /reports/follow-ups (Employee, Lead)
 * Open follow-ups (has follow_up_date and work_status not Completed), earliest first,
 * each with computed overdue flag.
 */
async function getFollowUps(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    let whereConditions = ["wr.follow_up_date IS NOT NULL", "wr.work_status != 'Completed'"];
    let params = [];

    if (isMD) {
      // MD sees all
    } else if (isLead) {
      whereConditions.push('s.team_id = ?');
      params.push(req.staff.teamId || req.staff.team_id || 0);
    } else {
      whereConditions.push('wr.employee_id = ?');
      params.push(callerId);
    }

    const [rows] = await pool.query(`
      SELECT 
        wr.id,
        wr.employee_id as employeeId,
        s.full_name as employeeName,
        wr.customer_lead_id as customerLeadId,
        DATE_FORMAT(wr.report_date, '%Y-%m-%d') as date,
        wr.customer_name as customer,
        wr.contact_phone as contact,
        wr.whatsapp_phone as whatsapp,
        wr.source,
        wr.project,
        wr.call_status as callStatus,
        wr.qualification,
        DATE_FORMAT(wr.follow_up_date, '%Y-%m-%d') as followUp,
        wr.work_status as workStatus,
        wr.next_action as nextAction,
        (wr.follow_up_date < CURDATE()) as overdue
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY wr.follow_up_date ASC, wr.id ASC
    `, params);

    const data = rows.map(r => ({
      id: String(r.id),
      employeeId: String(r.employeeId),
      employeeName: r.employeeName,
      customerLeadId: r.customerLeadId || null,
      date: r.date,
      customer: r.customer,
      contact: r.contact,
      whatsapp: r.whatsapp,
      source: r.source,
      project: r.project || '',
      callStatus: r.callStatus,
      qualification: r.qualification || '',
      followUp: r.followUp,
      workStatus: r.workStatus,
      nextAction: r.nextAction,
      overdue: Boolean(r.overdue),
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 33. GET /reports/next-entry-no (Employee)
 * Query: date. Count of entries by signed-in person on that date, plus 1.
 */
async function getNextEntryNo(req, res, next) {
  try {
    const employeeId = req.staff?.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [rows] = await pool.query(
      'SELECT COUNT(*) as count FROM work_reports WHERE employee_id = ? AND report_date = ?',
      [employeeId, date]
    );

    const nextEntryNo = (rows[0].count || 0) + 1;

    return res.status(200).json({
      success: true,
      data: {
        date,
        nextEntryNo,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /reports/export (MD only)
 * Exports filtered reports as CSV.
 */
async function exportReports(req, res, next) {
  try {
    const { from, to, employeeId, teamId, callStatus, source, project } = req.query;

    let whereConditions = ['1=1'];
    let params = [];

    if (from) {
      whereConditions.push('wr.report_date >= ?');
      params.push(from);
    }
    if (to) {
      whereConditions.push('wr.report_date <= ?');
      params.push(to);
    }
    if (employeeId) {
      whereConditions.push('wr.employee_id = ?');
      params.push(employeeId);
    }
    if (teamId) {
      whereConditions.push('s.team_id = ?');
      params.push(teamId);
    }
    if (callStatus) {
      whereConditions.push('wr.call_status = ?');
      params.push(callStatus);
    }
    if (source) {
      whereConditions.push('wr.source = ?');
      params.push(source);
    }
    if (project) {
      whereConditions.push('wr.project = ?');
      params.push(project);
    }

    const [rows] = await pool.query(`
      SELECT 
        wr.id,
        DATE_FORMAT(wr.report_date, '%Y-%m-%d') as Date,
        s.full_name as Employee,
        t.name as Team,
        wr.customer_name as Customer,
        wr.contact_phone as Contact,
        wr.source as Source,
        wr.call_type as CallType,
        wr.call_status as CallStatus,
        wr.project as Project,
        wr.budget as Budget,
        wr.plot as Plot,
        wr.stage as Stage,
        wr.qualification as Qualification,
        DATE_FORMAT(wr.follow_up_date, '%Y-%m-%d') as FollowUpDate,
        wr.site_visit as SiteVisit,
        wr.work_status as WorkStatus,
        wr.next_action as NextAction
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      LEFT JOIN teams t ON s.team_id = t.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY wr.report_date DESC, wr.id DESC
    `, params);

    // Build CSV
    const headers = [
      'ID', 'Date', 'Employee', 'Team', 'Customer', 'Contact', 'Source',
      'Call Type', 'Call Status', 'Project', 'Budget', 'Plot',
      'Stage', 'Qualification', 'Follow-up Date', 'Site Visit', 'Work Status', 'Next Action'
    ];

    const escapeCsv = val => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    let csv = headers.join(',') + '\n';
    for (const r of rows) {
      const line = [
        r.id,
        escapeCsv(r.Date),
        escapeCsv(r.Employee),
        escapeCsv(r.Team),
        escapeCsv(r.Customer),
        escapeCsv(r.Contact),
        escapeCsv(r.Source),
        escapeCsv(r.CallType),
        escapeCsv(r.CallStatus),
        escapeCsv(r.Project),
        escapeCsv(r.Budget),
        escapeCsv(r.Plot),
        escapeCsv(r.Stage),
        escapeCsv(r.Qualification),
        escapeCsv(r.FollowUpDate),
        escapeCsv(r.SiteVisit),
        escapeCsv(r.WorkStatus),
        escapeCsv(r.NextAction),
      ].join(',');
      csv += line + '\n';
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="lena_crm_reports_${Date.now()}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createReport,
  getReports,
  getReportByContact,
  getReportById,
  updateReport,
  getDailyRegister,
  getFollowUps,
  getNextEntryNo,
  exportReports,
};
