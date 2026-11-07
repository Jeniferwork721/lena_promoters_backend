const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { sendStaffWelcomeEmail } = require('../services/email.service');
const { generateNextStaffId } = require('./crmTeam.controller');

/**
 * 16. GET /employees (MD all, Lead own team)
 * Filters: teamId, leadId, unassigned=true, q (name or phone).
 * Pagination: page (default 1), limit (default 50, max 200).
 */
async function getEmployees(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { teamId, leadId, unassigned, q } = req.query;

    let whereConditions = ['s.is_active = 1', "s.role NOT IN ('ADMIN', 'SUPER_ADMIN')"];
    let params = [];

    // Role-based scoping
    if (isLead && !isMD) {
      // Lead can only see members of their own team
      whereConditions.push('s.team_id = ?');
      params.push(req.staff.teamId || req.staff.team_id || 0);
    } else if (isMD) {
      if (teamId) {
        whereConditions.push('s.team_id = ?');
        params.push(teamId);
      } else if (leadId) {
        whereConditions.push('t.lead_id = ?');
        params.push(leadId);
      } else if (unassigned === 'true' || unassigned === true) {
        whereConditions.push('s.team_id IS NULL');
      }
    }

    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      whereConditions.push('(s.full_name LIKE ? OR s.phone_number LIKE ? OR s.employee_id LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Total count query
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total 
      FROM staff_users s
      LEFT JOIN teams t ON s.team_id = t.id
      ${whereClause}
    `, params);
    const total = countResult[0].total;

    // Data query
    const [rows] = await pool.query(`
      SELECT 
        s.id,
        s.employee_id as employeeId,
        s.full_name as name,
        s.phone_number as phone,
        s.email,
        s.role,
        s.team_id as teamId,
        t.name as teamName,
        t.lead_id as leadId,
        lead_user.full_name as leadName,
        s.plain_password,
        (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
        s.created_at as createdAt
      FROM staff_users s
      LEFT JOIN teams t ON s.team_id = t.id
      LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
      ${whereClause}
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const data = rows.map(r => ({
      id: String(r.id),
      employeeId: r.employeeId,
      name: r.name,
      phone: r.phone,
      email: r.email,
      role: 'employee',
      teamId: r.teamId ? String(r.teamId) : null,
      teamName: r.teamName || null,
      leadId: r.leadId ? String(r.leadId) : null,
      leadName: r.leadName || null,
      hasAccount: Boolean(r.hasAccount),
      ...(isMD ? { password: r.plain_password || 'Lena@1234' } : {}),
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
 * 17. POST /employees (MD only)
 * Add an employee, optionally assigned to a lead, set temporary password 'Lena@1234', and dispatch email.
 * Body: { name, phone, email, leadId, teamId, role, branch }
 */
async function createEmployee(req, res, next) {
  try {
    const { name, phone, email, leadId, teamId, role, branch } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required.',
        errors: { name: 'Name is required' },
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required.',
        errors: { phone: 'Phone is required' },
      });
    }

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const cleanEmail = email ? email.trim() : `${cleanPhone}@lenapromoters.com`;
    const cleanBranch = branch ? branch.trim() : 'Karaikudi – Head Office';
    const cleanRole = role ? role.trim().toUpperCase() : 'TELECALLER';

    // Phone format check: 10 digits starting with 6-9
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be a valid 10-digit Indian mobile starting with 6 to 9.',
        errors: { phone: 'Invalid mobile number' },
      });
    }

    // Name uniqueness check (case-insensitive across staff)
    const [nameExists] = await pool.query(
      'SELECT id FROM staff_users WHERE LOWER(full_name) = LOWER(?) LIMIT 1',
      [cleanName]
    );
    if (nameExists.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Someone with this name already exists. Add a surname or initial.',
        errors: { name: 'Duplicate name' },
      });
    }

    // Phone uniqueness check across all staff
    const [phoneExists] = await pool.query(
      'SELECT id FROM staff_users WHERE phone_number = ? LIMIT 1',
      [cleanPhone]
    );
    if (phoneExists.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Phone number is already registered across staff.',
        errors: { phone: 'Already registered' },
      });
    }

    // Resolve team assignment if leadId or teamId provided
    let targetTeamId = teamId || null;
    let targetLeadId = leadId || null;

    if (leadId && !targetTeamId) {
      const [leadTeam] = await pool.query('SELECT id FROM teams WHERE lead_id = ? LIMIT 1', [leadId]);
      if (leadTeam.length > 0) {
        targetTeamId = leadTeam[0].id;
      }
    } else if (targetTeamId && !targetLeadId) {
      const [teamRows] = await pool.query('SELECT lead_id FROM teams WHERE id = ? LIMIT 1', [targetTeamId]);
      if (teamRows.length > 0) {
        targetLeadId = teamRows[0].lead_id;
      }
    }

    // Generate credentials (Common temporary password 'Lena@1234')
    const employeeId = await generateNextStaffId();
    const tempPassword = 'Lena@1234';
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const [insertResult] = await pool.query(
      `INSERT INTO staff_users 
       (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, team_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch, cleanRole, targetTeamId]
    );
    const newStaffId = insertResult.insertId;

    // Dispatch welcome email with credentials
    await sendStaffWelcomeEmail(cleanEmail, cleanName, tempPassword, 'Employee', employeeId);

    return res.status(201).json({
      success: true,
      message: 'Employee created successfully. Welcome email dispatched.',
      data: {
        id: String(newStaffId),
        employeeId,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        role: 'employee',
        teamId: targetTeamId ? String(targetTeamId) : null,
        leadId: targetLeadId ? String(targetLeadId) : null,
        hasAccount: true,
        password: tempPassword,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 18. GET /employees/:id (MD, Lead of that team, or the employee)
 */
async function getEmployeeById(req, res, next) {
  try {
    const employeeId = req.params.id;
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const callerId = String(req.staff?.id || '');

    const [rows] = await pool.query(`
      SELECT 
        s.id,
        s.employee_id as employeeId,
        s.full_name as name,
        s.phone_number as phone,
        s.email,
        s.role,
        s.team_id as teamId,
        t.name as teamName,
        t.lead_id as leadId,
        lead_user.full_name as leadName,
        s.plain_password,
        (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
        s.created_at as createdAt
      FROM staff_users s
      LEFT JOIN teams t ON s.team_id = t.id
      LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
      WHERE s.id = ? AND s.is_active = 1 LIMIT 1
    `, [employeeId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found.',
      });
    }

    const employee = rows[0];

    // Authorization check
    const isSelf = callerId === String(employee.id);
    const isLeadOfTeam = String(employee.leadId || '') === callerId;

    if (!isMD && !isSelf && !isLeadOfTeam) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this employee.',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: String(employee.id),
        employeeId: employee.employeeId,
        name: employee.name,
        phone: employee.phone,
        email: employee.email,
        role: 'employee',
        teamId: employee.teamId ? String(employee.teamId) : null,
        teamName: employee.teamName || null,
        leadId: employee.leadId ? String(employee.leadId) : null,
        leadName: employee.leadName || null,
        hasAccount: Boolean(employee.hasAccount),
        ...(isMD ? { password: employee.plain_password || 'Lena@1234' } : {}),
        createdAt: employee.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 19. PATCH /employees/:id/assignment (MD only)
 * Assign, move or unassign an employee.
 * Body: { leadId: "..." } or { leadId: null }
 * Business rule: when an employee moves to a new lead, the server must also change the leadId
 * of all that employee's open tasks (status not Completed) to the new lead.
 */
async function updateEmployeeAssignment(req, res, next) {
  try {
    const employeeId = req.params.id;
    const { leadId, teamId } = req.body;

    const [empRows] = await pool.query('SELECT * FROM staff_users WHERE id = ? LIMIT 1', [employeeId]);
    if (empRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    let newTeamId = null;
    let newLeadId = null;

    if (leadId) {
      const [teamRows] = await pool.query('SELECT id, lead_id FROM teams WHERE lead_id = ? LIMIT 1', [leadId]);
      if (teamRows.length > 0) {
        newTeamId = teamRows[0].id;
        newLeadId = teamRows[0].lead_id;
      }
    } else if (teamId) {
      const [teamRows] = await pool.query('SELECT id, lead_id FROM teams WHERE id = ? LIMIT 1', [teamId]);
      if (teamRows.length > 0) {
        newTeamId = teamRows[0].id;
        newLeadId = teamRows[0].lead_id;
      }
    }

    // 1. Update staff_users team_id
    await pool.query('UPDATE staff_users SET team_id = ? WHERE id = ?', [newTeamId, employeeId]);

    // 2. Business rule: change lead_id of all open tasks (status not Completed) to new lead
    if (newLeadId) {
      await pool.query(
        "UPDATE tasks SET lead_id = ? WHERE employee_id = ? AND status != 'Completed'",
        [newLeadId, employeeId]
      );
    } else {
      // If unassigned, clear lead_id on open tasks
      await pool.query(
        "UPDATE tasks SET lead_id = NULL WHERE employee_id = ? AND status != 'Completed'",
        [employeeId]
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Employee assignment updated successfully.',
      data: {
        id: String(employeeId),
        teamId: newTeamId ? String(newTeamId) : null,
        leadId: newLeadId ? String(newLeadId) : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEmployees,
  createEmployee,
  getEmployeeById,
  updateEmployeeAssignment,
};
