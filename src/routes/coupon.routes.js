const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Public scheme & customer application
router.get('/schemes', couponController.getActiveScheme);
router.post('/customer-apply', couponController.customerApply);
router.get('/customer/my-coupons', couponController.getCustomerCoupons);
router.get('/details/:id', couponController.getCouponById);

// Staff coupon verification & rejection (with slot recycling)
router.get('/staff/entries', verifyStaffToken, couponController.getStaffEntries);
router.put('/staff/:id/edit-and-verify', verifyStaffToken, couponController.staffEditAndVerify);
router.put('/staff/:id/reject', verifyStaffToken, couponController.staffRejectCoupon);
router.post('/staff/direct-entry', verifyStaffToken, couponController.staffDirectEntry);

// Recurring Events / Season Management (Admin / Coupon Head / Manager)
router.get('/reports/summary', verifyStaffToken, couponController.getCouponReports);
router.get('/events/active', couponController.getActiveEvent);
router.get('/events/list', verifyStaffToken, couponController.listEvents);
router.post('/events/new', verifyStaffToken, couponController.startNewEvent);
router.post('/events/:id/end', verifyStaffToken, couponController.endEvent);
router.delete('/events/:id/purge-receipts', verifyStaffToken, couponController.purgeEventReceipts);

module.exports = router;
