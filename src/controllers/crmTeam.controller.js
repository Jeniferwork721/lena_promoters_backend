const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { sendStaffWelcomeEmail } = require('../services/email.service');

/**
 * Helper to generate sequential Staff ID (e.g. LP-EMP-105)
 */
async function generateNextStaffId() {
  const [rows] = await pool.query(
    "SELECT employee_id FROM staff_users WHERE employee_id LIKE 'LP-EMP-%'"
  );
  const used = new Set(
    rows
      .map(r => parseInt(r.employee_id.replace(/^LP-EMP-/i, ''), 10))
      .filter(n => !isNaN(n))
  );

  let candidate = 101;
  while (used.has(candidate)) {
    candidate++;
  }
  return `LP-EMP-${candidate}`;
}

/**
 * 12. GET /team-leads (MD only)
 * List all leads with their team, employee count, and hasAccount.
 * Also includes password so Admin can view it.
 */
async function getTeamLeads(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());

    const [rows] = await pool.query(`
      SELECT 
        s.id,
        s.employee_id,
        s.full_name as name,
        s.phone_number as phone,
        s.email,
        s.branch_location as branch,
        'lead' as role,
        t.id as teamId,
        t.name as teamName,
        s.plain_password,
        (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount,
        (SELECT COUNT(*) FROM staff_users m WHERE m.team_id = t.id AND m.id != s.id) as employeeCount
      FROM staff_users s
      JOIN teams t ON t.lead_id = s.id
      WHERE s.is_active = 1
      ORDER BY t.name ASC
    `);

    const data = rows.map(r => ({
      id: String(r.id),
      employeeId: r.employee_id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      role: 'lead',
      branch: r.branch || 'Karaikudi – Head Office',
      teamId: String(r.teamId),
      teamName: r.teamName,
      employeeCount: Number(r.employeeCount) || 0,
      hasAccount: Boolean(r.hasAccount),
      ...(isMD ? { password: r.plain_password || 'Lena@1234' } : {}),
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
 * 13. POST /team-leads (MD only)
 * Add a lead, create their team, set temporary password 'Lena@1234', and email credentials.
 * Body: { name, phone, teamName, email, branch }
 */
async function createTeamLead(req, res, next) {
  try {
    const { name, phone, teamName, email, branch } = req.body;

    // 1. Validate required fields
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

    if (!teamName || !teamName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Team name is required.',
        errors: { teamName: 'Team name is required' },
      });
    }

    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const cleanTeamName = teamName.trim();
    const cleanEmail = email ? email.trim() : `${cleanPhone}@lenapromoters.com`;
    const cleanBranch = branch ? branch.trim() : 'Karaikudi – Head Office';

    // Phone format check: 10 digits starting with 6-9
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be a valid 10-digit Indian mobile starting with 6 to 9.',
        errors: { phone: 'Invalid mobile number' },
      });
    }

    // 2. Name uniqueness check (case-insensitive across staff)
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

    // 3. Phone uniqueness check across all staff
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

    // 4. Team name uniqueness check (case-insensitive)
    const [teamExists] = await pool.query(
      'SELECT id FROM teams WHERE LOWER(name) = LOWER(?) LIMIT 1',
      [cleanTeamName]
    );
    if (teamExists.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Team name already exists. Please choose a different team name.',
        errors: { teamName: 'Already exists' },
      });
    }

    // 5. Generate credentials (Common temporary password 'Lena@1234')
    const employeeId = await generateNextStaffId();
    const tempPassword = 'Lena@1234';
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // 6. Create Staff User record
    const [staffResult] = await pool.query(
      `INSERT INTO staff_users 
       (employee_id, full_name, email, phone_number, password_hash, plain_password, branch_location, role, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'MANAGER', 1)`,
      [employeeId, cleanName, cleanEmail, cleanPhone, passwordHash, tempPassword, cleanBranch]
    );
    const newStaffId = staffResult.insertId;

    // 7. Create Team record
    const [teamResult] = await pool.query(
      'INSERT INTO teams (name, lead_id) VALUES (?, ?)',
      [cleanTeamName, newStaffId]
    );
    const newTeamId = teamResult.insertId;

    // 8. Link team_id to the Team Lead
    await pool.query('UPDATE staff_users SET team_id = ? WHERE id = ?', [newTeamId, newStaffId]);

    // 9. Dispatch welcome email with credentials
    await sendStaffWelcomeEmail(cleanEmail, cleanName, tempPassword, 'Team Lead', employeeId);

    return res.status(201).json({
      success: true,
      message: 'Team Lead and team created successfully. Welcome email dispatched.',
      data: {
        id: String(newStaffId),
        employeeId,
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        role: 'lead',
        branch: cleanBranch,
        teamId: String(newTeamId),
        teamName: cleanTeamName,
        hasAccount: true,
        password: tempPassword,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 14. GET /team-leads/:id (MD or own lead)
 * One lead with team and members list.
 */
async function getTeamLeadById(req, res, next) {
  try {
    const leadId = req.params.id;
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isSelf = req.staff && String(req.staff.id) === String(leadId);

    if (!isMD && !isSelf) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own team details.',
      });
    }

    const [leadRows] = await pool.query(`
      SELECT 
        s.id,
        s.employee_id,
        s.full_name as name,
        s.phone_number as phone,
        s.email,
        s.plain_password,
        'lead' as role,
        t.id as teamId,
        t.name as teamName,
        (s.password_hash IS NOT NULL AND s.password_hash != '') as hasAccount
      FROM staff_users s
      LEFT JOIN teams t ON t.lead_id = s.id
      WHERE s.id = ? AND s.is_active = 1 LIMIT 1
    `, [leadId]);

    if (leadRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Team lead not found.',
      });
    }

    const lead = leadRows[0];

    // Query members of this team
    let members = [];
    if (lead.teamId) {
      const [memberRows] = await pool.query(`
        SELECT 
          id,
          employee_id as employeeId,
          full_name as name,
          phone_number as phone,
          email,
          role,
          plain_password,
          (password_hash IS NOT NULL AND password_hash != '') as hasAccount
        FROM staff_users
        WHERE team_id = ? AND id != ? AND is_active = 1
        ORDER BY full_name ASC
      `, [lead.teamId, lead.id]);

      members = memberRows.map(m => ({
        id: String(m.id),
        employeeId: m.employeeId,
        name: m.name,
        phone: m.phone,
        email: m.email,
        role: 'employee',
        hasAccount: Boolean(m.hasAccount),
        ...(isMD ? { password: m.plain_password || 'Lena@1234' } : {}),
      }));
    }

    return res.status(200).json({
      success: true,
      data: {
        id: String(lead.id),
        employeeId: lead.employee_id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        role: 'lead',
        teamId: lead.teamId ? String(lead.teamId) : null,
        teamName: lead.teamName || null,
        hasAccount: Boolean(lead.hasAccount),
        ...(isMD ? { password: lead.plain_password || 'Lena@1234' } : {}),
        members,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 15. GET /teams (MD only)
 * List teams: id, name, leadId, leadName, memberCount
 */
async function getTeams(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT 
        t.id,
        t.name,
        t.lead_id as leadId,
        s.full_name as leadName,
        s.phone_number as leadPhone,
        s.email as leadEmail,
        (SELECT COUNT(*) FROM staff_users m WHERE m.team_id = t.id) as memberCount
      FROM teams t
      LEFT JOIN staff_users s ON t.lead_id = s.id
      ORDER BY t.name ASC
    `);

    const data = rows.map(r => ({
      id: String(r.id),
      name: r.name,
      leadId: r.leadId ? String(r.leadId) : null,
      leadName: r.leadName || '',
      leadPhone: r.leadPhone || '',
      leadEmail: r.leadEmail || '',
      memberCount: Number(r.memberCount) || 0,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTeamLeads,
  createTeamLead,
  getTeamLeadById,
  getTeams,
  generateNextStaffId,
};
