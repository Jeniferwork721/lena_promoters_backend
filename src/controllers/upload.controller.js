const path = require('path');

/**
 * 1. Upload Payment Receipt Screenshot (Used by Staff during coupon verification)
 */
async function uploadReceipt(req, res, next) {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select an image or PDF receipt.',
      });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const fileUrl = `${baseUrl}/uploads/receipts/${file.filename}`;

    return res.status(200).json({
      success: true,
      message: 'Receipt uploaded successfully',
      file: {
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        url: fileUrl,
      },
      url: fileUrl,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Upload Property Image / Site Photos / Layout Plan (PDF or Image)
 */
async function uploadPropertyMedia(req, res, next) {
  try {
    const allFiles = req.files || (req.file ? [req.file] : []);
    if (allFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No media file uploaded.',
      });
    }

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const mapped = allFiles.map((f) => {
      const fileUrl = `${baseUrl}/uploads/properties/${f.filename}`;
      return {
        filename: f.filename,
        originalName: f.originalname,
        size: f.size,
        mimeType: f.mimetype,
        url: fileUrl,
      };
    });

    return res.status(200).json({
      success: true,
      message: mapped.length > 1 ? `${mapped.length} files uploaded successfully` : 'File uploaded successfully',
      file: mapped[0],
      files: mapped,
      url: mapped[0].url,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadReceipt,
  uploadPropertyMedia,
};
