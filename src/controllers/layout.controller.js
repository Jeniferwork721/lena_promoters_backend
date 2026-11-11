const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');

/**
 * Format DB row to Layout spec object
 */
function formatLayout(r) {
  let parsedOffers = [];
  try {
    parsedOffers = typeof r.offers === 'string' ? JSON.parse(r.offers) : (r.offers || []);
  } catch (_) {
    parsedOffers = [];
  }

  let parsedImages = [];
  try {
    parsedImages = typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || []);
  } catch (_) {
    parsedImages = [];
  }

  let parsedAmenities = [];
  try {
    parsedAmenities = typeof r.amenities === 'string' ? JSON.parse(r.amenities) : (r.amenities || []);
  } catch (_) {
    parsedAmenities = [];
  }

  // Derive numeric pricePerCent if not explicitly numeric
  let pricePerCent = r.price_per_cent != null ? parseFloat(r.price_per_cent) : null;
  if (pricePerCent == null && r.price_starting) {
    const num = parseFloat(String(r.price_starting).replace(/[^\d.]/g, ''));
    if (!isNaN(num)) pricePerCent = num;
  }

  const primaryImage = (parsedImages && parsedImages[0]) || r.image_path || 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80';

  return {
    id: String(r.id),
    name: r.title || r.name,
    title: r.title || r.name,
    location: r.location,
    city: r.city || '',
    pricePerCent: pricePerCent || 0,
    priceStarting: r.price_starting || (pricePerCent ? `₹${pricePerCent.toLocaleString('en-IN')} / ${r.price_unit || 'cent'}` : ''),
    priceUnit: r.price_unit || 'cent',
    offers: Array.isArray(parsedOffers) ? parsedOffers : [],
    propertyType: r.category || r.property_type || 'DTCP Plot',
    category: r.category || r.property_type || 'DTCP Plot',
    plotSizes: r.plot_sizes || '',
    approval: r.approval || 'DTCP Approved',
    reraNumber: r.rera_number || '',
    plotMin: r.plot_min != null ? parseFloat(r.plot_min) : null,
    plotMax: r.plot_max != null ? parseFloat(r.plot_max) : null,
    budgetMin: r.budget_min != null ? parseFloat(r.budget_min) : null,
    budgetMax: r.budget_max != null ? parseFloat(r.budget_max) : null,
    totalPlots: r.total_plots != null ? parseInt(r.total_plots, 10) : 0,
    availablePlots: r.available_plots != null ? parseInt(r.available_plots, 10) : 0,
    cornerPlots: Boolean(r.corner_plots),
    pdfUrl: r.pdf_url || null,
    imagePath: primaryImage,
    images: Array.isArray(parsedImages) && parsedImages.length > 0 ? parsedImages : [primaryImage],
    amenities: Array.isArray(parsedAmenities) ? parsedAmenities : [],
    note: r.note || '',
    ongoing: r.ongoing !== undefined ? Boolean(r.ongoing) : true,
    active: r.active !== undefined ? Boolean(r.active) : true,
    isFeatured: Boolean(r.is_featured),
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
    const { ongoing } = req.query;

    let query = 'SELECT * FROM properties WHERE (active = 1 OR active IS NULL)';
    const params = [];

    if (ongoing === 'true' || ongoing === '1') {
      query += ' AND (ongoing = 1 OR ongoing IS NULL)';
    }

    query += ' ORDER BY is_featured DESC, title ASC';

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
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM properties WHERE id = ? OR title = ? LIMIT 1',
      [id, id]
    );
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
    const staff = req.staff;
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MD', 'SALES_HEAD', 'HEAD_MANAGER', 'MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only MD or Sales Head can add new layouts.',
      });
    }

    const {
      id,
      name,
      title,
      location,
      city,
      pricePerCent,
      priceStarting,
      priceUnit = 'cent',
      offers,
      propertyType = 'DTCP Plot',
      category,
      plotSizes,
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
      approval,
      reraNumber,
      imagePath,
      images,
      amenities,
    } = req.body;

    const finalTitle = (name || title || '').trim();
    if (!finalTitle) {
      return res.status(400).json({ success: false, message: 'Layout name is required.' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ success: false, message: 'Layout location is required.' });
    }

    const numPrice = pricePerCent != null ? parseFloat(pricePerCent) : (priceStarting ? parseFloat(String(priceStarting).replace(/[^\d.]/g, '')) : 0);
    const finalPriceStarting = priceStarting || (numPrice ? `₹${Number(numPrice).toLocaleString('en-IN')} / ${priceUnit}` : '₹0');
    const finalPricePerSqFt = numPrice ? `₹${Math.round(numPrice / 435.6).toLocaleString('en-IN')} / sq.ft` : '';
    const finalCity = city || location;
    const finalCategory = propertyType || category || 'Layout Plots';

    // Unique ID
    const layoutId = id || `lp-${Date.now().toString(36)}`;

    const offersJson = offers !== undefined
      ? (Array.isArray(offers) ? JSON.stringify(offers) : JSON.stringify([offers]))
      : JSON.stringify(['Document Free', '50% Offer', 'Bank Loan', 'Plot With Rent']);

    const defaultCover = imagePath || 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80';
    const imagesJson = images ? (Array.isArray(images) ? JSON.stringify(images) : JSON.stringify([images])) : JSON.stringify([defaultCover]);
    const amenitiesJson = amenities ? (Array.isArray(amenities) ? JSON.stringify(amenities) : JSON.stringify([amenities])) : JSON.stringify(['40ft Tar Road', 'Sweet Ground Water', 'Clear Parent Deeds', 'Electricity Facility']);

    await pool.query(
      `INSERT INTO properties (
        id, title, location, city, price_starting, price_per_cent, price_unit, price_per_sqft,
        plot_sizes, approval, rera_number, category, image_path, images, amenities, offers,
        plot_min, plot_max, budget_min, budget_max, total_plots, available_plots,
        corner_plots, pdf_url, note, ongoing, active, is_featured
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        layoutId,
        finalTitle,
        location.trim(),
        finalCity.trim(),
        finalPriceStarting,
        numPrice,
        priceUnit,
        finalPricePerSqFt,
        plotSizes || 'Plots Available',
        approval || 'DTCP Approved',
        reraNumber || '',
        finalCategory,
        defaultCover,
        imagesJson,
        amenitiesJson,
        offersJson,
        plotMin != null ? parseFloat(plotMin) : null,
        plotMax != null ? parseFloat(plotMax) : null,
        budgetMin != null ? parseFloat(budgetMin) : null,
        budgetMax != null ? parseFloat(budgetMax) : null,
        parseInt(totalPlots, 10) || 0,
        parseInt(availablePlots, 10) || 0,
        cornerPlots ? 1 : 0,
        pdfUrl || null,
        note || '',
        ongoing ? 1 : 0,
        active ? 1 : 0,
      ]
    );

    const [newRows] = await pool.query('SELECT * FROM properties WHERE id = ?', [layoutId]);
    return res.status(201).json({
      success: true,
      message: 'Layout created successfully.',
      data: formatLayout(newRows[0]),
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'A layout or property with this name or ID already exists.',
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
    const staff = req.staff;
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MD', 'SALES_HEAD', 'HEAD_MANAGER', 'MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only MD or Sales Head can update layouts.',
      });
    }

    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM properties WHERE id = ? OR title = ?', [id, id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: `Layout '${id}' not found.` });
    }

    const current = existing[0];
    const {
      name,
      title,
      location,
      city,
      pricePerCent,
      priceStarting,
      priceUnit,
      offers,
      propertyType,
      category,
      plotSizes,
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
      approval,
      reraNumber,
      imagePath,
      images,
    } = req.body;

    const offersJson = offers !== undefined
      ? (Array.isArray(offers) ? JSON.stringify(offers) : JSON.stringify([offers]))
      : current.offers;

    let imagesJson = current.images;
    if (images !== undefined) {
      imagesJson = Array.isArray(images) ? JSON.stringify(images) : JSON.stringify([images]);
    }
    const finalImagePath = imagePath !== undefined ? imagePath : (images && images[0] ? images[0] : current.image_path);

    const finalTitle = name !== undefined ? name.trim() : (title !== undefined ? title.trim() : current.title);
    const finalLocation = location !== undefined ? location.trim() : current.location;
    const finalCity = city !== undefined ? city.trim() : current.city;
    const finalPricePerCent = pricePerCent !== undefined ? parseFloat(pricePerCent) : current.price_per_cent;
    const finalPriceUnit = priceUnit !== undefined ? priceUnit : current.price_unit;
    const finalPriceStarting = priceStarting !== undefined ? priceStarting : (finalPricePerCent ? `₹${Number(finalPricePerCent).toLocaleString('en-IN')} / ${finalPriceUnit}` : current.price_starting);
    const finalCategory = propertyType !== undefined ? propertyType : (category !== undefined ? category : current.category);

    await pool.query(
      `UPDATE properties SET
        title = ?,
        location = ?,
        city = ?,
        price_starting = ?,
        price_per_cent = ?,
        price_unit = ?,
        offers = ?,
        category = ?,
        plot_sizes = ?,
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
        active = ?,
        approval = ?,
        rera_number = ?,
        image_path = ?,
        images = ?
       WHERE id = ?`,
      [
        finalTitle,
        finalLocation,
        finalCity,
        finalPriceStarting,
        finalPricePerCent,
        finalPriceUnit,
        offersJson,
        finalCategory,
        plotSizes !== undefined ? plotSizes : current.plot_sizes,
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
        approval !== undefined ? approval : current.approval,
        reraNumber !== undefined ? reraNumber : current.rera_number,
        finalImagePath,
        imagesJson,
        current.id,
      ]
    );

    const [updatedRows] = await pool.query('SELECT * FROM properties WHERE id = ?', [current.id]);
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
    const staff = req.staff;
    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MD', 'SALES_HEAD', 'HEAD_MANAGER', 'MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only MD or Sales Head can delete layouts.',
      });
    }

    const { id } = req.params;
    const [result] = await pool.query('UPDATE properties SET active = 0 WHERE id = ? OR title = ?', [id, id]);

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
    const { id } = req.params;

    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).json({ success: false, message: 'Please upload a PDF file.' });
    }

    const pdfUrl = `/uploads/${file.fieldname === 'receipt' ? 'receipts' : 'properties'}/${file.filename}`;

    const [result] = await pool.query('UPDATE properties SET pdf_url = ? WHERE id = ? OR title = ?', [pdfUrl, id, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: `Layout '${id}' not found.` });
    }

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
