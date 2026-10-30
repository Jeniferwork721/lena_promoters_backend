const express = require('express');
const router = express.Router();
const siteVisitController = require('../controllers/siteVisit.controller');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Public customer booking & lookup
router.post('/', siteVisitController.bookSiteVisit);
router.get('/by-phone/:phone', siteVisitController.getVisitsByPhone);

// Staff management
router.get('/', verifyStaffToken, siteVisitController.getAllSiteVisits);
router.patch('/:id/status', verifyStaffToken, siteVisitController.updateSiteVisit);

module.exports = router;
