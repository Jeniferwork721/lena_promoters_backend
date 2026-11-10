const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const branchController = require('../controllers/branch.controller');
const { verifyStaffToken, requireMD } = require('../middlewares/auth.middleware');

// Public routes for staff login & registration
router.post('/staff/login', authController.loginWithPassword);
router.post('/login', authController.loginWithPassword);
router.post('/staff/register', authController.registerEmployee);
router.post('/register', authController.registerEmployee);
router.post('/staff/register-password', authController.registerEmployee);
router.post('/staff/create-password-with-otp', authController.registerEmployee);
router.post('/staff/send-otp', authController.sendOtp);
router.post('/send-otp', authController.sendOtp);
router.post('/staff/verify-otp-login', authController.loginWithOtp);

// Public routes for staff password recovery (Forgot Password)
router.post('/staff/forgot-password', authController.forgotPassword);
router.post('/forgot-password', authController.forgotPassword);
router.post('/staff/verify-reset-otp', authController.verifyResetOtp);
router.post('/verify-reset-otp', authController.verifyResetOtp);
router.post('/staff/reset-password', authController.resetPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/staff-directory', authController.getStaffDirectory);
router.get('/branches', branchController.getBranches);

// Public routes for customer login & registration (No password setup required)
router.post('/customer/send-otp', authController.sendCustomerOtp);
router.post('/customer/login-otp', authController.loginCustomerWithOtp);
router.post('/customer/register', authController.registerCustomer);
router.get('/customer/profile', authController.getCustomerProfile);
router.put('/customer/profile', authController.updateCustomerProfile);
router.post('/customer/profile', authController.updateCustomerProfile);

// Session refresh & logout routes (Public / uses refresh token)
router.post('/refresh', authController.refreshAccessToken);
router.post('/logout', authController.logout);

// Authenticated staff routes (CRM Section 2)
router.get('/me', verifyStaffToken, authController.getMe);
router.get('/staff/profile', verifyStaffToken, authController.getMe);
router.post('/change-password', (req, res, next) => {
  if (req.headers.authorization) {
    return verifyStaffToken(req, res, () => authController.changePassword(req, res, next));
  }
  return authController.changePassword(req, res, next);
});
router.post('/staff/change-password', (req, res, next) => {
  if (req.headers.authorization) {
    return verifyStaffToken(req, res, () => authController.changePassword(req, res, next));
  }
  return authController.changePassword(req, res, next);
});
router.delete('/staff/:staffId/account', verifyStaffToken, requireMD, authController.deleteStaffAccount);

router.put('/staff/profile', authController.updateStaffProfile);
router.post('/staff/profile', authController.updateStaffProfile);

module.exports = router;
