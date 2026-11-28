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
const crmCallLog = require('../controllers/crmCallLog.controller');
const crmGreetings = require('../controllers/crmGreetings.controller');
const crmLeave = require('../controllers/crmLeave.controller');
const crmGatePass = require('../controllers/crmGatePass.controller');
const crmVisitor = require('../controllers/crmVisitor.controller');
const crmFollowup = require('../controllers/crmFollowup.controller');
const authController = require('../controllers/auth.controller');

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
router.put('/employees/:id', requireMD, crmEmployee.updateEmployee);
router.patch('/employees/:id/assignment', requireMD, crmEmployee.updateEmployeeAssignment);
router.delete('/employees/:id', requireMD, crmEmployee.deleteEmployee);
router.delete('/staff/:staffId/account', requireMD, authController.deleteStaffAccount);

// ==========================================================
// 5. CUSTOMER LEADS (Section 5: #20 to #25)
// ==========================================================
router.get('/customer-leads', crmLead.getCustomerLeads);
router.post('/customer-leads', requireLeadOrMD, crmLead.createCustomerLead);
router.post('/customer-leads/bulk', requireMD, crmLead.bulkImportCustomerLeads);
router.patch('/customer-leads/:id/team-lead', requireMD, crmLead.updateCustomerLeadTeamLead);
router.patch('/customer-leads/:id/employee', requireLeadOrMD, crmLead.updateCustomerLeadEmployee);
router.post('/customer-leads/split', requireLeadOrMD, crmLead.splitCustomerLeads);
router.delete('/customer-leads/:id', requireLeadOrMD, crmLead.deleteCustomerLead);

// ==========================================================
// 6. TASKS (Section 6: #26 to #28)
// ==========================================================
router.get('/tasks', crmTask.getTasks);
router.post('/tasks', requireLeadOrMD, crmTask.createTask);
router.patch('/tasks/:id/status', crmTask.updateTaskStatus);

// ==========================================================
// 7. WORK REPORTS (Section 7: #29 to #33 + Export + By Contact Lookup)
// ==========================================================
router.get('/reports/by-contact', crmReport.getReportByContact);
router.get('/reports/daily-register', crmReport.getDailyRegister);
router.post('/reports', crmReport.createReport);
router.get('/reports', crmReport.getReports);
router.get('/reports/follow-ups', crmReport.getFollowUps);
router.get('/reports/next-entry-no', crmReport.getNextEntryNo);
router.get('/reports/export', requireMD, crmReport.exportReports);
router.get('/reports/:id', crmReport.getReportById);
router.patch('/reports/:id', crmReport.updateReport);

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
router.get('/config/options/:list', crmConfig.getConfigOptionList);
router.put('/config/options/:list', requireMD, crmConfig.updateConfigOptionList);
router.post('/config/options/add-item', crmConfig.addConfigOptionItem);

// ==========================================================
// 10. ADMIN RESET EARLY DATA
// ==========================================================
router.post('/admin/reset-early-data', requireMD, crmConfig.resetEarlyTestData);

// ==========================================================
// 11. STAFF PHONE CALL LOGS (Mobile Sync -> CRM Call Entry)
// ==========================================================
router.get('/call-logs/tracking-status', crmCallLog.getTrackingStatus);
router.post('/call-logs/enable-tracking', crmCallLog.enableTracking);
router.post('/call-logs/sync', crmCallLog.syncCallLogs);
router.get('/call-logs', crmCallLog.getCallLogs);
router.patch('/call-logs/:id/mark-logged', crmCallLog.markCallLogLogged);
router.delete('/call-logs/clear-old', requireMD, crmCallLog.clearOldCallLogs);

// ==========================================================
// 12. AUTOMATED BIRTHDAY & ANNIVERSARY GREETINGS
// ==========================================================
router.get('/greetings/today', crmGreetings.getTodayCelebrations);
router.post('/greetings/trigger', requireMD, crmGreetings.triggerDailyGreetings);
router.post('/greetings/send-single', requireMD, crmGreetings.sendSingleGreeting);

// ==========================================================
// 13. LEAVE APPLICATIONS & PERMISSIONS (3-Tier: Staff -> TL -> GM -> HR)
// ==========================================================
router.get('/leaves/quota', crmLeave.getLeaveQuota);
router.get('/leaves/monthly-summary', crmLeave.getMonthlyLeaveSummary);
router.get('/leaves/flow-hierarchy', crmLeave.getFlowHierarchy);
router.patch('/employees/:id/flow-hierarchy', crmLeave.updateFlowHierarchy);
router.post('/leaves', crmLeave.applyLeave);
router.get('/leaves/my', crmLeave.getMyLeaves);
router.get('/leaves', crmLeave.getLeaves);
router.get('/leaves/:id', crmLeave.getLeaveById);
router.patch('/leaves/:id/approve', crmLeave.approveLeave);
router.patch('/leaves/:id/reject', crmLeave.rejectLeave);
router.patch('/leaves/:id/cancel', crmLeave.cancelLeave);

// ==========================================================
// 14. GATE PASSES (Official/Field Work/Emergency/Personal exit)
// ==========================================================
router.post('/gate-passes', crmGatePass.applyGatePass);
router.get('/gate-passes/my', crmGatePass.getMyGatePasses);
router.get('/gate-passes', crmGatePass.getGatePasses);
router.get('/gate-passes/:id', crmGatePass.getGatePassById);
router.patch('/gate-passes/:id/approve', crmGatePass.approveGatePass);
router.patch('/gate-passes/:id/reject', crmGatePass.rejectGatePass);
router.patch('/gate-passes/:id/return', crmGatePass.recordReturn);

// ==========================================================
// 15. VISITOR MANAGEMENT & TICKETS (Front Office Desk & Management)
// ==========================================================
router.post('/visitors', crmVisitor.registerVisitor);
router.get('/visitors', crmVisitor.getVisitors);
router.get('/visitors/reports/summary', crmVisitor.getVisitorSummaryReport);
router.get('/visitors/:id', crmVisitor.getVisitorById);
router.patch('/visitors/:id/conclusion', crmVisitor.updateVisitorConclusion);
router.patch('/visitors/:id/refreshment', crmVisitor.updateVisitorRefreshment);
router.patch('/visitors/:id/close', crmVisitor.closeVisitorTicket);

// ==========================================================
// 16. CRM FOLLOW-UPS (v2.2)
// ==========================================================
router.post('/followups', crmFollowup.createFollowup);
router.get('/followups', crmFollowup.getFollowups);
router.patch('/followups/:id/complete', crmFollowup.completeFollowup);
router.patch('/followups/:id/reschedule', crmFollowup.rescheduleFollowup);
router.patch('/followups/:id/cancel', crmFollowup.cancelFollowup);

module.exports = router;
