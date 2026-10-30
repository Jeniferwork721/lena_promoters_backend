const path = require('path');

/**
 * 1. Upload Payment Receipt Screenshot (Used by Staff during coupon verification)
 */
async function uploadReceipt(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select an image or PDF receipt.',
      });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const fileUrl = `${baseUrl}/uploads/receipts/${req.file.filename}`;

    return res.status(200).json({
      success: true,
      message: 'Receipt uploaded successfully',
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        url: fileUrl,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Upload Property Image / Brochure
 */
async function uploadPropertyMedia(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No media file uploaded.',
      });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const fileUrl = `${baseUrl}/uploads/properties/${req.file.filename}`;

    return res.status(200).json({
      success: true,
      message: 'Property media uploaded successfully',
      file: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        url: fileUrl,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadReceipt,
  uploadPropertyMedia,
};
