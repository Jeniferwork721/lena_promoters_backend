const express = require('express');

try {
  console.log('Testing module imports...');
  const crmOptions = require('../src/config/crmOptions');
  console.log('✅ crmOptions loaded successfully. Call target:', crmOptions.CALL_TARGET_PER_DAY);

  const emailService = require('../src/services/email.service');
  console.log('✅ emailService loaded. sendStaffWelcomeEmail type:', typeof emailService.sendStaffWelcomeEmail);

  const authMiddleware = require('../src/middlewares/auth.middleware');
  console.log('✅ authMiddleware loaded. getAppRole("ADMIN"):', authMiddleware.getAppRole('ADMIN'));
  console.log('   getAppRole("MANAGER"):', authMiddleware.getAppRole('MANAGER'));
  console.log('   getAppRole("STAFF"):', authMiddleware.getAppRole('STAFF'));

  const crmTeam = require('../src/controllers/crmTeam.controller');
  console.log('✅ crmTeam loaded. Endpoints:', Object.keys(crmTeam));

  const crmEmployee = require('../src/controllers/crmEmployee.controller');
  console.log('✅ crmEmployee loaded. Endpoints:', Object.keys(crmEmployee));

  const crmLead = require('../src/controllers/crmLead.controller');
  console.log('✅ crmLead loaded. Endpoints:', Object.keys(crmLead));

  const crmTask = require('../src/controllers/crmTask.controller');
  console.log('✅ crmTask loaded. Endpoints:', Object.keys(crmTask));

  const crmReport = require('../src/controllers/crmReport.controller');
  console.log('✅ crmReport loaded. Endpoints:', Object.keys(crmReport));

  const crmDashboard = require('../src/controllers/crmDashboard.controller');
  console.log('✅ crmDashboard loaded. Endpoints:', Object.keys(crmDashboard));

  const crmConfig = require('../src/controllers/crmConfig.controller');
  console.log('✅ crmConfig loaded. Endpoints:', Object.keys(crmConfig));

  const crmRoutes = require('../src/routes/crm.routes');
  console.log('✅ crmRoutes loaded successfully.');

  const appRoutes = require('../src/routes/index');
  console.log('✅ appRoutes (index) loaded successfully.');

  console.log('\n🎉 ALL CRM MODULES AND CONTROLLERS VERIFIED SUCCESSFULLY!');
  process.exit(0);
} catch (err) {
  console.error('❌ Error during module verification:', err);
  process.exit(1);
}
