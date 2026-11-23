const { pool } = require('../config/db');
const { getManagedTeamIds } = require('../utils/teamScope');

/**
 * Helper to compute date range and working days (excluding Sundays) in Asia/Kolkata
 */
function getPeriodDateRange(period = 'monthly') {
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let startDate = new Date(endDate);
  if (period === 'daily') {
    // 1 day
  } else if (period === 'weekly') {
    startDate.setDate(endDate.getDate() - 6); // 7 days
  } else if (period === 'yearly') {
    startDate.setDate(endDate.getDate() - 364); // 365 days
  } else {
    // monthly: 30 days
    startDate.setDate(endDate.getDate() - 29);
  }

  // Count working days (excluding Sundays, where getDay() === 0)
  let workingDays = 0;
  let curr = new Date(startDate);
  while (curr <= endDate) {
    if (curr.getDay() !== 0) {
      workingDays++;
    }
    curr.setDate(curr.getDate() + 1);
  }
  workingDays = Math.max(1, workingDays);

  const formatDate = d => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    workingDays,
  };
}

/**
 * Helper to resolve dashboard scope based strictly on permissions and managed teams
 */
async function resolveDashboardScope(req) {
  const callerId = req.staff?.id;
  const perms = Array.isArray(req.staff?.permissions)
    ? req.staff.permissions
    : (typeof req.staff?.permissions === 'string' ? JSON.parse(req.staff.permissions || '[]') : []);
  const roleUpper = (req.staff?.role || '').toUpperCase();
  const isMD = ['ADMIN', 'SUPER_ADMIN', 'MD', 'HR'].includes(roleUpper) || perms.includes('*');
  const hasAllReports = isMD || perms.includes('reports_employee') || perms.includes('reports_all');

  const managedTeamIds = await getManagedTeamIds(callerId, req.staff);
  const isMultiTeamManager = !hasAllReports && managedTeamIds.length > 0;
  const isLead = !hasAllReports && !isMultiTeamManager && (['LEAD', 'TEAM_LEAD'].includes(roleUpper) || perms.includes('reports_own_team') || perms.includes('reports_team'));

  return {
    callerId,
    hasAllReports,
    isMultiTeamManager,
    managedTeamIds,
    isLead,
    teamId: req.staff?.teamId || req.staff?.team_id || 0,
  };
}

/**
 * 34. GET /dashboard/summary (Scoped: MD all, Lead own team, Employee self)
 * Query: period (daily, weekly, monthly, yearly)
 */
async function getDashboardSummary(req, res, next) {
  try {
    const scope = await resolveDashboardScope(req);
    const callerId = scope.callerId;
    const period = (req.query.period || 'monthly').toLowerCase();

    const { startDate, endDate } = getPeriodDateRange(period);

    let reportFilter = 'wr.report_date >= ? AND wr.report_date <= ?';
    let reportParams = [startDate, endDate];

    let taskFilter = 'tk.due_date >= ? AND tk.due_date <= ?';
    let taskParams = [startDate, endDate];

    if (scope.hasAllReports) {
      // MD / whole company sees all
    } else if (scope.isMultiTeamManager) {
      reportFilter += ' AND s.team_id IN (?)';
      reportParams.push(scope.managedTeamIds);

      taskFilter += ' AND (tk.lead_id IN (SELECT lead_id FROM teams WHERE id IN (?)) OR tk.employee_id IN (SELECT id FROM staff_users WHERE team_id IN (?)))';
      taskParams.push(scope.managedTeamIds, scope.managedTeamIds);
    } else if (scope.isLead) {
      reportFilter += ' AND s.team_id = ?';
      reportParams.push(scope.teamId);

      taskFilter += ' AND (tk.lead_id = ? OR tk.employee_id IN (SELECT id FROM staff_users WHERE team_id = ?))';
      taskParams.push(callerId, scope.teamId);
    } else {
      reportFilter += ' AND wr.employee_id = ?';
      reportParams.push(callerId);

      taskFilter += ' AND tk.employee_id = ?';
      taskParams.push(callerId);
    }

    // Reports aggregates
    const [reportRows] = await pool.query(`
      SELECT 
        COUNT(*) as reports,
        COUNT(*) as calls,
        SUM(CASE WHEN wr.site_visit != 'Not Planned' THEN 1 ELSE 0 END) as visits,
        SUM(CASE WHEN wr.site_visit = 'Completed' THEN 1 ELSE 0 END) as visitsDone,
        SUM(CASE WHEN wr.follow_up_date IS NOT NULL THEN 1 ELSE 0 END) as followups,
        SUM(CASE WHEN wr.call_status = 'Connected - Willing' THEN 1 ELSE 0 END) as interested
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      WHERE ${reportFilter}
    `, reportParams);

    // Tasks aggregates in range
    const [taskRows] = await pool.query(`
      SELECT 
        COUNT(*) as tasks,
        SUM(CASE WHEN tk.status = 'Completed' THEN 1 ELSE 0 END) as done
      FROM tasks tk
      WHERE ${taskFilter}
    `, taskParams);

    const rep = reportRows[0] || {};
    const tsk = taskRows[0] || {};

    return res.status(200).json({
      success: true,
      data: {
        period,
        startDate,
        endDate,
        reports: Number(rep.reports) || 0,
        calls: Number(rep.calls) || 0,
        visits: Number(rep.visits) || 0,
        visitsDone: Number(rep.visitsDone) || 0,
        followups: Number(rep.followups) || 0,
        interested: Number(rep.interested) || 0,
        tasks: Number(tsk.tasks) || 0,
        done: Number(tsk.done) || 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 35. GET /dashboard/trend (Scoped)
 * Chart data: calls per day (weekly, monthly) or per month (yearly)
 */
async function getDashboardTrend(req, res, next) {
  try {
    const scope = await resolveDashboardScope(req);
    const callerId = scope.callerId;
    const period = (req.query.period || 'weekly').toLowerCase();

    const { startDate, endDate } = getPeriodDateRange(period);

    let whereSql = 'wr.report_date >= ? AND wr.report_date <= ?';
    let params = [startDate, endDate];

    if (scope.hasAllReports) {
      // MD / whole company sees all
    } else if (scope.isMultiTeamManager) {
      whereSql += ' AND s.team_id IN (?)';
      params.push(scope.managedTeamIds);
    } else if (scope.isLead) {
      whereSql += ' AND s.team_id = ?';
      params.push(scope.teamId);
    } else {
      whereSql += ' AND wr.employee_id = ?';
      params.push(callerId);
    }

    if (period === 'yearly') {
      // 12 monthly points
      const [rows] = await pool.query(`
        SELECT 
          DATE_FORMAT(wr.report_date, '%Y-%m') as \`key\`,
          DATE_FORMAT(wr.report_date, '%b %Y') as label,
          COUNT(*) as value
        FROM work_reports wr
        JOIN staff_users s ON wr.employee_id = s.id
        WHERE ${whereSql}
        GROUP BY \`key\`, label
        ORDER BY \`key\` ASC
      `, params);

      return res.status(200).json({ success: true, data: rows });
    }

    // Weekly or Monthly: daily points
    const [rows] = await pool.query(`
      SELECT 
        DATE_FORMAT(wr.report_date, '%Y-%m-%d') as \`key\`,
        DATE_FORMAT(wr.report_date, '%a') as weekday,
        COUNT(*) as value
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      WHERE ${whereSql}
      GROUP BY \`key\`, weekday
      ORDER BY \`key\` ASC
    `, params);

    const dataMap = new Map();
    rows.forEach(r => dataMap.set(r.key, Number(r.value)));

    // Generate continuous series for all days in range
    const result = [];
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let curr = new Date(startDate);
    const end = new Date(endDate);

    while (curr <= end) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${d}`;
      const weekdayLabel = weekdays[curr.getDay()];

      result.push({
        key: dateKey,
        label: period === 'weekly' ? weekdayLabel : `${d}/${m}`,
        value: dataMap.get(dateKey) || 0,
      });

      curr.setDate(curr.getDate() + 1);
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 36. GET /dashboard/tasks (Scoped)
 * Task counts: Pending and Ongoing count all open tasks; Completed counts tasks completed today.
 */
async function getDashboardTasks(req, res, next) {
  try {
    const scope = await resolveDashboardScope(req);
    const callerId = scope.callerId;

    let filter = '1=1';
    let params = [];

    if (scope.hasAllReports) {
      // MD / whole company sees all
    } else if (scope.isMultiTeamManager) {
      filter = '(tk.lead_id IN (SELECT lead_id FROM teams WHERE id IN (?)) OR tk.employee_id IN (SELECT id FROM staff_users WHERE team_id IN (?)))';
      params.push(scope.managedTeamIds, scope.managedTeamIds);
    } else if (scope.isLead) {
      filter = '(tk.lead_id = ? OR tk.employee_id IN (SELECT id FROM staff_users WHERE team_id = ?))';
      params.push(callerId, scope.teamId);
    } else {
      filter = 'tk.employee_id = ?';
      params.push(callerId);
    }

    const [rows] = await pool.query(`
      SELECT 
        SUM(CASE WHEN tk.status = 'Pending' THEN 1 ELSE 0 END) as \`pending\`,
        SUM(CASE WHEN tk.status = 'Ongoing' THEN 1 ELSE 0 END) as \`ongoing\`,
        SUM(CASE WHEN tk.status = 'Completed' AND DATE(tk.completed_at) = CURDATE() THEN 1 ELSE 0 END) as \`completed\`
      FROM tasks tk
      WHERE ${filter}
    `, params);

    const counts = rows[0] || {};

    return res.status(200).json({
      success: true,
      data: {
        pending: Number(counts.pending) || 0,
        ongoing: Number(counts.ongoing) || 0,
        completed: Number(counts.completed) || 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 37. GET /performance/employees (MD, Lead)
 * Section 8.2: 40/40/20 scoring algorithm
 * One row per employee with metrics, score and rating.
 */
async function getEmployeePerformance(req, res, next) {
  try {
    const scope = await resolveDashboardScope(req);
    const callerId = scope.callerId;
    const period = (req.query.period || 'monthly').toLowerCase();
    const teamIdFilter = req.query.teamId;

    const { startDate, endDate, workingDays } = getPeriodDateRange(period);

    let whereSql = "s.is_active = 1 AND s.role NOT IN ('ADMIN', 'SUPER_ADMIN')";
    let params = [];

    if (scope.hasAllReports) {
      if (teamIdFilter) {
        whereSql += ' AND s.team_id = ?';
        params.push(teamIdFilter);
      }
    } else if (scope.isMultiTeamManager) {
      if (teamIdFilter && scope.managedTeamIds.map(String).includes(String(teamIdFilter))) {
        whereSql += ' AND s.team_id = ?';
        params.push(teamIdFilter);
      } else {
        whereSql += ' AND s.team_id IN (?)';
        params.push(scope.managedTeamIds);
      }
    } else if (scope.isLead) {
      whereSql += ' AND s.team_id = ?';
      params.push(scope.teamId);
    } else {
      whereSql += ' AND s.id = ?';
      params.push(callerId);
    }

    // Query employees
    const [employees] = await pool.query(`
      SELECT 
        s.id,
        s.employee_id as employeeId,
        s.full_name as name,
        s.role,
        s.team_id as teamId,
        t.name as teamName
      FROM staff_users s
      LEFT JOIN teams t ON s.team_id = t.id
      WHERE ${whereSql}
      ORDER BY s.full_name ASC
    `, params);

    if (employees.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const employeeIds = employees.map(e => e.id);

    // 1. Get reports and visits per employee in period
    const [reportRows] = await pool.query(`
      SELECT 
        employee_id,
        COUNT(*) as calls,
        SUM(CASE WHEN site_visit != 'Not Planned' THEN 1 ELSE 0 END) as visits
      FROM work_reports
      WHERE employee_id IN (?) AND report_date >= ? AND report_date <= ?
      GROUP BY employee_id
    `, [employeeIds, startDate, endDate]);

    const reportMap = new Map();
    reportRows.forEach(r => reportMap.set(r.employee_id, {
      calls: Number(r.calls) || 0,
      visits: Number(r.visits) || 0,
    }));

    // 2. Get tasks per employee in period
    const [taskRows] = await pool.query(`
      SELECT 
        employee_id,
        COUNT(*) as tasks,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as done
      FROM tasks
      WHERE employee_id IN (?) AND due_date >= ? AND due_date <= ?
      GROUP BY employee_id
    `, [employeeIds, startDate, endDate]);

    const taskMap = new Map();
    taskRows.forEach(t => taskMap.set(t.employee_id, {
      tasks: Number(t.tasks) || 0,
      done: Number(t.done) || 0,
    }));

    // Calculate score using Section 8.2 formulas
    const data = employees.map(emp => {
      const rep = reportMap.get(emp.id) || { calls: 0, visits: 0 };
      const tsk = taskMap.get(emp.id) || { tasks: 0, done: 0 };

      const calls = rep.calls;
      const visits = rep.visits;
      const tasks = tsk.tasks;
      const done = tsk.done;

      let taskScore = 0;
      let taskMax = 40;
      let callMax = 40;
      let visitMax = 20;

      if (tasks === 0) {
        // Drop task part and redistribute weight across other two: total 100 (66.6 / 33.3)
        taskMax = 0;
        callMax = 66.67;
        visitMax = 33.33;
      } else {
        taskScore = 40 * (done / tasks);
      }

      // Calls target: 30 calls per employee per working day
      const expectedCalls = 30 * workingDays * 1;
      const callScore = callMax * Math.min(1, calls / Math.max(1, expectedCalls));

      // Visits target: (workingDays * 1) / 4
      const expectedVisits = Math.max(1, (workingDays * 1) / 4);
      const visitScore = visitMax * Math.min(1, visits / expectedVisits);

      const totalScore = Math.round(taskScore + callScore + visitScore);

      let rating = 'Needs attention';
      if (totalScore >= 85) rating = 'Excellent';
      else if (totalScore >= 70) rating = 'Good';
      else if (totalScore >= 50) rating = 'Average';

      return {
        id: String(emp.id),
        employeeId: emp.employeeId,
        name: emp.name,
        role: emp.role,
        teamId: emp.teamId ? String(emp.teamId) : null,
        teamName: emp.teamName || null,
        metrics: {
          calls,
          visits,
          tasks,
          done,
          workingDays,
        },
        score: totalScore,
        rating,
        breakdown: [
          { label: 'Tasks done', got: Math.round(taskScore), max: taskMax },
          { label: 'Calls', got: Math.round(callScore), max: Math.round(callMax) },
          { label: 'Site visits', got: Math.round(visitScore), max: Math.round(visitMax) },
        ],
      };
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 38. GET /performance/teams (MD only)
 * One row per team with metrics, score and rating.
 */
async function getTeamPerformance(req, res, next) {
  try {
    const scope = await resolveDashboardScope(req);
    const period = (req.query.period || 'monthly').toLowerCase();
    const { startDate, endDate, workingDays } = getPeriodDateRange(period);

    let teamWhere = '1=1';
    let teamParams = [];

    if (!scope.hasAllReports) {
      if (scope.isMultiTeamManager) {
        teamWhere = 't.id IN (?)';
        teamParams.push(scope.managedTeamIds);
      } else if (scope.isLead) {
        teamWhere = 't.id = ?';
        teamParams.push(scope.teamId);
      } else {
        teamWhere = '1=0';
      }
    }

    const [teams] = await pool.query(`
      SELECT 
        t.id,
        t.name,
        t.lead_id as leadId,
        s.full_name as leadName,
        (SELECT COUNT(*) FROM staff_users m WHERE m.team_id = t.id) as employeeCount
      FROM teams t
      LEFT JOIN staff_users s ON t.lead_id = s.id
      WHERE ${teamWhere}
      ORDER BY t.name ASC
    `, teamParams);

    if (teams.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const teamIds = teams.map(t => t.id);

    // Calls and visits by team
    const [reportRows] = await pool.query(`
      SELECT 
        s.team_id as teamId,
        COUNT(*) as calls,
        SUM(CASE WHEN wr.site_visit != 'Not Planned' THEN 1 ELSE 0 END) as visits
      FROM work_reports wr
      JOIN staff_users s ON wr.employee_id = s.id
      WHERE s.team_id IN (?) AND wr.report_date >= ? AND wr.report_date <= ?
      GROUP BY s.team_id
    `, [teamIds, startDate, endDate]);

    const reportMap = new Map();
    reportRows.forEach(r => reportMap.set(r.teamId, {
      calls: Number(r.calls) || 0,
      visits: Number(r.visits) || 0,
    }));

    // Tasks by team lead
    const [taskRows] = await pool.query(`
      SELECT 
        tk.lead_id as leadId,
        COUNT(*) as tasks,
        SUM(CASE WHEN tk.status = 'Completed' THEN 1 ELSE 0 END) as done
      FROM tasks tk
      WHERE tk.due_date >= ? AND tk.due_date <= ?
      GROUP BY tk.lead_id
    `, [startDate, endDate]);

    const taskMap = new Map();
    taskRows.forEach(t => taskMap.set(t.leadId, {
      tasks: Number(t.tasks) || 0,
      done: Number(t.done) || 0,
    }));

    const data = teams.map(tm => {
      const empCount = Math.max(1, Number(tm.employeeCount) || 1);
      const rep = reportMap.get(tm.id) || { calls: 0, visits: 0 };
      const tsk = taskMap.get(tm.leadId) || { tasks: 0, done: 0 };

      const calls = rep.calls;
      const visits = rep.visits;
      const tasks = tsk.tasks;
      const done = tsk.done;

      let taskScore = 0;
      let taskMax = 40;
      let callMax = 40;
      let visitMax = 20;

      if (tasks === 0) {
        taskMax = 0;
        callMax = 66.67;
        visitMax = 33.33;
      } else {
        taskScore = 40 * (done / tasks);
      }

      // Calls target: 30 * workingDays * numberOfEmployees
      const targetCalls = 30 * workingDays * empCount;
      const callScore = callMax * Math.min(1, calls / targetCalls);

      // Visits target: (workingDays * empCount) / 4
      const targetVisits = Math.max(1, (workingDays * empCount) / 4);
      const visitScore = visitMax * Math.min(1, visits / targetVisits);

      const totalScore = Math.round(taskScore + callScore + visitScore);

      let rating = 'Needs attention';
      if (totalScore >= 85) rating = 'Excellent';
      else if (totalScore >= 70) rating = 'Good';
      else if (totalScore >= 50) rating = 'Average';

      return {
        id: String(tm.id),
        name: tm.name,
        leadId: tm.leadId ? String(tm.leadId) : null,
        leadName: tm.leadName || '',
        employeeCount: empCount,
        metrics: {
          calls,
          visits,
          tasks,
          done,
          workingDays,
        },
        score: totalScore,
        rating,
        breakdown: [
          { label: 'Tasks done', got: Math.round(taskScore), max: taskMax },
          { label: 'Calls', got: Math.round(callScore), max: Math.round(callMax) },
          { label: 'Site visits', got: Math.round(visitScore), max: Math.round(visitMax) },
        ],
      };
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboardSummary,
  getDashboardTrend,
  getDashboardTasks,
  getEmployeePerformance,
  getTeamPerformance,
};
