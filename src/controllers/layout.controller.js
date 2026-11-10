const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');

/**
 * Helper: Ensures layouts table exists dynamically
 */
async function ensureLayoutsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS layouts (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(150) NOT NULL UNIQUE,
        location VARCHAR(255) NOT NULL,
        price_per_cent DECIMAL(12,2) NOT NULL DEFAULT 0,
        price_unit VARCHAR(20) NOT NULL DEFAULT 'cent',
        offers JSON NULL,
        property_type VARCHAR(100) NULL DEFAULT 'DTCP Plot',
        plot_min DECIMAL(8,2) NULL,
        plot_max DECIMAL(8,2) NULL,
        budget_min DECIMAL(12,2) NULL,
        budget_max DECIMAL(12,2) NULL,
        total_plots INT NULL DEFAULT 0,
        available_plots INT NULL DEFAULT 0,
        corner_plots TINYINT(1) NOT NULL DEFAULT 0,
        pdf_url TEXT NULL,
        note TEXT NULL,
        ongoing TINYINT(1) NOT NULL DEFAULT 1,
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_layout_name (name),
        INDEX idx_layout_ongoing (ongoing, active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  } catch (err) {
    console.warn('⚠️ [ensureLayoutsTable] Table check notice:', err.message);
  }
}

/**
 * Format layout DB row to spec object
 */
function formatLayout(r) {
  let parsedOffers = [];
  try {
    parsedOffers = typeof r.offers === 'string' ? JSON.parse(r.offers) : (r.offers || []);
  } catch (_) {
    parsedOffers = [];
  }

  return {
    id: String(r.id),
    name: r.name,
    location: r.location,
    pricePerCent: parseFloat(r.price_per_cent || 0),
    priceUnit: r.price_unit || 'cent',
    offers: Array.isArray(parsedOffers) ? parsedOffers : [],
    propertyType: r.property_type || 'DTCP Plot',
    plotMin: r.plot_min != null ? parseFloat(r.plot_min) : null,
    plotMax: r.plot_max != null ? parseFloat(r.plot_max) : null,
    budgetMin: r.budget_min != null ? parseFloat(r.budget_min) : null,
    budgetMax: r.budget_max != null ? parseFloat(r.budget_max) : null,
    totalPlots: r.total_plots != null ? parseInt(r.total_plots, 10) : 0,
    availablePlots: r.available_plots != null ? parseInt(r.available_plots, 10) : 0,
    cornerPlots: Boolean(r.corner_plots),
    pdfUrl: r.pdf_url || null,
    note: r.note || '',
    ongoing: Boolean(r.ongoing),
    active: Boolean(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * 1. GET /layouts
 * Query: ?ongoing=true
 */
async function getLayouts(req, res, next) {
  try {
    await ensureLayoutsTable();
    const { ongoing } = req.query;

    let query = 'SELECT * FROM layouts WHERE active = 1';
    const params = [];

    if (ongoing === 'true' || ongoing === '1') {
      query += ' AND ongoing = 1';
    }

    query += ' ORDER BY name ASC';

    const [rows] = await pool.query(query, params);
    return res.status(200).json({
      success: true,
      data: rows.map(formatLayout),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. GET /layouts/:id
 */
async function getLayoutById(req, res, next) {
  try {
    await ensureLayoutsTable();
    const { id } = req.params;

    const [rows] = await pool.query('SELECT * FROM layouts WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Layout with id '${id}' not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      data: formatLayout(rows[0]),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. POST /layouts (MD, Sales Head, Manager, Admin)
 */
async function createLayout(req, res, next) {
  try {
    await ensureLayoutsTable();
    const staff = req.staff;
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MD', 'SALES_HEAD', 'HEAD_MANAGER', 'MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only MD or Sales Head can add new layouts.',
      });
    }

    const {
      name,
      location,
      pricePerCent,
      priceUnit = 'cent',
      offers,
      propertyType = 'DTCP Plot',
      plotMin,
      plotMax,
      budgetMin,
      budgetMax,
      totalPlots = 0,
      availablePlots = 0,
      cornerPlots = false,
      pdfUrl,
      note,
      ongoing = true,
      active = true,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Layout name is required.' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ success: false, message: 'Layout location is required.' });
    }
    if (pricePerCent == null || isNaN(pricePerCent)) {
      return res.status(400).json({ success: false, message: 'Price per cent is required.' });
    }

    const id = 'lay-' + Date.now();
    const offersJson = Array.isArray(offers) ? JSON.stringify(offers) : (offers ? JSON.stringify([offers]) : '[]');

    await pool.query(
      `INSERT INTO layouts (
        id, name, location, price_per_cent, price_unit, offers,
        property_type, plot_min, plot_max, budget_min, budget_max,
        total_plots, available_plots, corner_plots, pdf_url, note, ongoing, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name.trim(),
        location.trim(),
        parseFloat(pricePerCent) || 0,
        priceUnit,
        offersJson,
        propertyType,
        plotMin != null ? parseFloat(plotMin) : null,
        plotMax != null ? parseFloat(plotMax) : null,
        budgetMin != null ? parseFloat(budgetMin) : null,
        budgetMax != null ? parseFloat(budgetMax) : null,
        parseInt(totalPlots, 10) || 0,
        parseInt(availablePlots, 10) || 0,
        cornerPlots ? 1 : 0,
        pdfUrl || null,
        note || '',
        ongoing !== false ? 1 : 0,
        active !== false ? 1 : 0,
      ]
    );

    const [createdRows] = await pool.query('SELECT * FROM layouts WHERE id = ?', [id]);
    return res.status(201).json({
      success: true,
      message: `Layout '${name.trim()}' created successfully.`,
      data: formatLayout(createdRows[0]),
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'A layout with this name already exists.',
      });
    }
    next(err);
  }
}

/**
 * 4. PUT /layouts/:id (MD, Sales Head, Manager, Admin)
 */
async function updateLayout(req, res, next) {
  try {
    await ensureLayoutsTable();
    const staff = req.staff;
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MD', 'SALES_HEAD', 'HEAD_MANAGER', 'MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only MD or Sales Head can update layouts.',
      });
    }

    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM layouts WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `Layout '${id}' not found.` });
    }

    const current = existing[0];
    const {
      name,
      location,
      pricePerCent,
      priceUnit,
      offers,
      propertyType,
      plotMin,
      plotMax,
      budgetMin,
      budgetMax,
      totalPlots,
      availablePlots,
      cornerPlots,
      pdfUrl,
      note,
      ongoing,
      active,
    } = req.body;

    const offersJson = offers !== undefined
      ? (Array.isArray(offers) ? JSON.stringify(offers) : JSON.stringify([offers]))
      : current.offers;

    await pool.query(
      `UPDATE layouts SET
        name = ?,
        location = ?,
        price_per_cent = ?,
        price_unit = ?,
        offers = ?,
        property_type = ?,
        plot_min = ?,
        plot_max = ?,
        budget_min = ?,
        budget_max = ?,
        total_plots = ?,
        available_plots = ?,
        corner_plots = ?,
        pdf_url = ?,
        note = ?,
        ongoing = ?,
        active = ?
       WHERE id = ?`,
      [
        name !== undefined ? name.trim() : current.name,
        location !== undefined ? location.trim() : current.location,
        pricePerCent !== undefined ? parseFloat(pricePerCent) : current.price_per_cent,
        priceUnit !== undefined ? priceUnit : current.price_unit,
        offersJson,
        propertyType !== undefined ? propertyType : current.property_type,
        plotMin !== undefined ? (plotMin != null ? parseFloat(plotMin) : null) : current.plot_min,
        plotMax !== undefined ? (plotMax != null ? parseFloat(plotMax) : null) : current.plot_max,
        budgetMin !== undefined ? (budgetMin != null ? parseFloat(budgetMin) : null) : current.budget_min,
        budgetMax !== undefined ? (budgetMax != null ? parseFloat(budgetMax) : null) : current.budget_max,
        totalPlots !== undefined ? parseInt(totalPlots, 10) : current.total_plots,
        availablePlots !== undefined ? parseInt(availablePlots, 10) : current.available_plots,
        cornerPlots !== undefined ? (cornerPlots ? 1 : 0) : current.corner_plots,
        pdfUrl !== undefined ? pdfUrl : current.pdf_url,
        note !== undefined ? note : current.note,
        ongoing !== undefined ? (ongoing ? 1 : 0) : current.ongoing,
        active !== undefined ? (active ? 1 : 0) : current.active,
        id,
      ]
    );

    const [updatedRows] = await pool.query('SELECT * FROM layouts WHERE id = ?', [id]);
    return res.status(200).json({
      success: true,
      message: 'Layout updated successfully.',
      data: formatLayout(updatedRows[0]),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. DELETE /layouts/:id (MD, Sales Head - Soft Delete)
 */
async function deleteLayout(req, res, next) {
  try {
    await ensureLayoutsTable();
    const staff = req.staff;
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MD', 'SALES_HEAD', 'HEAD_MANAGER', 'MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only MD or Sales Head can delete layouts.',
      });
    }

    const { id } = req.params;
    const [result] = await pool.query('UPDATE layouts SET active = 0 WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Layout '${id}' not found.` });
    }

    return res.status(200).json({
      success: true,
      message: `Layout '${id}' has been deactivated. Old reports will continue to show its name.`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. POST /layouts/:id/pdf (Upload layout PDF)
 */
async function uploadLayoutPdf(req, res, next) {
  try {
    await ensureLayoutsTable();
    const { id } = req.params;

    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).json({ success: false, message: 'Please upload a PDF file.' });
    }

    const pdfUrl = `/uploads/${file.fieldname === 'receipt' ? 'receipts' : 'properties'}/${file.filename}`;

    await pool.query('UPDATE layouts SET pdf_url = ? WHERE id = ?', [pdfUrl, id]);

    return res.status(200).json({
      success: true,
      message: 'Layout PDF uploaded successfully.',
      pdfUrl,
      data: { id, pdfUrl },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLayouts,
  getLayoutById,
  createLayout,
  updateLayout,
  deleteLayout,
  uploadLayoutPdf,
};
