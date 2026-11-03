const { pool } = require('../config/db');

/**
 * Helper to safely extract image list for a property
 */
function resolvePropertyImages(plot, baseUrl) {
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

    // Map fields to match Flutter PlotModel with multi-image support
    const properties = rows.map(plot => {
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

      return {
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
        imagePath: primaryImage, // Primary portrait cover image
        images: imagesList,      // Full list of portrait images (1, 2, 3+)
        amenities: amenitiesList,
        isFeatured: Boolean(plot.is_featured),
      };
    });

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
      imagePath: primaryImage,
      images: imagesList,
      amenities: amenitiesList,
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
 * 3. Create Property (Staff / Admin API)
 * Supports multiple portrait image uploads (1, 2, 3+ images) via multipart/form-data ('images')
 * or via JSON array ('images' / 'imagePath').
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
      amenities,
      isFeatured = false,
    } = req.body;

    if (!title || !location || !city || !priceStarting) {
      return res.status(400).json({
        success: false,
        message: 'Please provide required property title, location, city, and priceStarting.',
      });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const uploadedImages = [];

    // Check for uploaded files from multipart/form-data
    if (req.files) {
      const filesList = [
        ...(req.files['images'] || []),
        ...(req.files['image'] || []),
      ];
      for (const file of filesList) {
        uploadedImages.push(`${baseUrl}/uploads/properties/${file.filename}`);
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

    // Parse amenities
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

    const amenitiesJson = JSON.stringify(parsedAmenities);
    const imagesJson = JSON.stringify(finalImages);
    const featuredFlag = isFeatured === true || isFeatured === 'true' || isFeatured === '1' || isFeatured === 1 ? 1 : 0;

    await pool.query(
      `INSERT INTO properties (id, title, location, city, price_starting, price_per_sqft, plot_sizes, approval, rera_number, category, image_path, images, amenities, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        propertyId,
        title,
        location,
        city,
        priceStarting,
        pricePerSqFt || priceStarting,
        plotSizes || 'Plots Available',
        approval || 'DTCP & RERA Approved',
        reraNumber || '',
        category,
        primaryImagePath,
        imagesJson,
        amenitiesJson,
        featuredFlag,
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
      imagePath: primaryImagePath,
      images: finalImages,
      amenities: parsedAmenities,
      isFeatured: Boolean(featuredFlag),
    };

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
      location,
      city,
      priceStarting,
      pricePerSqFt,
      plotSizes,
      approval,
      reraNumber,
      category,
      amenities,
      isFeatured,
      keepExistingImages = true,
    } = req.body;

    const [existing] = await pool.query('SELECT * FROM properties WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    const current = existing[0];
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Handle new uploaded files from multipart/form-data
    const newUploadedImages = [];
    if (req.files) {
      const filesList = [
        ...(req.files['images'] || []),
        ...(req.files['image'] || []),
      ];
      for (const file of filesList) {
        newUploadedImages.push(`${baseUrl}/uploads/properties/${file.filename}`);
      }
    } else if (req.file) {
      newUploadedImages.push(`${baseUrl}/uploads/properties/${req.file.filename}`);
    }

    // Current images in database
    let currentImages = resolvePropertyImages(current);

    // If caller specified specific existing images to retain
    let retainedImages = currentImages;
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
    } else if (keepExistingImages === false || keepExistingImages === 'false') {
      retainedImages = [];
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

    // Amenities
    let updatedAmenities = current.amenities;
    if (amenities !== undefined) {
      let parsed = [];
      if (Array.isArray(amenities)) {
        parsed = amenities;
      } else if (typeof amenities === 'string') {
        try {
          parsed = JSON.parse(amenities);
        } catch (_) {
          parsed = amenities.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
      updatedAmenities = JSON.stringify(parsed);
    }

    const updatedFeatured = isFeatured !== undefined
      ? (isFeatured === true || isFeatured === 'true' || isFeatured === '1' || isFeatured === 1 ? 1 : 0)
      : current.is_featured;

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
        images = ?,
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
        primaryImagePath,
        JSON.stringify(finalImages),
        updatedAmenities,
        updatedFeatured,
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
      imagePath: primaryImagePath,
      images: finalImages,
      amenities: typeof updatedAmenities === 'string' ? JSON.parse(updatedAmenities || '[]') : updatedAmenities,
      isFeatured: Boolean(updatedFeatured),
    };

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
