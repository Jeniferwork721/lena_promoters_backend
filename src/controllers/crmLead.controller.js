const { pool } = require('../config/db');

/**
 * 20. GET /customer-leads (Scoped: MD all, Lead own team, Employee own)
 * Filters: leadId, employeeId, waiting=true, called=true/false, source, project, q, page, limit.
 */
async function getCustomerLeads(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { leadId, employeeId, waiting, called, source, project, q } = req.query;

    let whereConditions = ['1=1'];
    let params = [];

    // Role-based scoping
    if (isMD) {
      if (leadId) {
        whereConditions.push('cl.lead_id = ?');
        params.push(leadId);
      }
      if (employeeId) {
        whereConditions.push('cl.employee_id = ?');
        params.push(employeeId);
      }
    } else if (isLead) {
      // Lead sees own team's leads
      whereConditions.push('cl.lead_id = ?');
      params.push(callerId);

      if (employeeId) {
        whereConditions.push('cl.employee_id = ?');
        params.push(employeeId);
      }
    } else {
      // Employee sees only their own assigned leads
      whereConditions.push('cl.employee_id = ?');
      params.push(callerId);
    }

    // Filter: waiting=true (team assigned, no person assigned yet)
    if (waiting === 'true' || waiting === true) {
      whereConditions.push('cl.lead_id IS NOT NULL AND cl.employee_id IS NULL');
    }

    if (source && source.trim()) {
      whereConditions.push('cl.source = ?');
      params.push(source.trim());
    }

    if (project && project.trim()) {
      whereConditions.push('cl.project = ?');
      params.push(project.trim());
    }

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      whereConditions.push('(cl.name LIKE ? OR cl.phone LIKE ?)');
      params.push(searchTerm, searchTerm);
    }

    // Filter: called=true / called=false
    if (called === 'true' || called === true) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM work_reports wr 
        WHERE wr.customer_lead_id = cl.id OR wr.contact_phone = cl.phone
      )`);
    } else if (called === 'false' || called === false) {
      whereConditions.push(`NOT EXISTS (
        SELECT 1 FROM work_reports wr 
        WHERE wr.customer_lead_id = cl.id OR wr.contact_phone = cl.phone
      )`);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Total count query
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM customer_leads cl ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Data query with subquery for called flag
    const [rows] = await pool.query(`
      SELECT 
        cl.id,
        cl.name,
        cl.phone,
        cl.source,
        cl.project,
        cl.note,
        cl.lead_id as leadId,
        lead_user.full_name as leadName,
        cl.employee_id as employeeId,
        emp_user.full_name as employeeName,
        DATE_FORMAT(cl.assigned_at, '%Y-%m-%d') as assignedAt,
        cl.created_at as createdAt,
        EXISTS (
          SELECT 1 FROM work_reports wr 
          WHERE wr.customer_lead_id = cl.id OR wr.contact_phone = cl.phone
        ) as isCalled
      FROM customer_leads cl
      LEFT JOIN staff_users lead_user ON cl.lead_id = lead_user.id
      LEFT JOIN staff_users emp_user ON cl.employee_id = emp_user.id
      ${whereClause}
      ORDER BY cl.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const data = rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      source: r.source || '',
      project: r.project || '',
      note: r.note || '',
      leadId: r.leadId ? String(r.leadId) : null,
      leadName: r.leadName || null,
      employeeId: r.employeeId ? String(r.employeeId) : null,
      employeeName: r.employeeName || null,
      assignedAt: r.assignedAt || null,
      called: Boolean(r.isCalled),
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
 * 21. POST /customer-leads (MD or Lead)
 * Add one customer lead.
 * Rule: Customer mobile numbers must be globally unique across CRM.
 */
async function createCustomerLead(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    const { name, phone, source, project, note, leadId: reqLeadId, employeeId: reqEmployeeId } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required.',
        errors: { name: 'Name is required' },
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Customer phone number is required.',
        errors: { phone: 'Phone is required' },
      });
    }

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[^0-9]/g, '');

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be 10 digits starting with 6 to 9.',
        errors: { phone: 'Phone must be 10 digits starting with 6 to 9' },
      });
    }

    // Check duplicate customer phone across CRM (User requirement #3: one mobile number one customer)
    const [existing] = await pool.query(
      'SELECT id, name FROM customer_leads WHERE phone = ? LIMIT 1',
      [cleanPhone]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Customer with phone ${cleanPhone} already exists (${existing[0].name}). Duplicate customer phone numbers are not allowed.`,
        errors: { phone: 'Already registered' },
      });
    }

    // Determine leadId and employeeId
    let finalLeadId = null;
    let finalEmployeeId = null;

    if (isLead) {
      finalLeadId = callerId;
      if (reqEmployeeId) {
        finalEmployeeId = reqEmployeeId;
      }
    } else if (isMD) {
      finalLeadId = reqLeadId || null;
      finalEmployeeId = reqEmployeeId || null;
    }

    const leadIdStr = `cl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const assignedAt = finalEmployeeId ? new Date() : (finalLeadId ? new Date() : null);

    await pool.query(
      `INSERT INTO customer_leads (id, name, phone, source, project, note, lead_id, employee_id, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadIdStr,
        cleanName,
        cleanPhone,
        source ? source.trim() : null,
        project ? project.trim() : null,
        note ? note.trim() : null,
        finalLeadId,
        finalEmployeeId,
        assignedAt,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Customer lead created successfully.',
      data: {
        id: leadIdStr,
        name: cleanName,
        phone: cleanPhone,
        source: source || '',
        project: project || '',
        note: note || '',
        leadId: finalLeadId ? String(finalLeadId) : null,
        employeeId: finalEmployeeId ? String(finalEmployeeId) : null,
        assignedAt: assignedAt ? assignedAt.toISOString().slice(0, 10) : null,
        called: false,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 22. POST /customer-leads/bulk (MD only)
 * Bulk import and distribute customer leads among team leads.
 * Section 5.2 Fair Distribution Rule:
 * With n valid rows and k team leads: each gets floor(n / k).
 * Leftover n mod k rows go one each to team leads with fewest existing leads.
 * Entire batch is executed within a database transaction.
 */
async function bulkImportCustomerLeads(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const { mode = 'all', teamLeadIds = [], rows = [] } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No lead rows provided for bulk import.',
      });
    }

    // 1. Resolve target team leads
    let targetLeads = [];
    if (mode === 'all') {
      const [leads] = await connection.query(`
        SELECT s.id, s.full_name as name, t.name as teamName,
               (SELECT COUNT(*) FROM customer_leads cl WHERE cl.lead_id = s.id) as currentLeads
        FROM staff_users s
        JOIN teams t ON t.lead_id = s.id
        WHERE s.is_active = 1
        ORDER BY currentLeads ASC, s.id ASC
      `);
      targetLeads = leads;
    } else if (mode === 'selected' || mode === 'one') {
      const ids = mode === 'one' && teamLeadIds.length > 0 ? [teamLeadIds[0]] : teamLeadIds;
      if (ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide at least one team lead for distribution.',
        });
      }
      const [leads] = await connection.query(`
        SELECT s.id, s.full_name as name, t.name as teamName,
               (SELECT COUNT(*) FROM customer_leads cl WHERE cl.lead_id = s.id) as currentLeads
        FROM staff_users s
        JOIN teams t ON t.lead_id = s.id
        WHERE s.id IN (?) AND s.is_active = 1
        ORDER BY currentLeads ASC, s.id ASC
      `, [ids]);
      targetLeads = leads;
    }

    if (targetLeads.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active team leads found to distribute leads.',
      });
    }

    // 2. Fetch all existing phones to avoid duplicates
    const [existingPhoneRows] = await connection.query('SELECT phone FROM customer_leads');
    const existingPhones = new Set(existingPhoneRows.map(p => p.phone));
    const batchPhones = new Set();

    const validRows = [];
    const skipped = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNo = i + 1;
      const name = (row.name || '').trim();
      let phone = String(row.phone || '').replace(/[^0-9]/g, '');

      // Strip +91 if present
      if (phone.length === 12 && phone.startsWith('91')) {
        phone = phone.substring(2);
      }

      if (!name) {
        skipped.push({ line: lineNo, name: name || 'Unknown', why: 'Name is missing' });
        continue;
      }

      if (!/^[6-9]\d{9}$/.test(phone)) {
        skipped.push({ line: lineNo, name, why: 'Phone must be 10 digits starting with 6 to 9' });
        continue;
      }

      if (existingPhones.has(phone)) {
        skipped.push({ line: lineNo, name, why: 'Phone already exists in database' });
        continue;
      }

      if (batchPhones.has(phone)) {
        skipped.push({ line: lineNo, name, why: 'Phone repeated inside the same upload' });
        continue;
      }

      batchPhones.add(phone);
      validRows.push({
        name,
        phone,
        project: (row.project || '').trim(),
        source: (row.source || '').trim(),
        note: (row.note || '').trim(),
      });
    }

    if (validRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid rows to import.',
        data: {
          imported: 0,
          skipped,
          distribution: [],
        },
      });
    }

    // 3. Fair Distribution Algorithm (Section 5.2)
    const n = validRows.length;
    const k = targetLeads.length;
    const baseShare = Math.floor(n / k);
    const leftover = n % k;

    // Create distribution buckets
    // Sort leads by current leads count ascending so leftover goes to those with fewest leads
    targetLeads.sort((a, b) => a.currentLeads - b.currentLeads);

    const leadBuckets = targetLeads.map((lead, idx) => ({
      leadId: lead.id,
      teamName: lead.teamName,
      capacity: baseShare + (idx < leftover ? 1 : 0),
      assignedRows: [],
    }));

    // Deal out rows in round-robin order
    let rowIdx = 0;
    while (rowIdx < n) {
      for (const bucket of leadBuckets) {
        if (bucket.assignedRows.length < bucket.capacity && rowIdx < n) {
          bucket.assignedRows.push(validRows[rowIdx]);
          rowIdx++;
        }
      }
    }

    // 4. Execute atomic transaction
    await connection.beginTransaction();

    const distributionSummary = [];
    for (const bucket of leadBuckets) {
      if (bucket.assignedRows.length > 0) {
        for (const row of bucket.assignedRows) {
          const leadIdStr = `cl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          await connection.query(
            `INSERT INTO customer_leads (id, name, phone, source, project, note, lead_id, employee_id, assigned_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NOW())`,
            [leadIdStr, row.name, row.phone, row.source || null, row.project || null, row.note || null, bucket.leadId]
          );
        }
      }
      distributionSummary.push({
        leadId: String(bucket.leadId),
        teamName: bucket.teamName,
        added: bucket.assignedRows.length,
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Successfully imported ${n} customer leads across ${k} teams.`,
      data: {
        imported: n,
        skipped,
        distribution: distributionSummary,
      },
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
}

/**
 * 23. PATCH /customer-leads/:id/team-lead (MD only)
 * Move to another team lead. Server clears employeeId.
 * Body: { leadId }
 */
async function updateCustomerLeadTeamLead(req, res, next) {
  try {
    const leadIdStr = req.params.id;
    const { leadId } = req.body;

    if (!leadId) {
      return res.status(400).json({
        success: false,
        message: 'leadId is required.',
      });
    }

    const [leadCheck] = await pool.query('SELECT id FROM staff_users WHERE id = ? LIMIT 1', [leadId]);
    if (leadCheck.length === 0) {
      return res.status(404).json({ success: false, message: 'Target team lead not found.' });
    }

    await pool.query(
      'UPDATE customer_leads SET lead_id = ?, employee_id = NULL, assigned_at = NOW() WHERE id = ?',
      [leadId, leadIdStr]
    );

    return res.status(200).json({
      success: true,
      message: 'Customer lead moved to new team lead. Employee assignment cleared.',
      data: {
        id: leadIdStr,
        leadId: String(leadId),
        employeeId: null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 24. PATCH /customer-leads/:id/employee (Lead only)
 * Give to a person in their team or to themselves.
 * Body: { employeeId } (or null to take back)
 */
async function updateCustomerLeadEmployee(req, res, next) {
  try {
    const leadIdStr = req.params.id;
    const { employeeId } = req.body;
    const callerId = req.staff?.id;
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());

    const [leadRows] = await pool.query('SELECT * FROM customer_leads WHERE id = ? LIMIT 1', [leadIdStr]);
    if (leadRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer lead not found.' });
    }

    const lead = leadRows[0];

    // Must be lead of that team or MD
    if (!isMD && String(lead.lead_id) !== String(callerId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only assign leads from your own team.',
      });
    }

    // If assigning to employee, verify employee belongs to this team or is caller self
    if (employeeId) {
      const [empRows] = await pool.query('SELECT id, team_id FROM staff_users WHERE id = ? LIMIT 1', [employeeId]);
      if (empRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Employee not found.' });
      }
    }

    await pool.query(
      'UPDATE customer_leads SET employee_id = ?, assigned_at = ? WHERE id = ?',
      [employeeId ? employeeId : null, employeeId ? new Date() : null, leadIdStr]
    );

    return res.status(200).json({
      success: true,
      message: employeeId ? 'Customer lead assigned to employee.' : 'Customer lead unassigned back to team.',
      data: {
        id: leadIdStr,
        employeeId: employeeId ? String(employeeId) : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 25. POST /customer-leads/split (Lead only)
 * Share all "waiting" leads of the lead's team equally among chosen members.
 * Body: { employeeIds: ["e1", "e2"] }
 */
async function splitCustomerLeads(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const callerId = req.staff?.id;
    const { employeeIds = [] } = req.body;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide employeeIds to distribute waiting leads.',
      });
    }

    // 1. Fetch all waiting leads of this team
    const [waitingLeads] = await connection.query(
      'SELECT id FROM customer_leads WHERE lead_id = ? AND employee_id IS NULL ORDER BY id ASC',
      [callerId]
    );

    if (waitingLeads.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No waiting customer leads to split.',
        data: {
          assigned: 0,
          distribution: employeeIds.map(eId => ({ employeeId: String(eId), added: 0 })),
        },
      });
    }

    // 2. Fetch current lead counts for chosen employees to give leftover to fewest leads
    const [empCounts] = await connection.query(`
      SELECT s.id, (SELECT COUNT(*) FROM customer_leads cl WHERE cl.employee_id = s.id) as currentCount
      FROM staff_users s
      WHERE s.id IN (?)
      ORDER BY currentCount ASC, s.id ASC
    `, [employeeIds]);

    const n = waitingLeads.length;
    const k = empCounts.length;
    const baseShare = Math.floor(n / k);
    const leftover = n % k;

    const buckets = empCounts.map((emp, idx) => ({
      employeeId: emp.id,
      capacity: baseShare + (idx < leftover ? 1 : 0),
      leadIds: [],
    }));

    let leadIdx = 0;
    while (leadIdx < n) {
      for (const bucket of buckets) {
        if (bucket.leadIds.length < bucket.capacity && leadIdx < n) {
          bucket.leadIds.push(waitingLeads[leadIdx].id);
          leadIdx++;
        }
      }
    }

    // 3. Update records in transaction
    await connection.beginTransaction();

    const distribution = [];
    for (const b of buckets) {
      if (b.leadIds.length > 0) {
        await connection.query(
          'UPDATE customer_leads SET employee_id = ?, assigned_at = NOW() WHERE id IN (?)',
          [b.employeeId, b.leadIds]
        );
      }
      distribution.push({
        employeeId: String(b.employeeId),
        added: b.leadIds.length,
      });
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: `Assigned ${n} waiting leads among ${k} team members.`,
      data: {
        assigned: n,
        distribution,
      },
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
}

/**
 * DELETE /customer-leads/:id (Lead, MD)
 * Delete a single customer lead record.
 */
async function deleteCustomerLead(req, res, next) {
  try {
    const leadId = req.params.id;
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'Lead ID is required.' });
    }

    const [result] = await pool.query('DELETE FROM customer_leads WHERE id = ?', [leadId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer lead not found or already deleted.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Customer lead deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCustomerLeads,
  createCustomerLead,
  bulkImportCustomerLeads,
  updateCustomerLeadTeamLead,
  updateCustomerLeadEmployee,
  splitCustomerLeads,
  deleteCustomerLead,
};
