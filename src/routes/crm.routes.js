const express = require('express');
const router = express.Router();

const { verifyStaffToken, requireMD, requireLeadOrMD } = require('../middlewares/auth.middleware');

const crmTeam = require('../controllers/crmTeam.controller');
const crmEmployee = require('../controllers/crmEmployee.controller');
const crmLead = require('../controllers/crmLead.controller');
const crmTask = require('../controllers/crmTask.controller');
const crmReport = require('../controllers/crmReport.controller');
const crmDashboard = require('../controllers/crmDashboard.controller');
const crmConfig = require('../controllers/crmConfig.controller');

// All CRM endpoints require staff token authentication
router.use(verifyStaffToken);

// ==========================================================
// 3. TEAM LEADS AND TEAMS (Section 3: #12 to #15)
// ==========================================================
router.get('/team-leads', requireMD, crmTeam.getTeamLeads);
router.post('/team-leads', requireMD, crmTeam.createTeamLead);
router.get('/team-leads/:id', crmTeam.getTeamLeadById);
router.get('/teams', requireMD, crmTeam.getTeams);

// ==========================================================
// 4. EMPLOYEES (Section 4: #16 to #19)
// ==========================================================
router.get('/employees', crmEmployee.getEmployees);
router.post('/employees', requireMD, crmEmployee.createEmployee);
router.get('/employees/:id', crmEmployee.getEmployeeById);
router.patch('/employees/:id/assignment', requireMD, crmEmployee.updateEmployeeAssignment);

// ==========================================================
// 5. CUSTOMER LEADS (Section 5: #20 to #25)
// ==========================================================
router.get('/customer-leads', crmLead.getCustomerLeads);
router.post('/customer-leads', requireLeadOrMD, crmLead.createCustomerLead);
router.post('/customer-leads/bulk', requireMD, crmLead.bulkImportCustomerLeads);
router.patch('/customer-leads/:id/team-lead', requireMD, crmLead.updateCustomerLeadTeamLead);
router.patch('/customer-leads/:id/employee', requireLeadOrMD, crmLead.updateCustomerLeadEmployee);
router.post('/customer-leads/split', requireLeadOrMD, crmLead.splitCustomerLeads);

// ==========================================================
// 6. TASKS (Section 6: #26 to #28)
// ==========================================================
router.get('/tasks', crmTask.getTasks);
router.post('/tasks', requireLeadOrMD, crmTask.createTask);
router.patch('/tasks/:id/status', crmTask.updateTaskStatus);

// ==========================================================
// 7. WORK REPORTS (Section 7: #29 to #33 + Export)
// ==========================================================
router.post('/reports', crmReport.createReport);
router.get('/reports', crmReport.getReports);
router.get('/reports/follow-ups', crmReport.getFollowUps);
router.get('/reports/next-entry-no', crmReport.getNextEntryNo);
router.get('/reports/export', requireMD, crmReport.exportReports);
router.get('/reports/:id', crmReport.getReportById);

// ==========================================================
// 8. DASHBOARD & PERFORMANCE (Section 8: #34 to #38)
// ==========================================================
router.get('/dashboard/summary', crmDashboard.getDashboardSummary);
router.get('/dashboard/trend', crmDashboard.getDashboardTrend);
router.get('/dashboard/tasks', crmDashboard.getDashboardTasks);
router.get('/performance/employees', requireLeadOrMD, crmDashboard.getEmployeePerformance);
router.get('/performance/teams', requireMD, crmDashboard.getTeamPerformance);

// ==========================================================
// 9. REFERENCE DATA & CONFIG (Section 9: #39 to #40)
// ==========================================================
router.get('/config/options', crmConfig.getConfigOptions);
router.put('/config/options/:list', requireMD, crmConfig.updateConfigOptionList);

// ==========================================================
// 10. ADMIN RESET EARLY DATA
// ==========================================================
router.post('/admin/reset-early-data', requireMD, crmConfig.resetEarlyTestData);

module.exports = router;
