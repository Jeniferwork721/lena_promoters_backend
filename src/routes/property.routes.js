const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/property.controller');
const upload = require('../middlewares/upload.middleware');
const { verifyStaffToken, requireAdminRole } = require('../middlewares/auth.middleware');

// Public plot browsing
router.get('/', propertyController.getAllProperties);
router.get('/cities', propertyController.getCities);
router.get('/:id', propertyController.getPropertyById);

// Staff / Admin plot management (POST, PUT, DELETE)
// Supports multipart/form-data with multiple portrait images (field: 'images' or 'image') or JSON body
router.post(
  '/',
  verifyStaffToken,
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'image', maxCount: 1 },
  ]),
  propertyController.createProperty
);

router.put(
  '/:id',
  verifyStaffToken,
  upload.fields([
    { name: 'images', maxCount: 10 },
    { name: 'image', maxCount: 1 },
  ]),
  propertyController.updateProperty
);

router.delete('/:id', verifyStaffToken, propertyController.deleteProperty);

module.exports = router;
