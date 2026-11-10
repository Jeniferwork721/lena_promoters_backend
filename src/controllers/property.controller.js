const { pool } = require('../config/db');

/**
 * Helper to safely extract image list for a property
 */
function resolvePropertyImages(plot) {
  let list = [];
  if (plot.images) {
    try {
      list = typeof plot.images === 'string' ? JSON.parse(plot.images) : plot.images;
    } catch (_) {
      list = [];
    }
  }

  if (!Array.isArray(list) || list.length === 0) {
    if (plot.image_path) {
      list = [plot.image_path];
    } else {
      list = ['https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80'];
    }
  }

  return list;
}

/**
 * Helper to format a property / layout row
 */
function formatProperty(plot) {
  const imagesList = resolvePropertyImages(plot);
  const primaryImage = imagesList[0] || plot.image_path;

  let amenitiesList = [];
  if (plot.amenities) {
    try {
      amenitiesList = typeof plot.amenities === 'string' ? JSON.parse(plot.amenities) : plot.amenities;
    } catch (_) {
      amenitiesList = [];
    }
  }
  if (!Array.isArray(amenitiesList) || amenitiesList.length === 0) {
    amenitiesList = ['40ft Road', 'Sweet Water', 'Clear Parent Deeds'];
  }

  let offersList = [];
  if (plot.offers) {
    try {
      offersList = typeof plot.offers === 'string' ? JSON.parse(plot.offers) : plot.offers;
    } catch (_) {
      offersList = [];
    }
  }

  let pricePerCent = plot.price_per_cent != null ? parseFloat(plot.price_per_cent) : null;
  if (pricePerCent == null && plot.price_starting) {
    const num = parseFloat(String(plot.price_starting).replace(/[^\d.]/g, ''));
    if (!isNaN(num)) pricePerCent = num;
  }

  return {
    id: plot.id,
    title: plot.title,
    name: plot.title,
    location: plot.location,
    city: plot.city,
    priceStarting: plot.price_starting,
    pricePerCent: pricePerCent || 0,
    priceUnit: plot.price_unit || 'cent',
    pricePerSqFt: plot.price_per_sqft,
    plotSizes: plot.plot_sizes,
    approval: plot.approval,
    reraNumber: plot.rera_number,
    category: plot.category,
    propertyType: plot.category,
    imagePath: primaryImage,
    images: imagesList,
    amenities: amenitiesList,
    offers: offersList,
    plotMin: plot.plot_min != null ? parseFloat(plot.plot_min) : null,
    plotMax: plot.plot_max != null ? parseFloat(plot.plot_max) : null,
    budgetMin: plot.budget_min != null ? parseFloat(plot.budget_min) : null,
    budgetMax: plot.budget_max != null ? parseFloat(plot.budget_max) : null,
    totalPlots: plot.total_plots != null ? parseInt(plot.total_plots, 10) : 0,
    availablePlots: plot.available_plots != null ? parseInt(plot.available_plots, 10) : 0,
    cornerPlots: Boolean(plot.corner_plots),
    pdfUrl: plot.pdf_url || null,
    note: plot.note || '',
    ongoing: plot.ongoing !== undefined ? Boolean(plot.ongoing) : true,
    active: plot.active !== undefined ? Boolean(plot.active) : true,
    isFeatured: Boolean(plot.is_featured),
    createdAt: plot.created_at,
    updatedAt: plot.updated_at,
  };
}

/**
 * 1. Get All Properties (with filtering for search, city, and featured)
 */
async function getAllProperties(req, res, next) {
  try {
    const { city, search, isFeatured, ongoing } = req.query;

    let query = 'SELECT * FROM properties WHERE (active = 1 OR active IS NULL)';
    const params = [];

    if (city && city !== 'All Locations' && city !== 'All') {
      query += ' AND city LIKE ?';
      params.push(`%${city}%`);
    }

    if (isFeatured !== undefined) {
      query += ' AND is_featured = ?';
      params.push(isFeatured === 'true' || isFeatured === '1' ? 1 : 0);
    }

    if (ongoing !== undefined) {
      query += ' AND ongoing = ?';
      params.push(ongoing === 'true' || ongoing === '1' ? 1 : 0);
    }

    if (search && search.trim().length > 0) {
      query += ' AND (title LIKE ? OR location LIKE ? OR approval LIKE ? OR category LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY is_featured DESC, created_at DESC';

    const [rows] = await pool.query(query, params);
    const properties = rows.map(formatProperty);

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
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ? OR title = ? LIMIT 1', [id, id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: formatProperty(rows[0]),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Create Property (Staff / Admin API)
 * Supports multiple portrait image uploads (1, 2, 3+ images) via multipart/form-data ('images')
 * or via JSON array ('images' / 'imagePath').
 */
async function createProperty(req, res, next) {
  try {
    const {
      id,
      title,
      name,
      location,
      city,
      priceStarting,
      pricePerCent,
      priceUnit = 'cent',
      pricePerSqFt,
      plotSizes,
      plotMin,
      plotMax,
      budgetMin,
      budgetMax,
      totalPlots = 0,
      availablePlots = 0,
      cornerPlots = false,
      offers,
      pdfUrl,
      note = '',
      ongoing = true,
      active = true,
      approval,
      reraNumber,
      category = 'Villa Plots',
      propertyType,
      amenities,
      isFeatured = false,
    } = req.body;

    const finalTitle = (title || name || '').trim();
    if (!finalTitle || !location || !city) {
      return res.status(400).json({
        success: false,
        message: 'Please provide required property title/name, location, and city.',
      });
    }

    const numPrice = pricePerCent != null
      ? parseFloat(pricePerCent)
      : (priceStarting ? parseFloat(String(priceStarting).replace(/[^\d.]/g, '')) : 0);

    const finalPriceStarting = priceStarting || (numPrice ? `₹${Number(numPrice).toLocaleString('en-IN')} / ${priceUnit}` : '₹0');
    const finalPricePerSqFt = pricePerSqFt || (numPrice ? `₹${Math.round(numPrice / 435.6).toLocaleString('en-IN')} / sq.ft` : '');
    const finalCategory = propertyType || category || 'Villa Plots';

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const uploadedImages = [];

    // Check for uploaded files from multipart/form-data
    if (Array.isArray(req.files)) {
      for (const file of req.files) {
        uploadedImages.push(`${baseUrl}/uploads/properties/${file.filename}`);
      }
    } else if (req.files) {
      const allFiles = Object.values(req.files).flat();
      for (const file of allFiles) {
        if (file && file.filename) {
          uploadedImages.push(`${baseUrl}/uploads/properties/${file.filename}`);
        }
      }
    } else if (req.file) {
      uploadedImages.push(`${baseUrl}/uploads/properties/${req.file.filename}`);
    }

    // Check for image URLs passed in body
    let bodyImages = [];
    if (req.body.images) {
      if (Array.isArray(req.body.images)) {
        bodyImages = req.body.images;
      } else if (typeof req.body.images === 'string') {
        try {
          const parsed = JSON.parse(req.body.images);
          if (Array.isArray(parsed)) bodyImages = parsed;
          else bodyImages = [req.body.images];
        } catch (_) {
          bodyImages = req.body.images.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    } else if (req.body.imagePath) {
      bodyImages = [req.body.imagePath];
    }

    const allImages = [...uploadedImages, ...bodyImages];
    const defaultCover = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80';
    const primaryImagePath = allImages.length > 0 ? allImages[0] : defaultCover;
    const finalImages = allImages.length > 0 ? allImages : [primaryImagePath];

    const propertyId = id || `lp-${Date.now().toString().slice(-4)}`;

    // Parse amenities safely as JSON string
    let parsedAmenities = [];
    if (amenities) {
      if (Array.isArray(amenities)) {
        parsedAmenities = amenities;
      } else if (typeof amenities === 'string') {
        try {
          parsedAmenities = JSON.parse(amenities);
        } catch (_) {
          parsedAmenities = amenities.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    }
    if (!Array.isArray(parsedAmenities) || parsedAmenities.length === 0) {
      parsedAmenities = ['40ft Road', 'Sweet Ground Water', 'Clear Parent Deeds'];
    }

    // Parse offers safely
    let parsedOffers = [];
    if (offers) {
      if (Array.isArray(offers)) {
        parsedOffers = offers;
      } else if (typeof offers === 'string') {
        try {
          parsedOffers = JSON.parse(offers);
        } catch (_) {
          parsedOffers = offers.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    }

    const amenitiesJson = JSON.stringify(parsedAmenities);
    const imagesJson = JSON.stringify(finalImages);
    const offersJson = JSON.stringify(parsedOffers);
    const featuredFlag = isFeatured === true || isFeatured === 'true' || isFeatured === '1' || isFeatured === 1 ? 1 : 0;

    await pool.query(
      `INSERT INTO properties (
        id, title, location, city, price_starting, price_per_cent, price_unit, price_per_sqft,
        plot_sizes, approval, rera_number, category, image_path, images, amenities, offers,
        plot_min, plot_max, budget_min, budget_max, total_plots, available_plots,
        corner_plots, pdf_url, note, ongoing, active, is_featured
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        propertyId,
        finalTitle,
        location.trim(),
        city.trim(),
        finalPriceStarting,
        numPrice,
        priceUnit,
        finalPricePerSqFt,
        plotSizes || 'Plots Available',
        approval || 'DTCP & RERA Approved',
        reraNumber || '',
        finalCategory,
        primaryImagePath,
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
        featuredFlag,
      ]
    );

    const [createdRows] = await pool.query('SELECT * FROM properties WHERE id = ?', [propertyId]);
    const createdProperty = formatProperty(createdRows[0]);

    return res.status(201).json({
      success: true,
      message: `Land listing posted successfully with ${finalImages.length} portrait image(s)`,
      propertyId,
      property: createdProperty,
      data: createdProperty,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Update Property (Staff / Admin API)
 * Supports updating fields and uploading new portrait images, retaining or replacing existing ones.
 */
async function updateProperty(req, res, next) {
  try {
    const { id } = req.params;
    const {
      title,
      name,
      location,
      city,
      priceStarting,
      pricePerCent,
      priceUnit,
      pricePerSqFt,
      plotSizes,
      plotMin,
      plotMax,
      budgetMin,
      budgetMax,
      totalPlots,
      availablePlots,
      cornerPlots,
      offers,
      pdfUrl,
      note,
      ongoing,
      active,
      approval,
      reraNumber,
      category,
      propertyType,
      amenities,
      isFeatured,
      keepExistingImages = true,
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM properties WHERE id = ? OR title = ?', [id, id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const current = existing[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Support keepexisting, keepExistingImages, keep_existing_images (case-insensitive)
    let shouldKeepExisting = true;
    for (const key of Object.keys(req.body)) {
      const cleanKey = key.toLowerCase().replace(/[^a-z]/g, '');
      if (cleanKey === 'keepexisting' || cleanKey === 'keepexistingimages') {
        const val = req.body[key];
        if (val === false || val === 'false' || val === 0 || val === '0') {
          shouldKeepExisting = false;
        }
        break;
      }
    }

    // Handle new uploaded files from multipart/form-data
    const newUploadedImages = [];
    if (Array.isArray(req.files)) {
      for (const file of req.files) {
        newUploadedImages.push(`${baseUrl}/uploads/properties/${file.filename}`);
      }
    } else if (req.files) {
      const allFiles = Object.values(req.files).flat();
      for (const file of allFiles) {
        if (file && file.filename) {
          newUploadedImages.push(`${baseUrl}/uploads/properties/${file.filename}`);
        }
      }
    } else if (req.file) {
      newUploadedImages.push(`${baseUrl}/uploads/properties/${req.file.filename}`);
    }

    // Current images in database
    let currentImages = resolvePropertyImages(current);

    // If caller specified specific existing images to retain
    let retainedImages = shouldKeepExisting ? currentImages : [];
    if (req.body.existingImages !== undefined) {
      if (Array.isArray(req.body.existingImages)) {
        retainedImages = req.body.existingImages;
      } else if (typeof req.body.existingImages === 'string') {
        try {
          retainedImages = JSON.parse(req.body.existingImages);
        } catch (_) {
          retainedImages = req.body.existingImages.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    }

    // Combine retained + newly uploaded
    let finalImages = [...retainedImages, ...newUploadedImages];

    // If caller directly provided images URL array in JSON/body and no new files were uploaded
    if (req.body.images && newUploadedImages.length === 0) {
      if (Array.isArray(req.body.images)) {
        finalImages = req.body.images;
      } else if (typeof req.body.images === 'string') {
        try {
          finalImages = JSON.parse(req.body.images);
        } catch (_) {
          finalImages = req.body.images.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
    } else if (req.body.imagePath && finalImages.length === 0) {
      finalImages = [req.body.imagePath];
    }

    if (finalImages.length === 0) {
      finalImages = [current.image_path || 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80'];
    }

    const primaryImagePath = finalImages[0];

    // Amenities: ALWAYS parse into JS array first, then JSON.stringify
    let finalAmenitiesArr = [];
    const sourceAmenities = amenities !== undefined ? amenities : current.amenities;
    if (Array.isArray(sourceAmenities)) {
      finalAmenitiesArr = sourceAmenities;
    } else if (typeof sourceAmenities === 'string') {
      try {
        const parsed = JSON.parse(sourceAmenities);
        finalAmenitiesArr = Array.isArray(parsed) ? parsed : [parsed];
      } catch (_) {
        finalAmenitiesArr = sourceAmenities.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(finalAmenitiesArr) || finalAmenitiesArr.length === 0) {
      finalAmenitiesArr = ['40ft Road', 'Sweet Ground Water', 'Clear Parent Deeds'];
    }
    const updatedAmenitiesJson = JSON.stringify(finalAmenitiesArr);

    const updatedFeatured = isFeatured !== undefined
      ? (isFeatured === true || isFeatured === 'true' || isFeatured === '1' || isFeatured === 1 ? 1 : 0)
      : (current.is_featured ? 1 : 0);

    const finalTitle = title !== undefined ? title : (name !== undefined ? name : current.title);
    const finalLocation = location !== undefined ? location : current.location;
    const finalCity = city !== undefined ? city : current.city;
    const finalPriceStarting = priceStarting !== undefined ? priceStarting : current.price_starting;
    const finalPricePerCent = pricePerCent !== undefined ? parseFloat(pricePerCent) : current.price_per_cent;
    const finalPriceUnit = priceUnit !== undefined ? priceUnit : current.price_unit;
    const finalCategory = category !== undefined ? category : (propertyType !== undefined ? propertyType : current.category);

    const offersJson = offers !== undefined
      ? (Array.isArray(offers) ? JSON.stringify(offers) : JSON.stringify([offers]))
      : current.offers;

    await pool.query(
      `UPDATE properties SET
        title = ?,
        location = ?,
        city = ?,
        price_starting = ?,
        price_per_cent = ?,
        price_unit = ?,
        price_per_sqft = ?,
        plot_sizes = ?,
        approval = ?,
        rera_number = ?,
        category = ?,
        image_path = ?,
        images = ?,
        amenities = ?,
        offers = ?,
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
        is_featured = ?
       WHERE id = ?`,
      [
        finalTitle,
        finalLocation,
        finalCity,
        finalPriceStarting,
        finalPricePerCent,
        finalPriceUnit,
        pricePerSqFt ?? current.price_per_sqft,
        plotSizes ?? current.plot_sizes,
        approval ?? current.approval,
        reraNumber ?? current.rera_number,
        finalCategory,
        primaryImagePath,
        JSON.stringify(finalImages),
        updatedAmenitiesJson,
        offersJson,
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
        updatedFeatured,
        current.id,
      ]
    );

    const [updatedRows] = await pool.query('SELECT * FROM properties WHERE id = ?', [current.id]);
    const updated = formatProperty(updatedRows[0]);

    return res.status(200).json({
      success: true,
      message: `Land listing updated successfully with ${finalImages.length} portrait image(s)`,
      property: updated,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Bulk Update Property Images
 */
async function bulkUpdateImages(req, res, next) {
  try {
    let items = [];

    if (Array.isArray(req.body)) {
      items = req.body;
    } else if (req.body && typeof req.body === 'object') {
      if (Array.isArray(req.body.properties)) {
        items = req.body.properties;
      } else if (Array.isArray(req.body.data)) {
        items = req.body.data;
      } else {
        items = Object.keys(req.body).map(id => ({
          id,
          images: req.body[id],
        }));
      }
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an array of properties with id and images.',
      });
    }

    let updatedCount = 0;
    const errors = [];

    for (const item of items) {
      if (!item.id) continue;

      let imagesList = [];
      if (Array.isArray(item.images)) {
        imagesList = item.images;
      } else if (typeof item.images === 'string') {
        try {
          const parsed = JSON.parse(item.images);
          if (Array.isArray(parsed)) imagesList = parsed;
          else imagesList = [item.images];
        } catch (_) {
          imagesList = [item.images];
        }
      } else if (item.imagePath) {
        imagesList = [item.imagePath];
      }

      if (imagesList.length === 0) continue;

      const primaryCover = imagesList[0];
      const imagesJson = JSON.stringify(imagesList);

      try {
        const [result] = await pool.query(
          'UPDATE properties SET image_path = ?, images = ? WHERE id = ?',
          [primaryCover, imagesJson, item.id]
        );
        if (result.affectedRows > 0) {
          updatedCount++;
        }
      } catch (err) {
        errors.push({ id: item.id, error: err.message });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Bulk updated images for ${updatedCount} land(s)`,
      updatedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. Delete Property
 */
async function deleteProperty(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await pool.query('UPDATE properties SET active = 0 WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Property deactivated successfully',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. Get Available Cities
 */
async function getCities(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT DISTINCT city FROM properties WHERE (active = 1 OR active IS NULL) ORDER BY city ASC');
    const cities = rows.map(r => r.city).filter(Boolean);
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
  bulkUpdateImages,
  deleteProperty,
  getCities,
};
