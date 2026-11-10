const { pool } = require('../config/db');
const { DEFAULT_CRM_OPTIONS, CALL_TARGET_PER_DAY, PERIOD_LENGTHS } = require('../config/crmOptions');

/**
 * 39. GET /config/options (All authenticated staff)
 * Returns all dropdown lists and system constants.
 */
async function getConfigOptions(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT list_name, list_values FROM config_options');

    const options = { ...DEFAULT_CRM_OPTIONS };
    for (const r of rows) {
      try {
        const parsed = typeof r.list_values === 'string' ? JSON.parse(r.list_values) : r.list_values;
        if (Array.isArray(parsed)) {
          options[r.list_name] = parsed;
        }
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      data: {
        ...options,
        callTargetPerDay: CALL_TARGET_PER_DAY,
        periodLengths: PERIOD_LENGTHS,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 39b. GET /config/options/:list (All authenticated staff)
 * Returns values for one option list, e.g. GET /config/options/offers
 */
async function getConfigOptionList(req, res, next) {
  try {
    const listName = req.params.list;
    const [rows] = await pool.query('SELECT list_values FROM config_options WHERE list_name = ? LIMIT 1', [listName]);

    let values = DEFAULT_CRM_OPTIONS[listName] || [];
    if (rows.length > 0) {
      try {
        const parsed = typeof rows[0].list_values === 'string' ? JSON.parse(rows[0].list_values) : rows[0].list_values;
        if (Array.isArray(parsed)) values = parsed;
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      data: {
        list: listName,
        values,
      },
      values,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 40. PUT /config/options/:list (MD only)
 * Replace one option list.
 * Body: { values: ["...", "..."] }
 */
async function updateConfigOptionList(req, res, next) {
  try {
    const listName = req.params.list;
    const { values } = req.body;

    if (!Array.isArray(values) || values.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'values must be a non-empty array of strings.',
      });
    }

    const cleanValues = values.map(v => String(v).trim()).filter(Boolean);

    await pool.query(
      `INSERT INTO config_options (list_name, list_values)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE list_values = VALUES(list_values)`,
      [listName, JSON.stringify(cleanValues)]
    );

    return res.status(200).json({
      success: true,
      message: `Option list '${listName}' updated successfully.`,
      data: {
        list: listName,
        values: cleanValues,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 41. POST /crm/admin/reset-early-data (MD only)
 * Safely removes early test employees, coupons, customers, leads, tasks, and reports
 * while keeping the main Admin account (LP-COMPANY / ADMIN) intact.
 */
async function resetEarlyTestData(req, res, next) {
  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    const [couponRes] = await connection.query('DELETE FROM `lucky_draw_coupons`');
    const [custRes] = await connection.query('DELETE FROM `customers`');
    const [leadRes] = await connection.query('DELETE FROM `customer_leads`');
    const [taskRes] = await connection.query('DELETE FROM `tasks`');
    const [reportRes] = await connection.query('DELETE FROM `work_reports`');
    const [visitRes] = await connection.query('DELETE FROM `site_visits`');
    const [teamRes] = await connection.query('DELETE FROM `teams`');
    const [staffRes] = await connection.query(
      "DELETE FROM `staff_users` WHERE role NOT IN ('ADMIN', 'SUPER_ADMIN') AND employee_id != 'LP-COMPANY'"
    );
    await connection.query('UPDATE `staff_users` SET `team_id` = NULL');
    await connection.query('DELETE FROM `refresh_tokens`');
    await connection.query('DELETE FROM `otp_codes`');

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    return res.status(200).json({
      success: true,
      message: 'Early test data removed successfully. Coupons, customers, tasks, reports, and employees cleared.',
      deleted: {
        coupons: couponRes.affectedRows,
        customers: custRes.affectedRows,
        leads: leadRes.affectedRows,
        tasks: taskRes.affectedRows,
        reports: reportRes.affectedRows,
        visits: visitRes.affectedRows,
        teams: teamRes.affectedRows,
        employees: staffRes.affectedRows,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    connection.release();
  }
}

module.exports = {
  getConfigOptions,
  getConfigOptionList,
  updateConfigOptionList,
  resetEarlyTestData,
};
