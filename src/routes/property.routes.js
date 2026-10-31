const express = require('express');
const router = express.Router();
const propertyController = require('../controllers/property.controller');
const { verifyStaffToken, requireAdminRole } = require('../middlewares/auth.middleware');

// Public plot browsing
router.get('/', propertyController.getAllProperties);
router.get('/cities', propertyController.getCities);
router.get('/:id', propertyController.getPropertyById);

// Staff / Admin plot management (POST, PUT, DELETE)
router.post('/', verifyStaffToken, propertyController.createProperty);
router.put('/:id', verifyStaffToken, propertyController.updateProperty);
router.delete('/:id', verifyStaffToken, propertyController.deleteProperty);

module.exports = router;
