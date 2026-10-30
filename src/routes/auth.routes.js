const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const branchController = require('../controllers/branch.controller');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Public routes for staff login & OTP
router.post('/staff/login', authController.loginWithPassword);
router.post('/staff/send-otp', authController.sendOtp);
router.post('/staff/verify-otp-login', authController.loginWithOtp);
router.post('/staff/register-password', authController.registerPasswordWithOtp);
router.post('/staff/create-password-with-otp', authController.registerPasswordWithOtp);
router.get('/staff-directory', authController.getStaffDirectory);
router.get('/branches', branchController.getBranches);

// Public routes for customer login & registration (No password setup required)
router.post('/customer/send-otp', authController.sendCustomerOtp);
router.post('/customer/login-otp', authController.loginCustomerWithOtp);
router.post('/customer/register', authController.registerCustomer);
router.put('/customer/profile', authController.updateCustomerProfile);
router.post('/customer/profile', authController.updateCustomerProfile);

// Session refresh & logout routes (Public / uses refresh token)
router.post('/refresh', authController.refreshAccessToken);
router.post('/logout', authController.logout);

// Authenticated staff route
router.get('/staff/profile', verifyStaffToken, authController.getProfile);
router.put('/staff/profile', authController.updateStaffProfile);
router.post('/staff/profile', authController.updateStaffProfile);

module.exports = router;
