const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkDatabase() {
  const host = process.env.DB_HOST || 'localhost';
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASS || '';
  const database = process.env.DB_NAME || 'lena_promoters_db';
  const port = parseInt(process.env.DB_PORT || '3306', 10);

  console.log(`Connecting to MySQL database: ${database} at ${host}:${port}...\n`);

  let conn;
  try {
    conn = await mysql.createConnection({ host, user, password, database, port });
  } catch (err) {
    console.error('❌ Could not connect to MySQL:', err.message);
    process.exit(1);
  }

  const [tables] = await conn.query('SHOW TABLES');
  const tableKey = Object.keys(tables[0])[0];

  console.log('====================================================');
  console.log('       📊 LENA PROMOTERS DATABASE TABLE COUNTS       ');
  console.log('====================================================');

  for (const t of tables) {
    const tableName = t[tableKey];
    const [[{ count }]] = await conn.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
    console.log(`  📁 ${tableName.padEnd(25)} : ${count} entries`);
  }

  console.log('\n----------------------------------------------------');
  console.log('  👤 STAFF USERS (Latest 5)');
  console.log('----------------------------------------------------');
  const [staff] = await conn.query(
    'SELECT id, employee_id, full_name, email, phone_number, branch_location, role, created_at FROM staff_users ORDER BY id DESC LIMIT 5'
  );
  if (staff.length > 0) {
    console.table(staff);
  } else {
    console.log('  (No staff users registered yet)');
  }

  console.log('\n----------------------------------------------------');
  console.log('  👥 CUSTOMERS / INVESTORS (Latest 5)');
  console.log('----------------------------------------------------');
  const [customers] = await conn.query(
    'SELECT id, full_name, phone_number, email, address, is_active, created_at FROM customers ORDER BY id DESC LIMIT 5'
  );
  if (customers.length > 0) {
    console.table(customers);
  } else {
    console.log('  (No customers registered yet)');
  }

  console.log('\n----------------------------------------------------');
  console.log('  🎟️ LUCKY DRAW COUPONS (Latest 5)');
  console.log('----------------------------------------------------');
  const [coupons] = await conn.query(
    'SELECT id, coupon_number, customer_name, phone_number, status, staff_id, created_at FROM lucky_draw_coupons ORDER BY created_at DESC LIMIT 5'
  );
  if (coupons.length > 0) {
    console.table(coupons);
  } else {
    console.log('  (No lucky draw coupons yet)');
  }

  console.log('\n----------------------------------------------------');
  console.log('  🏡 PROPERTIES (Latest 5)');
  console.log('----------------------------------------------------');
  const [properties] = await conn.query(
    'SELECT id, title, location, city, price_starting, plot_sizes, approval FROM properties ORDER BY created_at DESC LIMIT 5'
  );
  if (properties.length > 0) {
    console.table(properties);
  } else {
    console.log('  (No properties found)');
  }

  console.log('\n----------------------------------------------------');
  console.log('  🔐 RECENT OTP CODES (Latest 5)');
  console.log('----------------------------------------------------');
  const [otps] = await conn.query(
    'SELECT id, phone_or_email, otp, purpose, is_used, expires_at, created_at FROM otp_codes ORDER BY id DESC LIMIT 5'
  );
  if (otps.length > 0) {
    console.table(otps);
  } else {
    console.log('  (No OTP records)');
  }

  await conn.end();
}

checkDatabase().catch(console.error);
