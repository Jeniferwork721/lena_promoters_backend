const { pool } = require('../config/db');

/**
 * 1. Get All Properties (with filtering for search, city, and featured)
 */
async function getAllProperties(req, res, next) {
  try {
    const { city, search, isFeatured } = req.query;

    let query = 'SELECT * FROM properties WHERE 1=1';
    const params = [];

    if (city && city !== 'All Locations' && city !== 'All') {
      query += ' AND city LIKE ?';
      params.push(`%${city}%`);
    }

    if (isFeatured !== undefined) {
      query += ' AND is_featured = ?';
      params.push(isFeatured === 'true' || isFeatured === '1' ? 1 : 0);
    }

    if (search && search.trim().length > 0) {
      query += ' AND (title LIKE ? OR location LIKE ? OR approval LIKE ? OR category LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY is_featured DESC, created_at DESC';

    const [rows] = await pool.query(query, params);

    // Parse JSON amenities and map fields to match Flutter PlotModel
    const properties = rows.map(plot => ({
      id: plot.id,
      title: plot.title,
      location: plot.location,
      city: plot.city,
      priceStarting: plot.price_starting,
      pricePerSqFt: plot.price_per_sqft,
      plotSizes: plot.plot_sizes,
      approval: plot.approval,
      reraNumber: plot.rera_number,
      category: plot.category,
      imagePath: plot.image_path,
      amenities: typeof plot.amenities === 'string' ? JSON.parse(plot.amenities || '[]') : (plot.amenities || []),
      isFeatured: Boolean(plot.is_featured),
    }));

    return res.status(200).json({
      success: true,
      count: properties.length,
      data: properties,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Get Single Property by ID
 */
async function getPropertyById(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    const plot = rows[0];
    const property = {
      id: plot.id,
      title: plot.title,
      location: plot.location,
      city: plot.city,
      priceStarting: plot.price_starting,
      pricePerSqFt: plot.price_per_sqft,
      plotSizes: plot.plot_sizes,
      approval: plot.approval,
      reraNumber: plot.rera_number,
      category: plot.category,
      imagePath: plot.image_path,
      amenities: typeof plot.amenities === 'string' ? JSON.parse(plot.amenities || '[]') : (plot.amenities || []),
      isFeatured: Boolean(plot.is_featured),
    };

    return res.status(200).json({
      success: true,
      data: property,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Create Property (Staff / Admin)
 */
async function createProperty(req, res, next) {
  try {
    const {
      id,
      title,
      location,
      city,
      priceStarting,
      pricePerSqFt,
      plotSizes,
      approval,
      reraNumber,
      category = 'Villa Plots',
      imagePath,
      amenities = [],
      isFeatured = false,
    } = req.body;

    if (!title || !location || !city || !priceStarting) {
      return res.status(400).json({
        success: false,
        message: 'Please provide required property title, location, city, and pricing.',
      });
    }

    const propertyId = id || `lp-${Date.now().toString().slice(-4)}`;
    const amenitiesJson = JSON.stringify(Array.isArray(amenities) ? amenities : []);

    await pool.query(
      `INSERT INTO properties (id, title, location, city, price_starting, price_per_sqft, plot_sizes, approval, rera_number, category, image_path, amenities, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        propertyId,
        title,
        location,
        city,
        priceStarting,
        pricePerSqFt || '',
        plotSizes || '',
        approval || 'DTCP & RERA Approved',
        reraNumber || '',
        category,
        imagePath || 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914',
        amenitiesJson,
        isFeatured ? 1 : 0,
      ]
    );

    const createdProperty = {
      id: propertyId,
      title,
      location,
      city,
      priceStarting,
      pricePerSqFt: pricePerSqFt || priceStarting,
      plotSizes: plotSizes || 'Plots Available',
      approval: approval || 'DTCP & RERA Approved',
      reraNumber: reraNumber || '',
      category,
      imagePath: imagePath || 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
      amenities: Array.isArray(amenities) ? amenities : ['40ft Road', 'Sweet Ground Water', 'Clear Parent Deeds'],
      isFeatured: Boolean(isFeatured),
    };

    return res.status(201).json({
      success: true,
      message: 'Property listing created successfully',
      propertyId,
      property: createdProperty,
      data: createdProperty,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Update Property
 */
async function updateProperty(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title,
      location,
      city,
      priceStarting,
      pricePerSqFt,
      plotSizes,
      approval,
      reraNumber,
      category,
      imagePath,
      amenities,
      isFeatured,
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM properties WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const current = existing[0];
    const updatedAmenities = amenities !== undefined ? JSON.stringify(amenities) : current.amenities;

    await pool.query(
      `UPDATE properties SET
        title = ?,
        location = ?,
        city = ?,
        price_starting = ?,
        price_per_sqft = ?,
        plot_sizes = ?,
        approval = ?,
        rera_number = ?,
        category = ?,
        image_path = ?,
        amenities = ?,
        is_featured = ?
       WHERE id = ?`,
      [
        title ?? current.title,
        location ?? current.location,
        city ?? current.city,
        priceStarting ?? current.price_starting,
        pricePerSqFt ?? current.price_per_sqft,
        plotSizes ?? current.plot_sizes,
        approval ?? current.approval,
        reraNumber ?? current.rera_number,
        category ?? current.category,
        imagePath ?? current.image_path,
        updatedAmenities,
        isFeatured !== undefined ? (isFeatured ? 1 : 0) : current.is_featured,
        id,
      ]
    );

    const updated = {
      id,
      title: title ?? current.title,
      location: location ?? current.location,
      city: city ?? current.city,
      priceStarting: priceStarting ?? current.price_starting,
      pricePerSqFt: pricePerSqFt ?? current.price_per_sqft,
      plotSizes: plotSizes ?? current.plot_sizes,
      approval: approval ?? current.approval,
      reraNumber: reraNumber ?? current.rera_number,
      category: category ?? current.category,
      imagePath: imagePath ?? current.image_path,
      amenities: amenities !== undefined ? (Array.isArray(amenities) ? amenities : []) : (typeof current.amenities === 'string' ? JSON.parse(current.amenities || '[]') : (current.amenities || [])),
      isFeatured: isFeatured !== undefined ? Boolean(isFeatured) : Boolean(current.is_featured),
    };

    return res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      property: updated,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Delete Property
 */
async function deleteProperty(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM properties WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Property deleted successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. Get Available Cities
 */
async function getCities(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT DISTINCT city FROM properties ORDER BY city ASC');
    const cities = rows.map(r => r.city);
    return res.status(200).json({
      success: true,
      cities: ['All Locations', ...cities],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  getCities,
};
