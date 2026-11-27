const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { sendStaffWelcomeEmail } = require('../services/email.service');
const { generateNextStaffId } = require('./crmTeam.controller');
const { getManagedTeamIds } = require('../utils/teamScope');

function parseJsonSafe(val, fallback = []) {
  if (!val) return fallback;
  if (Array.isArray(val) || (typeof val === 'object' && val !== null)) return val;
  try {
    return JSON.parse(val);
  } catch (_) {
    return fallback;
  }
}

/**
 * 16. GET /employees (MD all, Lead own team)
 * Filters: teamId, leadId, unassigned=true, q (name or phone).
 * Pagination: page (default 1), limit (default 50, max 200).
 */
async function getEmployees(req, res, next) {
  try {
    const perms = Array.isArray(req.staff?.permissions)
      ? req.staff.permissions
      : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);
    const roleUpper = (req.staff?.role || '').toUpperCase();
    const isMD = req.staff && (
      ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) ||
      perms.includes('*') ||
      perms.includes('employees_manage') ||
      perms.includes('reports_employee') ||
      perms.includes('reports_all')
    );
    const isLead = !isMD && req.staff && (['LEAD', 'TEAM_LEAD'].includes(roleUpper) || perms.includes('reports_own_team'));

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { teamId, leadId, unassigned, q } = req.query;

    let whereConditions = ['s.is_active = 1'];
    let params = [];

    // Role-based scoping
    const managedTeamIds = await getManagedTeamIds(req.staff?.id, req.staff);
    const isMultiTeamManager = !isMD && managedTeamIds.length > 0;

    if (isMD) {
      if (teamId) {
        whereConditions.push('s.team_id = ?');
        params.push(teamId);
      } else if (leadId) {
        whereConditions.push('t.lead_id = ?');
        params.push(leadId);
      } else if (unassigned === 'true' || unassigned === true) {
        whereConditions.push('s.team_id IS NULL');
      }
    } else if (isMultiTeamManager) {
      if (teamId && teamId !== 'ALL_MANAGED' && managedTeamIds.includes(Number(teamId))) {
        whereConditions.push('s.team_id = ?');
        params.push(Number(teamId));
      } else {
        whereConditions.push('(s.team_id IN (?) OR s.id = ?)');
        params.push(managedTeamIds, req.staff?.id);
      }
    } else if (isLead) {
      // Lead can only see members of their own team
      whereConditions.push('s.team_id = ?');
      params.push(req.staff.teamId || req.staff.team_id || 0);
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
    let rows = [];
    try {
      [rows] = await pool.query(`
        SELECT 
          s.id,
          s.employee_id as employeeId,
          s.full_name as name,
          s.phone_number as phone,
          s.email,
          s.role,
          s.designation as designation,
          s.department as department,
          s.branch_location as branch,
          s.permissions as permissions,
          s.team_id as teamId,
          s.managed_teams as managedTeams,
          t.name as teamName,
          t.lead_id as leadId,
          lead_user.full_name as leadName,
          s.plain_password,
          (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
          s.must_change_password as mustChangePassword,
          s.is_profile_completed as isProfileCompleted,
          s.dob as dob,
          s.marriage_date as marriageDate,
          s.personal_phone as personalPhone,
          s.address as address,
          s.marital_status as maritalStatus,
          s.blood_group as bloodGroup,
          s.aadhar_no as aadharNo,
          s.pan_no as panNo,
          s.working_hours as workingHours,
          s.personal_email as personalEmail,
          s.aadhar_doc as aadharDoc,
          s.pan_doc as panDoc,
          s.acting_delegate_id as actingDelegateId,
          s.acting_delegate_name as actingDelegateName,
          s.acting_delegate_until as actingDelegateUntil,
          s.created_at as createdAt
        FROM staff_users s
        LEFT JOIN teams t ON s.team_id = t.id
        LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
        ${whereClause}
        ORDER BY s.id DESC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset]);
    } catch (err) {
      console.warn('getEmployees primary query failed, falling back:', err.message);
      [rows] = await pool.query(`
        SELECT 
          s.id,
          s.employee_id as employeeId,
          s.full_name as name,
          s.phone_number as phone,
          s.email,
          s.role,
          s.branch_location as branch,
          s.team_id as teamId,
          t.name as teamName,
          t.lead_id as leadId,
          lead_user.full_name as leadName,
          s.plain_password,
          (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
          s.must_change_password as mustChangePassword,
          s.is_profile_completed as isProfileCompleted,
          s.dob as dob,
          s.marriage_date as marriageDate,
          s.personal_phone as personalPhone,
          s.address as address,
          s.marital_status as maritalStatus,
          s.blood_group as bloodGroup,
          s.aadhar_no as aadharNo,
          s.pan_no as panNo,
          s.working_hours as workingHours,
          s.personal_email as personalEmail,
          s.aadhar_doc as aadharDoc,
          s.pan_doc as panDoc,
          s.acting_delegate_id as actingDelegateId,
          s.acting_delegate_name as actingDelegateName,
          s.acting_delegate_until as actingDelegateUntil,
          s.created_at as createdAt
        FROM staff_users s
        LEFT JOIN teams t ON s.team_id = t.id
        LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
        ${whereClause}
        ORDER BY s.id DESC
        LIMIT ? OFFSET ?
      `, [...params, limit, offset]);
    }

    const data = rows.map(r => ({
      id: String(r.id),
      employeeId: r.employeeId,
      name: r.name,
      phone: r.phone,
      email: r.email,
      role: r.role || 'employee',
      designation: r.designation || r.role || 'Sales Executive',
      department: r.department || null,
      branch: r.branch || 'Karaikudi – Head Office',
      permissions: parseJsonSafe(r.permissions, []),
      managedTeams: parseJsonSafe(r.managedTeams, []),
      teamId: r.teamId ? String(r.teamId) : null,
      teamName: r.teamName || null,
      leadId: r.leadId ? String(r.leadId) : null,
      leadName: r.leadName || null,
      hasAccount: Boolean(r.hasAccount),
      ...(isMD ? { password: r.plain_password || 'Lena@1234' } : {}),
      mustChangePassword: r.mustChangePassword != null ? Number(r.mustChangePassword) : 0,
      isPasswordChanged: Boolean(r.hasAccount && r.plain_password && r.plain_password !== 'Lena@1234' && (!r.mustChangePassword || Number(r.mustChangePassword) === 0)),
      isProfileCompleted: Boolean(r.isProfileCompleted || (r.email && r.dob && r.phone)),
      dob: r.dob ? String(r.dob).slice(0, 10) : null,
      marriageDate: r.marriageDate ? String(r.marriageDate).slice(0, 10) : null,
      personalPhone: r.personalPhone || null,
      address: r.address || null,
      maritalStatus: r.maritalStatus || null,
      bloodGroup: r.bloodGroup || null,
      aadharNo: r.aadharNo || null,
      panNo: r.panNo || null,
      workingHours: r.workingHours || '09:00 AM - 06:00 PM',
      personalEmail: r.personalEmail || null,
      aadharDoc: r.aadharDoc || null,
      panDoc: r.panDoc || null,
      actingDelegateId: r.actingDelegateId || null,
      actingDelegateName: r.actingDelegateName || null,
      actingDelegateUntil: r.actingDelegateUntil || null,
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
    const {
      name,
      phone,
      email,
      leadId,
      teamId,
      role,
      designation,
      department,
      branch,
      permissions,
      managedTeams,
      workingHours,
      working_hours,
      personalEmail,
      personal_email,
      aadharNo,
      aadhar_no,
      aadharDoc,
      aadhar_doc,
      panNo,
      pan_no,
      panDoc,
      pan_doc,
      actingDelegateId,
      acting_delegate_id,
      actingDelegateName,
      acting_delegate_name,
      actingDelegateUntil,
      acting_delegate_until,
    } = req.body;

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
    const cleanPersonalEmail = (personalEmail || personal_email || '').trim() || null;
    const cleanBranch = branch ? branch.trim() : 'Karaikudi – Head Office';
    const cleanWorkingHours = (workingHours || working_hours || '09:00 AM - 06:00 PM').trim();
    const cleanRole = role ? role.trim().toUpperCase() : 'SALES_EXECUTIVE';
    const cleanDesignation = (designation || role || 'Sales Executive').trim();
    const cleanDepartment = (department || '').trim();
    const cleanAadharNo = (aadharNo || aadhar_no || '').trim() || null;
    const cleanAadharDoc = (aadharDoc || aadhar_doc || '').trim() || null;
    const cleanPanNo = (panNo || pan_no || '').trim().toUpperCase() || null;
    const cleanPanDoc = (panDoc || pan_doc || '').trim() || null;

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

    // Resolve team assignment
    const isExecutiveRole = ['SALES_HEAD', 'SALES_MANAGER', 'GENERAL_MANAGER', 'OVERALL_MANAGER', 'HEAD_MANAGER', 'ADMIN'].includes(cleanRole);
    const isLeadCreation = !isExecutiveRole && (['LEAD', 'TEAM_LEAD'].includes(cleanRole) || req.body.responsibility === 'TEAM_LEAD');

    let targetTeamId = isExecutiveRole ? null : (teamId || null);
    let targetLeadId = isExecutiveRole ? null : (leadId || null);

    if (!isExecutiveRole && leadId && !targetTeamId) {
      const [leadTeam] = await pool.query('SELECT id FROM teams WHERE lead_id = ? LIMIT 1', [leadId]);
      if (leadTeam.length > 0) {
        targetTeamId = leadTeam[0].id;
      }
    } else if (!isExecutiveRole && targetTeamId && !targetLeadId) {
      const [teamRows] = await pool.query('SELECT lead_id FROM teams WHERE id = ? LIMIT 1', [targetTeamId]);
      if (teamRows.length > 0) {
        targetLeadId = teamRows[0].lead_id;
      }
    }

    // Generate credentials (Common temporary password 'Lena@1234')
    const employeeId = await generateNextStaffId();
    const tempPassword = 'Lena@1234';
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const permArray = Array.isArray(permissions) ? permissions : parseJsonSafe(permissions, []);
    const permJson = permArray.length > 0 ? JSON.stringify(permArray) : null;
    const cleanManagedTeams = Array.isArray(managedTeams)
      ? managedTeams.map((tid) => Number(tid)).filter((tid) => !isNaN(tid) && tid > 0)
      : (managedTeams ? parseJsonSafe(managedTeams, []) : []);
    const managedTeamsJson = cleanManagedTeams.length > 0 ? JSON.stringify(cleanManagedTeams) : null;

    let insertResult;
    try {
      [insertResult] = await pool.query(
        `INSERT INTO staff_users 
         (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, designation, department, permissions, team_id, managed_teams, must_change_password, working_hours, personal_email, aadhar_no, aadhar_doc, pan_no, pan_doc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch, cleanRole, cleanDesignation, cleanDepartment || null, permJson, targetTeamId, managedTeamsJson, cleanWorkingHours, cleanPersonalEmail, cleanAadharNo, cleanAadharDoc, cleanPanNo, cleanPanDoc]
      );
    } catch (_) {
      try {
        [insertResult] = await pool.query(
          `INSERT INTO staff_users 
           (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, designation, department, permissions, team_id, managed_teams, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch, cleanRole, cleanDesignation, cleanDepartment || null, permJson, targetTeamId, managedTeamsJson]
        );
      } catch (_) {
        try {
          [insertResult] = await pool.query(
            `INSERT INTO staff_users 
             (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, designation, department, permissions, team_id, must_change_password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch, cleanRole, cleanDesignation, cleanDepartment || null, permJson, targetTeamId]
          );
        } catch (_) {
          try {
            [insertResult] = await pool.query(
              `INSERT INTO staff_users 
               (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, designation, department, team_id, must_change_password)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
              [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch, cleanRole, cleanDesignation, cleanDepartment || null, targetTeamId]
            );
          } catch (_) {
            [insertResult] = await pool.query(
              `INSERT INTO staff_users 
               (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, team_id, must_change_password)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
              [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch, cleanRole, targetTeamId]
            );
          }
        }
      }
    }
    const newStaffId = insertResult.insertId;

    // If created as Team Lead, create or link their team
    if (isLeadCreation) {
      let finalTeamName = String(req.body.teamName || `${cleanName}'s Team`).trim();
      const [dupName] = await pool.query('SELECT id FROM teams WHERE LOWER(name) = LOWER(?) LIMIT 1', [finalTeamName]);
      if (dupName.length > 0) {
        if (req.body.teamName && req.body.teamName.trim()) {
          return res.status(400).json({
            success: false,
            message: `A team named "${finalTeamName}" already exists. Please choose a different team name.`,
            errors: { teamName: 'Already exists' },
          });
        } else {
          finalTeamName = `${cleanName}'s Team (${newStaffId})`;
        }
      }
      const [teamInsert] = await pool.query(
        'INSERT INTO teams (name, lead_id) VALUES (?, ?)',
        [finalTeamName, newStaffId]
      );
      targetTeamId = teamInsert.insertId;
      await pool.query('UPDATE staff_users SET team_id = ? WHERE id = ?', [targetTeamId, newStaffId]);
    }

    // Dispatch welcome email with credentials
    await sendStaffWelcomeEmail(cleanEmail, cleanName, tempPassword, cleanDesignation || (isLeadCreation ? 'Team Lead' : 'Employee'), employeeId);

    return res.status(201).json({
      success: true,
      message: `${cleanDesignation} (${cleanName}) created successfully. Welcome email dispatched.`,
      data: {
        id: String(newStaffId),
        employeeId,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        personalEmail: cleanPersonalEmail,
        role: cleanRole,
        designation: cleanDesignation,
        department: cleanDepartment || null,
        branch: cleanBranch,
        workingHours: cleanWorkingHours,
        aadharNo: cleanAadharNo,
        aadharDoc: cleanAadharDoc,
        panNo: cleanPanNo,
        panDoc: cleanPanDoc,
        permissions: permArray,
        managedTeams: cleanManagedTeams,
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
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes((req.staff.role || '').toUpperCase());
    const callerId = String(req.staff?.id || '');

    let rows = [];
    try {
      [rows] = await pool.query(`
        SELECT 
          s.id,
          s.employee_id as employeeId,
          s.full_name as name,
          s.phone_number as phone,
          s.email,
          s.role,
          s.designation as designation,
          s.department as department,
          s.branch_location as branch,
          s.permissions as permissions,
          s.team_id as teamId,
          s.managed_teams as managedTeams,
          t.name as teamName,
          t.lead_id as leadId,
          lead_user.full_name as leadName,
          s.plain_password,
          (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
          s.working_hours as workingHours,
          s.personal_email as personalEmail,
          s.aadhar_no as aadharNo,
          s.aadhar_doc as aadharDoc,
          s.pan_no as panNo,
          s.pan_doc as panDoc,
          s.created_at as createdAt
        FROM staff_users s
        LEFT JOIN teams t ON s.team_id = t.id
        LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
        WHERE s.id = ? AND s.is_active = 1 LIMIT 1
      `, [employeeId]);
    } catch (_) {
      [rows] = await pool.query(`
        SELECT 
          s.id,
          s.employee_id as employeeId,
          s.full_name as name,
          s.phone_number as phone,
          s.email,
          s.role,
          s.branch_location as branch,
          s.team_id as teamId,
          t.name as teamName,
          t.lead_id as leadId,
          lead_user.full_name as leadName,
          s.plain_password,
          (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
          s.working_hours as workingHours,
          s.personal_email as personalEmail,
          s.aadhar_no as aadharNo,
          s.aadhar_doc as aadharDoc,
          s.pan_no as panNo,
          s.pan_doc as panDoc,
          s.created_at as createdAt
        FROM staff_users s
        LEFT JOIN teams t ON s.team_id = t.id
        LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
        WHERE s.id = ? AND s.is_active = 1 LIMIT 1
      `, [employeeId]);
    }

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
    const managedTeamIds = await getManagedTeamIds(callerId, req.staff);
    const isManagerOfTeam = employee.teamId && managedTeamIds.includes(Number(employee.teamId));

    if (!isMD && !isSelf && !isLeadOfTeam && !isManagerOfTeam) {
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
        role: employee.role || 'employee',
        designation: employee.designation || employee.role || 'Sales Executive',
        department: employee.department || null,
        branch: employee.branch || 'Karaikudi – Head Office',
        permissions: parseJsonSafe(employee.permissions, []),
        managedTeams: parseJsonSafe(employee.managedTeams, []),
        teamId: employee.teamId ? String(employee.teamId) : null,
        teamName: employee.teamName || null,
        leadId: employee.leadId ? String(employee.leadId) : null,
        leadName: employee.leadName || null,
        hasAccount: Boolean(employee.hasAccount),
        ...(isMD ? { password: employee.plain_password || 'Lena@1234' } : {}),
        mustChangePassword: employee.mustChangePassword != null ? Number(employee.mustChangePassword) : 0,
        isPasswordChanged: Boolean(employee.hasAccount && employee.plain_password && employee.plain_password !== 'Lena@1234' && (!employee.mustChangePassword || Number(employee.mustChangePassword) === 0)),
        isProfileCompleted: Boolean(employee.isProfileCompleted || (employee.email && employee.dob && employee.phone)),
        dob: employee.dob ? String(employee.dob).slice(0, 10) : null,
        marriageDate: employee.marriageDate ? String(employee.marriageDate).slice(0, 10) : null,
        personalPhone: employee.personalPhone || null,
        address: employee.address || null,
        maritalStatus: employee.maritalStatus || null,
        bloodGroup: employee.bloodGroup || null,
        aadharNo: employee.aadharNo || null,
        aadharDoc: employee.aadharDoc || null,
        panNo: employee.panNo || null,
        panDoc: employee.panDoc || null,
        workingHours: employee.workingHours || '09:00 AM - 06:00 PM',
        personalEmail: employee.personalEmail || null,
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
      let [teamRows] = await pool.query('SELECT id, lead_id FROM teams WHERE lead_id = ? LIMIT 1', [leadId]);
      if (teamRows.length === 0) {
        // Find lead user's info to check their team_id or auto-create their team
        const [leadRows] = await pool.query('SELECT id, full_name, team_id FROM staff_users WHERE id = ? LIMIT 1', [leadId]);
        if (leadRows.length > 0) {
          const leadUser = leadRows[0];
          if (leadUser.team_id) {
            const [existingTeam] = await pool.query('SELECT id, lead_id FROM teams WHERE id = ? LIMIT 1', [leadUser.team_id]);
            if (existingTeam.length > 0) {
              await pool.query('UPDATE teams SET lead_id = ? WHERE id = ?', [leadId, leadUser.team_id]);
              teamRows = existingTeam;
            }
          }
          if (teamRows.length === 0) {
            const teamName = `${leadUser.full_name}'s Team`;
            const [insertRes] = await pool.query('INSERT INTO teams (name, lead_id) VALUES (?, ?)', [teamName, leadId]);
            const createdTeamId = insertRes.insertId;
            await pool.query('UPDATE staff_users SET team_id = ? WHERE id = ?', [createdTeamId, leadId]);
            teamRows = [{ id: createdTeamId, lead_id: leadId }];
          }
        }
      }
      if (teamRows.length > 0) {
        newTeamId = teamRows[0].id;
        newLeadId = teamRows[0].lead_id || leadId;
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

/**
 * PUT /employees/:id (MD only)
 * Edit employee profile: full name, phone number, email, role/designation, team/lead assignment.
 */
async function updateEmployee(req, res, next) {
  try {
    const employeeId = req.params.id;
    const {
      name,
      phone,
      email,
      role,
      designation,
      department,
      leadId,
      teamName,
      branch,
      permissions,
      managedTeams,
      workingHours,
      working_hours,
      personalEmail,
      personal_email,
      aadharNo,
      aadhar_no,
      aadharDoc,
      aadhar_doc,
      panNo,
      pan_no,
      panDoc,
      pan_doc,
      actingDelegateId,
      acting_delegate_id,
      actingDelegateName,
      acting_delegate_name,
      actingDelegateUntil,
      acting_delegate_until,
    } = req.body;

    const [empRows] = await pool.query('SELECT * FROM staff_users WHERE id = ? LIMIT 1', [employeeId]);
    if (empRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }
    const currentEmp = empRows[0];

    const cleanName = String(name || currentEmp.full_name || '').trim();
    const cleanPhone = String(phone || currentEmp.phone_number || '').replace(/[^0-9]/g, '');
    const cleanEmail = String(email || currentEmp.email || '').trim().toLowerCase();
    const cleanBranch = String(branch || currentEmp.branch_location || 'Karaikudi – Head Office').trim();
    const cleanRole = String(role || currentEmp.role || 'SALES_EXECUTIVE').trim().toUpperCase();
    const cleanDesignation = String((designation !== undefined ? designation : (role || currentEmp.designation || currentEmp.role || 'Sales Executive')) || '').trim();
    const cleanDepartment = String((department !== undefined ? department : (currentEmp.department || '')) || '').trim();
    const cleanWorkingHours = String((workingHours !== undefined ? workingHours : (working_hours !== undefined ? working_hours : currentEmp.working_hours)) || '09:00 AM - 06:00 PM').trim();
    const cleanPersonalEmail = personalEmail !== undefined ? (personalEmail || '').trim() : (personal_email !== undefined ? (personal_email || '').trim() : (currentEmp.personal_email || null));
    const cleanAadharNo = aadharNo !== undefined ? (aadharNo || '').trim() : (aadhar_no !== undefined ? (aadhar_no || '').trim() : (currentEmp.aadhar_no || null));
    const cleanAadharDoc = aadharDoc !== undefined ? (aadharDoc || '').trim() : (aadhar_doc !== undefined ? (aadhar_doc || '').trim() : (currentEmp.aadhar_doc || null));
    const cleanPanNo = panNo !== undefined ? (panNo || '').trim().toUpperCase() : (pan_no !== undefined ? (pan_no || '').trim().toUpperCase() : (currentEmp.pan_no || null));
    const cleanPanDoc = panDoc !== undefined ? (panDoc || '').trim() : (pan_doc !== undefined ? (pan_doc || '').trim() : (currentEmp.pan_doc || null));
    const cleanDelegateId = (actingDelegateId !== undefined ? (actingDelegateId ? Number(actingDelegateId) : null) : (acting_delegate_id !== undefined ? (acting_delegate_id ? Number(acting_delegate_id) : null) : (currentEmp.acting_delegate_id || null)));
    const cleanDelegateName = (actingDelegateName !== undefined ? (actingDelegateName ? String(actingDelegateName).trim() : null) : (acting_delegate_name !== undefined ? (acting_delegate_name ? String(acting_delegate_name).trim() : null) : (currentEmp.acting_delegate_name || null)));
    const cleanDelegateUntil = (actingDelegateUntil !== undefined ? (actingDelegateUntil || null) : (acting_delegate_until !== undefined ? (acting_delegate_until || null) : (currentEmp.acting_delegate_until || null)));
    const isExecutiveRole = ['SALES_HEAD', 'SALES_MANAGER', 'GENERAL_MANAGER', 'OVERALL_MANAGER', 'HEAD_MANAGER', 'ADMIN'].includes(cleanRole);
    const isTargetLead = !isExecutiveRole && (['LEAD', 'TEAM_LEAD'].includes(cleanRole) || req.body.responsibility === 'TEAM_LEAD');

    const hasPermUpdate = permissions !== undefined;
    const permArray = hasPermUpdate ? (Array.isArray(permissions) ? permissions : parseJsonSafe(permissions, [])) : undefined;
    const permJson = hasPermUpdate ? JSON.stringify(permArray) : null;

    const hasManagedTeamsUpdate = managedTeams !== undefined;
    const cleanManagedTeams = hasManagedTeamsUpdate
      ? (Array.isArray(managedTeams)
          ? managedTeams.map((tid) => Number(tid)).filter((tid) => !isNaN(tid) && tid > 0)
          : parseJsonSafe(managedTeams, []))
      : undefined;
    const managedTeamsJson = hasManagedTeamsUpdate && cleanManagedTeams.length > 0 ? JSON.stringify(cleanManagedTeams) : null;

    if (!cleanName) {
      return res.status(400).json({ success: false, message: 'Employee name is required.', errors: { name: 'Required' } });
    }
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit phone number starting with 6-9 is required.', errors: { phone: 'Invalid' } });
    }

    // Phone uniqueness check against OTHER staff members
    const [phoneExists] = await pool.query(
      'SELECT id FROM staff_users WHERE phone_number = ? AND id != ? LIMIT 1',
      [cleanPhone, employeeId]
    );
    if (phoneExists.length > 0) {
      return res.status(409).json({ success: false, message: 'Phone number is already registered with another staff member.', errors: { phone: 'Duplicate' } });
    }

    let finalTeamId = isExecutiveRole ? null : currentEmp.team_id;
    let finalRole = cleanRole;

    if (isExecutiveRole) {
      // General manager / Sales Head / Sales Manager is not in a team, and does not lead a single team (they oversee all teams)
      finalTeamId = null;
      try {
        await pool.query('UPDATE teams SET lead_id = NULL WHERE lead_id = ?', [employeeId]);
      } catch (_) {}
    } else if (isTargetLead) {
      // Promoting to or updating as Team Lead
      const [teamRows] = await pool.query('SELECT id, name FROM teams WHERE lead_id = ? LIMIT 1', [employeeId]);
      if (teamRows.length > 0) {
        finalTeamId = teamRows[0].id;
        if (teamName && teamName.trim()) {
          const newTeamName = teamName.trim();
          const [dupName] = await pool.query(
            'SELECT id FROM teams WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1',
            [newTeamName, finalTeamId]
          );
          if (dupName.length > 0) {
            return res.status(400).json({
              success: false,
              message: `A team named "${newTeamName}" already exists. Please choose a different team name.`,
              errors: { teamName: 'Already exists' },
            });
          }
          await pool.query('UPDATE teams SET name = ? WHERE id = ?', [newTeamName, finalTeamId]);
        }
      } else {
        // Create a new team for this lead
        let desiredTeamName = String(teamName || `${cleanName}'s Team`).trim();
        const [dupName] = await pool.query('SELECT id FROM teams WHERE LOWER(name) = LOWER(?) LIMIT 1', [desiredTeamName]);
        if (dupName.length > 0) {
          if (teamName && teamName.trim()) {
            return res.status(400).json({
              success: false,
              message: `A team named "${desiredTeamName}" already exists. Please choose a different team name.`,
              errors: { teamName: 'Already exists' },
            });
          } else {
            desiredTeamName = `${cleanName}'s Team (${employeeId})`;
          }
        }
        const [insertTeam] = await pool.query(
          'INSERT INTO teams (name, lead_id) VALUES (?, ?)',
          [desiredTeamName, employeeId]
        );
        finalTeamId = insertTeam.insertId;
      }
    } else {
      // Setting as common employee / telecaller / other role
      // If was previously a lead of a team, clear lead_id on that team
      try {
        await pool.query('UPDATE teams SET lead_id = NULL WHERE lead_id = ?', [employeeId]);
      } catch (_) {
        try {
          await pool.query('ALTER TABLE teams MODIFY COLUMN lead_id INT NULL');
          await pool.query('UPDATE teams SET lead_id = NULL WHERE lead_id = ?', [employeeId]);
        } catch (_) {}
      }

      if (leadId) {
        const [targetTeam] = await pool.query('SELECT id FROM teams WHERE lead_id = ? LIMIT 1', [leadId]);
        finalTeamId = targetTeam.length > 0 ? targetTeam[0].id : null;
      } else {
        finalTeamId = null;
      }
    }

    // Update staff_users
    try {
      if (hasPermUpdate && hasManagedTeamsUpdate) {
        await pool.query(`
          UPDATE staff_users 
          SET full_name = ?, phone_number = ?, email = ?, role = ?, designation = ?, department = ?, team_id = ?, branch_location = ?, permissions = ?, managed_teams = ?,
              working_hours = ?, personal_email = ?, aadhar_no = ?, aadhar_doc = ?, pan_no = ?, pan_doc = ?,
              acting_delegate_id = ?, acting_delegate_name = ?, acting_delegate_until = ?
          WHERE id = ?
        `, [cleanName, cleanPhone, cleanEmail, finalRole, cleanDesignation, cleanDepartment || null, finalTeamId, cleanBranch, permJson, managedTeamsJson, cleanWorkingHours, cleanPersonalEmail, cleanAadharNo, cleanAadharDoc, cleanPanNo, cleanPanDoc, cleanDelegateId, cleanDelegateName, cleanDelegateUntil, employeeId]);
      } else if (hasPermUpdate) {
        await pool.query(`
          UPDATE staff_users 
          SET full_name = ?, phone_number = ?, email = ?, role = ?, designation = ?, department = ?, team_id = ?, branch_location = ?, permissions = ?,
              working_hours = ?, personal_email = ?, aadhar_no = ?, aadhar_doc = ?, pan_no = ?, pan_doc = ?,
              acting_delegate_id = ?, acting_delegate_name = ?, acting_delegate_until = ?
          WHERE id = ?
        `, [cleanName, cleanPhone, cleanEmail, finalRole, cleanDesignation, cleanDepartment || null, finalTeamId, cleanBranch, permJson, cleanWorkingHours, cleanPersonalEmail, cleanAadharNo, cleanAadharDoc, cleanPanNo, cleanPanDoc, cleanDelegateId, cleanDelegateName, cleanDelegateUntil, employeeId]);
      } else if (hasManagedTeamsUpdate) {
        await pool.query(`
          UPDATE staff_users 
          SET full_name = ?, phone_number = ?, email = ?, role = ?, designation = ?, department = ?, team_id = ?, branch_location = ?, managed_teams = ?,
              working_hours = ?, personal_email = ?, aadhar_no = ?, aadhar_doc = ?, pan_no = ?, pan_doc = ?,
              acting_delegate_id = ?, acting_delegate_name = ?, acting_delegate_until = ?
          WHERE id = ?
        `, [cleanName, cleanPhone, cleanEmail, finalRole, cleanDesignation, cleanDepartment || null, finalTeamId, cleanBranch, managedTeamsJson, cleanWorkingHours, cleanPersonalEmail, cleanAadharNo, cleanAadharDoc, cleanPanNo, cleanPanDoc, cleanDelegateId, cleanDelegateName, cleanDelegateUntil, employeeId]);
      } else {
        await pool.query(`
          UPDATE staff_users 
          SET full_name = ?, phone_number = ?, email = ?, role = ?, designation = ?, department = ?, team_id = ?, branch_location = ?,
              working_hours = ?, personal_email = ?, aadhar_no = ?, aadhar_doc = ?, pan_no = ?, pan_doc = ?,
              acting_delegate_id = ?, acting_delegate_name = ?, acting_delegate_until = ?
          WHERE id = ?
        `, [cleanName, cleanPhone, cleanEmail, finalRole, cleanDesignation, cleanDepartment || null, finalTeamId, cleanBranch, cleanWorkingHours, cleanPersonalEmail, cleanAadharNo, cleanAadharDoc, cleanPanNo, cleanPanDoc, cleanDelegateId, cleanDelegateName, cleanDelegateUntil, employeeId]);
      }
    } catch (err) {
      console.warn('updateEmployee primary UPDATE failed, falling back:', err.message);
      await pool.query(`
        UPDATE staff_users 
        SET full_name = ?, phone_number = ?, email = ?, role = ?, team_id = ?, branch_location = ?, working_hours = ?
        WHERE id = ?
      `, [cleanName, cleanPhone, cleanEmail, finalRole, finalTeamId, cleanBranch, cleanWorkingHours, employeeId]);
    }

    // Fetch updated record with team details
    let updatedRows = [];
    try {
      [updatedRows] = await pool.query(`
        SELECT 
          s.id,
          s.employee_id as employeeId,
          s.full_name as name,
          s.phone_number as phone,
          s.email,
          s.role,
          s.designation as designation,
          s.department as department,
          s.branch_location as branch,
          s.permissions as permissions,
          s.team_id as teamId,
          s.managed_teams as managedTeams,
          t.name as teamName,
          t.lead_id as leadId,
          lead_user.full_name as leadName,
          s.plain_password as password,
          (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
          s.working_hours as workingHours,
          s.personal_email as personalEmail,
          s.aadhar_no as aadharNo,
          s.aadhar_doc as aadharDoc,
          s.pan_no as panNo,
          s.pan_doc as panDoc,
          s.acting_delegate_id as actingDelegateId,
          s.acting_delegate_name as actingDelegateName,
          s.acting_delegate_until as actingDelegateUntil
        FROM staff_users s
        LEFT JOIN teams t ON s.team_id = t.id
        LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
        WHERE s.id = ? LIMIT 1
      `, [employeeId]);
    } catch (_) {
      [updatedRows] = await pool.query(`
        SELECT 
          s.id,
          s.employee_id as employeeId,
          s.full_name as name,
          s.phone_number as phone,
          s.email,
          s.role,
          s.branch_location as branch,
          s.team_id as teamId,
          t.name as teamName,
          t.lead_id as leadId,
          lead_user.full_name as leadName,
          s.plain_password as password,
          (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
          s.working_hours as workingHours,
          s.personal_email as personalEmail,
          s.aadhar_no as aadharNo,
          s.aadhar_doc as aadharDoc,
          s.pan_no as panNo,
          s.pan_doc as panDoc,
          s.acting_delegate_id as actingDelegateId,
          s.acting_delegate_name as actingDelegateName,
          s.acting_delegate_until as actingDelegateUntil
        FROM staff_users s
        LEFT JOIN teams t ON s.team_id = t.id
        LEFT JOIN staff_users lead_user ON t.lead_id = lead_user.id
        WHERE s.id = ? LIMIT 1
      `, [employeeId]);
    }

    const updated = updatedRows[0] || {};

    return res.status(200).json({
      success: true,
      message: 'Staff profile updated successfully.',
      data: {
        id: String(updated.id || employeeId),
        employeeId: updated.employeeId || '',
        name: updated.name || cleanName,
        phone: updated.phone || cleanPhone,
        email: updated.email || cleanEmail,
        role: updated.role || finalRole,
        designation: updated.designation || cleanDesignation,
        department: updated.department || cleanDepartment || null,
        branch: updated.branch || cleanBranch,
        permissions: parseJsonSafe(updated.permissions, permArray || []),
        managedTeams: parseJsonSafe(updated.managedTeams, cleanManagedTeams !== undefined ? cleanManagedTeams : parseJsonSafe(currentEmp.managed_teams, [])),
        teamId: updated.teamId ? String(updated.teamId) : (finalTeamId ? String(finalTeamId) : null),
        teamName: updated.teamName || null,
        leadId: updated.leadId ? String(updated.leadId) : null,
        leadName: updated.leadName || null,
        hasAccount: Boolean(updated.hasAccount),
        password: updated.password || 'Lena@1234',
        workingHours: updated.workingHours || cleanWorkingHours,
        personalEmail: updated.personalEmail !== undefined ? updated.personalEmail : cleanPersonalEmail,
        aadharNo: updated.aadharNo !== undefined ? updated.aadharNo : cleanAadharNo,
        aadharDoc: updated.aadharDoc !== undefined ? updated.aadharDoc : cleanAadharDoc,
        panNo: updated.panNo !== undefined ? updated.panNo : cleanPanNo,
        panDoc: updated.panDoc !== undefined ? updated.panDoc : cleanPanDoc,
        actingDelegateId: updated.actingDelegateId !== undefined ? updated.actingDelegateId : cleanDelegateId,
        actingDelegateName: updated.actingDelegateName !== undefined ? updated.actingDelegateName : cleanDelegateName,
        actingDelegateUntil: updated.actingDelegateUntil !== undefined ? updated.actingDelegateUntil : cleanDelegateUntil,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /employees/:id (MD only)
 * Safely removes a staff member (employee or team lead).
 */
async function deleteEmployee(req, res, next) {
  const connection = await pool.getConnection();
  try {
    const employeeId = req.params.id;

    const [empRows] = await connection.query('SELECT * FROM staff_users WHERE id = ? LIMIT 1', [employeeId]);
    if (empRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }
    const staff = empRows[0];

    // Protect main Admin account
    if (['ADMIN', 'SUPER_ADMIN'].includes((staff.role || '').toUpperCase()) || staff.employee_id === 'LP-COMPANY') {
      return res.status(403).json({ success: false, message: 'Main Admin account cannot be deleted.' });
    }

    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // If this staff was leading a team, unassign members and delete team
    try {
      const [ledTeams] = await connection.query('SELECT id FROM teams WHERE lead_id = ?', [employeeId]);
      for (const t of ledTeams) {
        await connection.query('UPDATE staff_users SET team_id = NULL WHERE team_id = ?', [t.id]);
        await connection.query('DELETE FROM teams WHERE id = ?', [t.id]);
      }
    } catch (_) {}

    // Unassign open tasks and customer leads so historical work data is safe
    try {
      await connection.query('UPDATE tasks SET employee_id = NULL WHERE employee_id = ?', [employeeId]);
    } catch (_) {}
    try {
      await connection.query('UPDATE tasks SET lead_id = NULL WHERE lead_id = ?', [employeeId]);
    } catch (_) {}
    try {
      await connection.query('UPDATE customer_leads SET employee_id = NULL WHERE employee_id = ?', [employeeId]);
    } catch (_) {}
    try {
      await connection.query('UPDATE customer_leads SET lead_id = NULL WHERE lead_id = ?', [employeeId]);
    } catch (_) {}

    // Delete refresh tokens and OTPs (otp_codes column is phone_or_email)
    try {
      await connection.query('DELETE FROM refresh_tokens WHERE user_type = "STAFF" AND user_id = ?', [employeeId]);
    } catch (_) {}
    try {
      await connection.query(
        'DELETE FROM otp_codes WHERE phone_or_email = ? OR phone_or_email = ?',
        [staff.phone_number, staff.email]
      );
    } catch (_) {}

    // Finally delete from staff_users so the SIM card phone number is 100% free for the upcoming employee
    await connection.query('DELETE FROM staff_users WHERE id = ?', [employeeId]);

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    return res.status(200).json({
      success: true,
      message: `${staff.full_name} (${staff.employee_id}) has been removed successfully. Phone number ${staff.phone_number} is now freed for new staff assignment.`,
      data: { id: String(employeeId), name: staff.full_name, phone: staff.phone_number },
    });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
}

module.exports = {
  getEmployees,
  createEmployee,
  getEmployeeById,
  updateEmployeeAssignment,
  updateEmployee,
  deleteEmployee,
};
