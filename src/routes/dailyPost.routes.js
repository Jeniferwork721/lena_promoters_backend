const express = require('express');
const router = express.Router();
const dailyPostController = require('../controllers/dailyPost.controller');
const upload = require('../middlewares/upload.middleware');
const { verifyStaffToken } = require('../middlewares/auth.middleware');

// Public endpoint for customer app carousel (past week daily posts)
router.get('/recent', dailyPostController.getRecentDailyPosts);

// Admin/CRM endpoints
router.get('/', verifyStaffToken, dailyPostController.getAllDailyPosts);
router.post('/', verifyStaffToken, upload.any(), dailyPostController.uploadDailyPost);
router.delete('/:id', verifyStaffToken, dailyPostController.deleteDailyPost);

module.exports = router;
