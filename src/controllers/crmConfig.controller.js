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

module.exports = {
  getConfigOptions,
  updateConfigOptionList,
};
