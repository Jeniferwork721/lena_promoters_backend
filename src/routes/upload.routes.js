const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const upload = require('../middlewares/upload.middleware');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Upload receipt (Accessible to both customers and staff for payment proof)
router.post('/receipt', upload.single('receipt'), uploadController.uploadReceipt);

// Upload property image, site photo, or layout plan (PDF/image) (requires staff authentication)
router.post('/property-media', verifyStaffToken, upload.any(), uploadController.uploadPropertyMedia);

module.exports = router;
