const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branch.controller');

// Public route to fetch all official Lena Promoters branches
router.get('/', branchController.getBranches);
router.get('/:id', branchController.getBranchById);

module.exports = router;
