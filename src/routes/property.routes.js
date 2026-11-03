const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/property.controller');
const upload = require('../middlewares/upload.middleware');
const { verifyStaffToken, requireAdminRole } = require('../middlewares/auth.middleware');

// Public plot browsing
router.get('/', propertyController.getAllProperties);
router.get('/cities', propertyController.getCities);

// Bulk update land images (MUST be defined before /:id)
router.put('/bulk-images', verifyStaffToken, propertyController.bulkUpdateImages);
router.post('/bulk-images', verifyStaffToken, propertyController.bulkUpdateImages);

router.get('/:id', propertyController.getPropertyById);

// Staff / Admin plot management (POST, PUT, DELETE)
// Supports multipart/form-data with multiple portrait images (any field name: 'images', 'image', 'Images') or JSON body
router.post(
  '/',
  verifyStaffToken,
  upload.any(),
  propertyController.createProperty
);

router.put(
  '/:id',
  verifyStaffToken,
  upload.any(),
  propertyController.updateProperty
);

router.delete('/:id', verifyStaffToken, propertyController.deleteProperty);

module.exports = router;
