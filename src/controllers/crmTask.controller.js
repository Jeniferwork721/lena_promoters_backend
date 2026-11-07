const { pool } = require('../config/db');

/**
 * 26. GET /tasks (Scoped: MD all, Lead own team, Employee own)
 * Filters: employeeId, leadId, status, priority, dueFrom, dueTo, page, limit.
 */
async function getTasks(req, res, next) {
  try {
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const isLead = req.staff && ['MANAGER', 'LEAD'].includes((req.staff.role || '').toUpperCase());
    const callerId = req.staff?.id;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const { employeeId, leadId, status, priority, dueFrom, dueTo } = req.query;

    let whereConditions = ['1=1'];
    let params = [];

    // Role-based scoping
    if (isMD) {
      if (employeeId) {
        whereConditions.push('tk.employee_id = ?');
        params.push(employeeId);
      }
      if (leadId) {
        whereConditions.push('tk.lead_id = ?');
        params.push(leadId);
      }
    } else if (isLead) {
      // Lead sees tasks for their own team
      whereConditions.push('tk.lead_id = ?');
      params.push(callerId);

      if (employeeId) {
        whereConditions.push('tk.employee_id = ?');
        params.push(employeeId);
      }
    } else {
      // Employee sees only their own tasks
      whereConditions.push('tk.employee_id = ?');
      params.push(callerId);
    }

    if (status && status.trim()) {
      whereConditions.push('tk.status = ?');
      params.push(status.trim());
    }

    if (priority && priority.trim()) {
      whereConditions.push('tk.priority = ?');
      params.push(priority.trim());
    }

    if (dueFrom) {
      whereConditions.push('tk.due_date >= ?');
      params.push(dueFrom);
    }

    if (dueTo) {
      whereConditions.push('tk.due_date <= ?');
      params.push(dueTo);
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Total count query
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM tasks tk ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // Data query
    const [rows] = await pool.query(`
      SELECT 
        tk.id,
        tk.title,
        tk.description as \`desc\`,
        tk.employee_id as employeeId,
        emp.full_name as employeeName,
        tk.lead_id as leadId,
        lead_user.full_name as leadName,
        tk.priority,
        tk.status,
        DATE_FORMAT(tk.due_date, '%Y-%m-%d') as due,
        DATE_FORMAT(tk.created_at, '%Y-%m-%d') as createdAt,
        DATE_FORMAT(tk.completed_at, '%Y-%m-%d') as completedAt
      FROM tasks tk
      LEFT JOIN staff_users emp ON tk.employee_id = emp.id
      LEFT JOIN staff_users lead_user ON tk.lead_id = lead_user.id
      ${whereClause}
      ORDER BY tk.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const data = rows.map(r => ({
      id: String(r.id),
      title: r.title,
      desc: r.desc || '',
      employeeId: String(r.employeeId),
      employeeName: r.employeeName || '',
      leadId: String(r.leadId),
      leadName: r.leadName || '',
      priority: r.priority,
      status: r.status,
      due: r.due,
      createdAt: r.createdAt,
      completedAt: r.completedAt || '',
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
 * 27. POST /tasks (Lead only)
 * Create a task for a member of their team.
 * Body: { title, desc, employeeId, priority, due }
 */
async function createTask(req, res, next) {
  try {
    const callerId = req.staff?.id;
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());
    const { title, desc, employeeId, priority = 'Medium', due } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Task title is required.',
        errors: { title: 'Title is required' },
      });
    }

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee is required.',
        errors: { employeeId: 'Employee is required' },
      });
    }

    if (!due) {
      return res.status(400).json({
        success: false,
        message: 'Due date is required.',
        errors: { due: 'Due date is required' },
      });
    }

    // Verify employee exists and is in lead's team (unless MD)
    const [empRows] = await pool.query(`
      SELECT s.id, s.full_name, s.team_id, t.lead_id 
      FROM staff_users s
      LEFT JOIN teams t ON s.team_id = t.id
      WHERE s.id = ? AND s.is_active = 1 LIMIT 1
    `, [employeeId]);

    if (empRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    const employee = empRows[0];
    if (!isMD && String(employee.lead_id) !== String(callerId) && String(employee.id) !== String(callerId)) {
      return res.status(403).json({
        success: false,
        message: 'You can only assign tasks to members of your own team.',
      });
    }

    const leadId = isMD ? (employee.lead_id || callerId) : callerId;

    const [insertResult] = await pool.query(
      `INSERT INTO tasks (title, description, employee_id, lead_id, priority, status, due_date)
       VALUES (?, ?, ?, ?, ?, 'Pending', ?)`,
      [title.trim(), (desc || '').trim(), employeeId, leadId, priority, due]
    );

    const taskId = insertResult.insertId;

    return res.status(201).json({
      success: true,
      message: 'Task created successfully.',
      data: {
        id: String(taskId),
        title: title.trim(),
        desc: (desc || '').trim(),
        employeeId: String(employeeId),
        employeeName: employee.full_name,
        leadId: String(leadId),
        priority,
        status: 'Pending',
        due,
        createdAt: new Date().toISOString().slice(0, 10),
        completedAt: '',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 28. PATCH /tasks/:id/status (Lead own team, Employee own)
 * Body: { status: "Completed" | "Pending" | "Ongoing" }
 * Setting Completed sets completedAt to today; any other status clears completedAt.
 */
async function updateTaskStatus(req, res, next) {
  try {
    const taskId = req.params.id;
    const { status } = req.body;
    const callerId = String(req.staff?.id || '');
    const isMD = req.staff && ['ADMIN', 'SUPER_ADMIN'].includes((req.staff.role || '').toUpperCase());

    if (!status || !['Pending', 'Ongoing', 'Completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be one of: Pending, Ongoing, Completed.',
      });
    }

    const [taskRows] = await pool.query('SELECT * FROM tasks WHERE id = ? LIMIT 1', [taskId]);
    if (taskRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }

    const task = taskRows[0];
    const isOwnerEmployee = String(task.employee_id) === callerId;
    const isOwnerLead = String(task.lead_id) === callerId;

    if (!isMD && !isOwnerEmployee && !isOwnerLead) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update this task status.',
      });
    }

    const completedAt = status === 'Completed' ? new Date() : null;

    await pool.query(
      'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?',
      [status, completedAt, taskId]
    );

    return res.status(200).json({
      success: true,
      message: `Task status updated to ${status}.`,
      data: {
        id: String(taskId),
        status,
        completedAt: completedAt ? completedAt.toISOString().slice(0, 10) : '',
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTasks,
  createTask,
  updateTaskStatus,
};
