const { pool } = require('../config/db');

/**
 * 1. Get all active branches (Karaikudi Head Office, Coimbatore, Sivagangai, Pudukkottai, Dubai)
 */
async function getBranches(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT 
        id, 
        branch_name AS name, 
        branch_name AS branchName, 
        address, 
        city, 
        pincode, 
        phone, 
        is_head_office AS isHeadOffice, 
        is_active AS isActive 
       FROM branches 
       WHERE is_active = 1 
       ORDER BY is_head_office DESC, id ASC`
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      branches: rows,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Get single branch by ID or branch name
 */
async function getBranchById(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT 
        id, 
        branch_name AS name, 
        branch_name AS branchName, 
        address, 
        city, 
        pincode, 
        phone, 
        is_head_office AS isHeadOffice, 
        is_active AS isActive 
       FROM branches 
       WHERE (id = ? OR branch_name = ?) AND is_active = 1 
       LIMIT 1`,
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found.',
      });
    }

    return res.status(200).json({
      success: true,
      branch: rows[0],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBranches,
  getBranchById,
};
