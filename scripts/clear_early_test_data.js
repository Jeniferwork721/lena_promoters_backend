/**
 * Database Reset Utility for Early Test Data
 * 
 * Clears:
 * 1. All Lucky Draw coupons (lucky_draw_coupons) -> resets sequence to LENA-LD-0001
 * 2. All early customer profiles (customers)
 * 3. All CRM customer leads (customer_leads)
 * 4. All CRM tasks (tasks)
 * 5. All CRM work reports (work_reports)
 * 6. All site visits (site_visits)
 * 7. All CRM teams (teams)
 * 8. All test staff & employees (staff_users WHERE role NOT IN ('ADMIN', 'SUPER_ADMIN') AND employee_id != 'LP-COMPANY')
 * 9. Temporary auth tokens (refresh_tokens, otp_codes)
 * 
 * Keeps intact:
 * - Admin account (LP-COMPANY / info@lenapromoters.com / ADMIN)
 * - Properties list (properties)
 * - Schemes configuration (lucky_draw_schemes)
 * - CRM configuration options (config_options)
 * - Branches (branches)
 */

require('dotenv').config();
const { pool } = require('../src/config/db');

async function clearEarlyTestData() {
  console.log('🚨 [RESET] Starting Database Early Data Cleanup...');

  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. Clear Lucky Draw Coupons
    const [couponRes] = await connection.query('DELETE FROM `lucky_draw_coupons`');
    console.log(`✅ Cleared lucky_draw_coupons: ${couponRes.affectedRows} records removed.`);

    // 2. Clear Customers
    const [custRes] = await connection.query('DELETE FROM `customers`');
    console.log(`✅ Cleared customers: ${custRes.affectedRows} records removed.`);

    // 3. Clear CRM Leads
    const [leadRes] = await connection.query('DELETE FROM `customer_leads`');
    console.log(`✅ Cleared customer_leads: ${leadRes.affectedRows} records removed.`);

    // 4. Clear Tasks
    const [taskRes] = await connection.query('DELETE FROM `tasks`');
    console.log(`✅ Cleared tasks: ${taskRes.affectedRows} records removed.`);

    // 5. Clear Work Reports
    const [reportRes] = await connection.query('DELETE FROM `work_reports`');
    console.log(`✅ Cleared work_reports: ${reportRes.affectedRows} records removed.`);

    // 6. Clear Site Visits
    const [visitRes] = await connection.query('DELETE FROM `site_visits`');
    console.log(`✅ Cleared site_visits: ${visitRes.affectedRows} records removed.`);

    // 7. Clear Teams
    const [teamRes] = await connection.query('DELETE FROM `teams`');
    console.log(`✅ Cleared teams: ${teamRes.affectedRows} records removed.`);

    // 8. Clear all staff except Admin / Super Admin / LP-COMPANY
    const [staffRes] = await connection.query(
      "DELETE FROM `staff_users` WHERE role NOT IN ('ADMIN', 'SUPER_ADMIN') AND employee_id != 'LP-COMPANY'"
    );
    console.log(`✅ Cleared test staff_users: ${staffRes.affectedRows} employees/managers removed.`);

    // Reset team_id and leader pointers for any remaining accounts
    await connection.query('UPDATE `staff_users` SET `team_id` = NULL');

    // 9. Clear expired refresh tokens and OTPs
    await connection.query('DELETE FROM `refresh_tokens`');
    await connection.query('DELETE FROM `otp_codes`');
    console.log('✅ Cleared refresh_tokens and otp_codes.');

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('\n🎉 [SUCCESS] All early test data removed successfully!');
    console.log('📌 Coupon numbering sequence will now start from LENA-LD-0001.');
    console.log('📌 Main Admin profile (LP-COMPANY) preserved for MD login.');
  } catch (err) {
    console.error('❌ [ERROR] Failed to clear early data:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

clearEarlyTestData();
