const express = require('express');
const router = express.Router();
const layoutController = require('../controllers/layout.controller');
const upload = require('../middlewares/upload.middleware');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Public or Authenticated staff layout listing
router.get('/', verifyStaffToken, layoutController.getLayouts);
router.get('/:id', verifyStaffToken, layoutController.getLayoutById);

// Layout management (MD, Sales Head, Manager, Admin)
router.post('/', verifyStaffToken, layoutController.createLayout);
router.put('/:id', verifyStaffToken, layoutController.updateLayout);
router.delete('/:id', verifyStaffToken, layoutController.deleteLayout);

// Upload layout PDF
router.post('/:id/pdf', verifyStaffToken, upload.any(), layoutController.uploadLayoutPdf);

module.exports = router;
