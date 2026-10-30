const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const propertyRoutes = require('./property.routes');
const couponRoutes = require('./coupon.routes');
const siteVisitRoutes = require('./siteVisit.routes');
const uploadRoutes = require('./upload.routes');
const branchRoutes = require('./branch.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/properties', propertyRoutes);
router.use('/coupons', couponRoutes);
router.use('/site-visits', siteVisitRoutes);
router.use('/uploads', uploadRoutes);
router.use('/branches', branchRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Lena Promoters API is running smoothly',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

module.exports = router;
