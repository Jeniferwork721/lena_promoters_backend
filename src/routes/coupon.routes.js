const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Public scheme & customer application
router.get('/schemes', couponController.getActiveScheme);
router.post('/customer-apply', couponController.customerApply);
router.get('/customer/my-coupons', couponController.getCustomerCoupons);
router.get('/details/:id', couponController.getCouponById);

// Staff only routes
router.get('/staff/entries', verifyStaffToken, couponController.getStaffEntries);
router.put('/staff/:id/edit-and-verify', verifyStaffToken, couponController.staffEditAndVerify);
router.post('/staff/direct-entry', verifyStaffToken, couponController.staffDirectEntry);

module.exports = router;
