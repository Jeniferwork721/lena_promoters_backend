const { pool } = require('../config/db');

/**
 * 29. POST /reports (Lead, Employee)
 * Save one call entry with Section 7 conditional validations.
 */
async function createReport(req, res, next) {
  try {
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
      siteVisit = 'Not Planned',
      workStatus = 'Pending',
      requirement,
      nextAction,
      remarks,
    } = req.body;

    // 1. Mandatory base fields check
    const errors = {};
    if (!date) errors.date = 'Date is required';
    if (!customer || !customer.trim()) errors.customer = 'Customer name is required';
    if (!contact || !contact.trim()) errors.contact = 'Customer contact number is required';
    if (!whatsapp || !whatsapp.trim()) errors.whatsapp = 'Customer WhatsApp number is required';
    if (!source || !source.trim()) errors.source = 'Lead source is required';
    if (!callType || !callType.trim()) errors.callType = 'Call type is required';
    if (!callStatus || !callStatus.trim()) errors.callStatus = 'Call status is required';
    if (!workStatus || !workStatus.trim()) errors.workStatus = 'Work status is required';
    if (!nextAction || !nextAction.trim()) errors.nextAction = 'Next action is required';

    // Phone format checks
    const cleanContact = (contact || '').replace(/[^0-9]/g, '');
    const cleanWhatsapp = (whatsapp || '').replace(/[^0-9]/g, '');

    if (cleanContact && !/^[6-9]\d{9}$/.test(cleanContact)) {
      errors.contact = 'Contact phone must match 10 digits starting with 6 to 9';
    }
    if (cleanWhatsapp && !/^[6-9]\d{9}$/.test(cleanWhatsapp)) {
      errors.whatsapp = 'WhatsApp phone must match 10 digits starting with 6 to 9';
    }

    // 2. Conditional Validations based on callStatus
    const isConnectedWilling = (callStatus || '').trim() === 'Connected - Willing';
    const isCallBackRequested = (callStatus || '').trim() === 'Call Back Requested';

    if (isConnectedWilling) {
      if (!project || !project.trim()) errors.project = 'Project is required for Connected - Willing';
      if (!purpose || !purpose.trim()) errors.purpose = 'Purpose is required for Connected - Willing';
      if (!payment || !payment.trim()) errors.payment = 'Payment mode is required for Connected - Willing';
      if (!plot || !plot.trim()) errors.plot = 'Plot size is required for Connected - Willing';
      if (!budget || !budget.trim()) errors.budget = 'Budget is required for Connected - Willing';
      if (!stage || !stage.trim()) errors.stage = 'Stage is required for Connected - Willing';
      if (!qualification || !qualification.trim()) errors.qualification = 'Qualification is required for Connected - Willing';
      if (!requirement || !requirement.trim()) errors.requirement = 'Requirement details are required for Connected - Willing';
      if (!followUp) errors.followUp = 'Follow-up date is required for Connected - Willing';
    }

    if (isCallBackRequested && !followUp) {
      errors.followUp = 'Follow-up date is required for Call Back Requested';
    }

    // FollowUp cannot be earlier than date
    if (followUp && date && new Date(followUp) < new Date(date)) {
      errors.followUp = 'Follow-up date cannot be earlier than report date';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed. Please fill in all required fields.',
        errors,
      });
    }

    // For any other status, property fields are ignored and saved empty
    const finalProject = isConnectedWilling ? (project || '').trim() : '';
    const finalOffer = isConnectedWilling ? (offer || '').trim() : '';
    const finalPropertyType = isConnectedWilling ? (propertyType || '').trim() : '';
    const finalPurpose = isConnectedWilling ? (purpose || '').trim() : '';
    const finalPayment = isConnectedWilling ? (payment || '').trim() : '';
    const finalPlot = isConnectedWilling ? (plot || '').trim() : '';
    const finalBudget = isConnectedWilling ? (budget || '').trim() : '';
    const finalStage = isConnectedWilling ? (stage || '').trim() : (stage || '').trim();
    const finalQual = isConnectedWilling ? (qualification || '').trim() : (qualification || '').trim();
    const finalReq = isConnectedWilling ? (requirement || '').trim() : (requirement || '').trim();

    const [insertResult] = await pool.query(`
      INSERT INTO work_reports (
        employee_id, customer_lead_id, report_date, task_desc, customer_name,
        contact_phone, whatsapp_phone, source, call_type, call_status,
        call_time, call_duration, call_notes, project, offer,
        property_type, purpose, payment, plot, budget,
        stage, qualification, follow_up_date, site_visit, work_status,
        requirement, next_action, remarks, calls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      employeeId,
      customerLeadId || null,
      date,
      taskDesc || null,
      customer.trim(),
      cleanContact,
      cleanWhatsapp,
      source.trim(),
      callType.trim(),
      callStatus.trim(),
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
      siteVisit,
      workStatus,
      finalReq,
      nextAction.trim(),
      remarks || null,
    ]);

    const reportId = insertResult.insertId;

    return res.status(201).json({
      success: true,
      message: 'Call entry recorded successfully.',
      data: {
        id: String(reportId),
        employeeId: String(employeeId),
        customerLeadId: customerLeadId || null,
        date,
        customer: customer.trim(),
        contact: cleanContact,
        whatsapp: cleanWhatsapp,
        callStatus: callStatus.trim(),
        workStatus,
        calls: 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 30. GET /reports (Scoped: MD all, Lead own team, Employee own)
 * Filters: employeeId, teamId, callStatus, from, to, source, project, qualification, siteVisit, workStatus, hasFollowUp=true, q.
 * Order: Newest first.
 */
async function getReports(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const {
      employeeId,
      teamId,
      callStatus,
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
        whereConditions.push('wr.employee_id = ?');
        params.push(employeeId);
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
        whereConditions.push('wr.employee_id = ?');
        params.push(employeeId);
      }
    } else {
      // Employee sees only their own reports
      whereConditions.push('wr.employee_id = ?');
      params.push(callerId);
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
        wr.created_at as createdAt
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      LEFT JOIN teams t ON s.team_id = t.id
      ${whereClause}
      ORDER BY wr.report_date DESC, wr.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const data = rows.map(r => ({
      id: String(r.id),
      employeeId: String(r.employeeId),
      employeeName: r.employeeName,
      teamId: r.teamId ? String(r.teamId) : null,
      teamName: r.teamName || null,
      customerLeadId: r.customerLeadId || null,
      date: r.date,
      taskDesc: r.taskDesc || '',
      customer: r.customer,
      contact: r.contact,
      whatsapp: r.whatsapp,
      source: r.source,
      callType: r.callType,
      callStatus: r.callStatus,
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
      qualification: r.qualification || '',
      followUp: r.followUp || null,
      siteVisit: r.siteVisit,
      workStatus: r.workStatus,
      requirement: r.requirement || '',
      nextAction: r.nextAction,
      remarks: r.remarks || '',
      calls: r.calls,
      createdAt: r.createdAt,
    }));

    return res.status(200).json({
      success: true,
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
    const reportId = req.params.id;
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = String(req.staff?.id || '');

    const [rows] = await pool.query(`
      SELECT 
        wr.*,
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
        id: String(r.id),
        employeeId: String(r.employee_id),
        employeeName: r.employeeName,
        teamId: r.teamId ? String(r.teamId) : null,
        teamName: r.teamName || null,
        customerLeadId: r.customer_lead_id || null,
        date: r.report_date ? r.report_date.toISOString().slice(0, 10) : '',
        taskDesc: r.task_desc || '',
        customer: r.customer_name,
        contact: r.contact_phone,
        whatsapp: r.whatsapp_phone,
        source: r.source,
        callType: r.call_type,
        callStatus: r.call_status,
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
        siteVisit: r.site_visit,
        workStatus: r.work_status,
        requirement: r.requirement || '',
        nextAction: r.next_action,
        remarks: r.remarks || '',
        calls: r.calls,
        createdAt: r.created_at,
      },
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
  getReportById,
  getFollowUps,
  getNextEntryNo,
  exportReports,
};
