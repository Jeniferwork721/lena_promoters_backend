const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'lena_promoters_db',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  ssl: sslConfig,
});

/**
 * Automatically creates all tables and initial seed data if they do not exist.
 */
async function initializeDatabase() {
  let connection;
  const dbName = process.env.DB_NAME || 'lena_promoters_db';
  try {
    // 0. Ensure Database exists automatically
    const tempConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      ssl: sslConfig,
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await tempConn.end();

    connection = await pool.getConnection();
    console.log('✅ Connected to MySQL Database:', dbName);

    // 1. Staff Users Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`staff_users\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`employee_id\` VARCHAR(50) NOT NULL UNIQUE,
        \`full_name\` VARCHAR(150) NOT NULL,
        \`email\` VARCHAR(150) NOT NULL UNIQUE,
        \`phone_number\` VARCHAR(25) NOT NULL UNIQUE,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`branch_location\` VARCHAR(120) NOT NULL DEFAULT 'Chennai - Tambaram Branch',
        \`role\` ENUM('STAFF', 'MANAGER', 'ADMIN') NOT NULL DEFAULT 'STAFF',
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. OTP Codes Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`otp_codes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`phone_or_email\` VARCHAR(150) NOT NULL,
        \`otp\` VARCHAR(10) NOT NULL,
        \`purpose\` VARCHAR(50) NOT NULL DEFAULT 'LOGIN',
        \`is_used\` TINYINT(1) NOT NULL DEFAULT 0,
        \`expires_at\` TIMESTAMP NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_otp_lookup\` (\`phone_or_email\`, \`otp\`, \`is_used\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Properties Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`properties\` (
        \`id\` VARCHAR(50) PRIMARY KEY,
        \`title\` VARCHAR(200) NOT NULL,
        \`location\` VARCHAR(150) NOT NULL,
        \`city\` VARCHAR(100) NOT NULL,
        \`price_starting\` VARCHAR(50) NOT NULL,
        \`price_per_sqft\` VARCHAR(50) NOT NULL,
        \`plot_sizes\` VARCHAR(100) NOT NULL,
        \`approval\` VARCHAR(150) NOT NULL,
        \`rera_number\` VARCHAR(150) NOT NULL,
        \`category\` VARCHAR(100) NOT NULL DEFAULT 'Villa Plots',
        \`image_path\` TEXT NOT NULL,
        \`amenities\` JSON NULL,
        \`is_featured\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 4. Lucky Draw Schemes Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`lucky_draw_schemes\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`scheme_name\` VARCHAR(150) NOT NULL,
        \`entry_fee\` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
        \`bumper_prize\` VARCHAR(255) NOT NULL DEFAULT 'DTCP Approved Land',
        \`assured_gift\` VARCHAR(255) NOT NULL DEFAULT 'Guaranteed ₹500 Worth Gift',
        \`terms_summary\` TEXT,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 5. Lucky Draw Coupons Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`lucky_draw_coupons\` (
        \`id\` VARCHAR(60) PRIMARY KEY,
        \`coupon_number\` VARCHAR(50) NOT NULL UNIQUE,
        \`customer_name\` VARCHAR(150) NOT NULL,
        \`date_of_birth\` DATE NOT NULL,
        \`phone_number\` VARCHAR(25) NOT NULL,
        \`address\` TEXT NOT NULL,
        \`referred_by\` VARCHAR(150) NULL,
        \`entry_fee\` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
        \`status\` ENUM('PENDING_STAFF_VERIFICATION', 'VERIFIED_AND_PAID', 'WINNER_ANNOUNCED') NOT NULL DEFAULT 'PENDING_STAFF_VERIFICATION',
        \`staff_name\` VARCHAR(150) NULL,
        \`staff_id\` VARCHAR(50) NULL,
        \`payment_trans_id\` VARCHAR(120) NULL,
        \`payment_mode\` VARCHAR(80) NULL,
        \`payment_screenshot_name\` VARCHAR(255) NULL,
        \`payment_screenshot_url\` VARCHAR(500) NULL,
        \`verified_at\` DATETIME NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_coupon_number\` (\`coupon_number\`),
        INDEX \`idx_coupon_phone\` (\`phone_number\`),
        INDEX \`idx_coupon_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 6. Site Visits Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`site_visits\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`property_id\` VARCHAR(50) NULL,
        \`property_title\` VARCHAR(200) NOT NULL,
        \`customer_name\` VARCHAR(150) NOT NULL,
        \`phone_number\` VARCHAR(25) NOT NULL,
        \`visit_date\` DATE NOT NULL,
        \`time_slot\` VARCHAR(50) NOT NULL,
        \`pickup_required\` TINYINT(1) NOT NULL DEFAULT 0,
        \`pickup_address\` TEXT NULL,
        \`driver_name\` VARCHAR(100) NULL,
        \`vehicle_no\` VARCHAR(50) NULL,
        \`status\` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 7. Customers Table (For Investor & Customer Profile View - No Password Required)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`customers\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`full_name\` VARCHAR(150) NOT NULL,
        \`phone_number\` VARCHAR(25) NOT NULL UNIQUE,
        \`email\` VARCHAR(150) NULL,
        \`address\` TEXT NULL,
        \`referred_by\` VARCHAR(150) NULL,
        \`date_of_birth\` DATE NULL,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_cust_phone\` (\`phone_number\`),
        INDEX \`idx_cust_email\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure address, date_of_birth, and referred_by columns exist on existing tables
    try {
      const [addrCol] = await connection.query('SHOW COLUMNS FROM `customers` LIKE "address"');
      if (addrCol.length === 0) {
        await connection.query('ALTER TABLE `customers` ADD COLUMN `address` TEXT NULL AFTER `email`');
      }
      const [refCustCol] = await connection.query('SHOW COLUMNS FROM `customers` LIKE "referred_by"');
      if (refCustCol.length === 0) {
        await connection.query('ALTER TABLE `customers` ADD COLUMN `referred_by` VARCHAR(150) NULL AFTER `address`');
      }
      const [dobCol] = await connection.query('SHOW COLUMNS FROM `customers` LIKE "date_of_birth"');
      if (dobCol.length === 0) {
        await connection.query('ALTER TABLE `customers` ADD COLUMN `date_of_birth` DATE NULL AFTER `referred_by`');
      }
      const [refCouponCol] = await connection.query('SHOW COLUMNS FROM `lucky_draw_coupons` LIKE "referred_by"');
      if (refCouponCol.length === 0) {
        await connection.query('ALTER TABLE `lucky_draw_coupons` ADD COLUMN `referred_by` VARCHAR(150) NULL AFTER `address`');
      }
      const [emailCouponCol] = await connection.query('SHOW COLUMNS FROM `lucky_draw_coupons` LIKE "email"');
      if (emailCouponCol.length === 0) {
        await connection.query('ALTER TABLE `lucky_draw_coupons` ADD COLUMN `email` VARCHAR(150) NULL AFTER `phone_number`');
      }
      const [appPhoneCol] = await connection.query('SHOW COLUMNS FROM `lucky_draw_coupons` LIKE "applicant_phone"');
      if (appPhoneCol.length === 0) {
        await connection.query('ALTER TABLE `lucky_draw_coupons` ADD COLUMN `applicant_phone` VARCHAR(25) NULL AFTER `referred_by`');
      }

      // Enforce unique constraints on customer phone & email
      try {
        await connection.query('ALTER TABLE `customers` ADD UNIQUE INDEX `uniq_cust_email` (`email`)');
      } catch (_) {}
      try {
        await connection.query('ALTER TABLE `customers` ADD UNIQUE INDEX `uniq_cust_phone` (`phone_number`)');
      } catch (_) {}
    } catch (_) {}

    // 8. Refresh Tokens Table (For Secure Long-Lived Sessions with Auto-Refresh)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`refresh_tokens\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`user_type\` ENUM('STAFF', 'CUSTOMER') NOT NULL DEFAULT 'STAFF',
        \`user_id\` INT NOT NULL,
        \`token\` VARCHAR(500) NOT NULL,
        \`expires_at\` TIMESTAMP NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX \`idx_refresh_token\` (\`token\`(255)),
        INDEX \`idx_user_lookup\` (\`user_type\`, \`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 9. Branches Table (Official Lena Promoters Office Locations)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`branches\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`branch_name\` VARCHAR(150) NOT NULL UNIQUE,
        \`address\` TEXT NOT NULL,
        \`city\` VARCHAR(100) NOT NULL,
        \`pincode\` VARCHAR(20) NULL,
        \`phone\` VARCHAR(100) NULL,
        \`is_head_office\` TINYINT(1) NOT NULL DEFAULT 0,
        \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_branch_city\` (\`city\`),
        INDEX \`idx_branch_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed Official Branches
    const officialBranches = [
      {
        name: 'Karaikudi – Head Office',
        address: 'No. 49/3, Keelamel Street, Soodamanipuram, 100 Ft Road, Karaikudi – 630002',
        city: 'Karaikudi',
        pincode: '630002',
        phone: '8148148140 / 8148748140',
        isHeadOffice: 1,
      },
      {
        name: 'Coimbatore Branch',
        address: 'First Floor, Brookfields Mall, Sukrawar Pettai, Ram Nagar, Coimbatore – 641001',
        city: 'Coimbatore',
        pincode: '641001',
        phone: '8148481474',
        isHeadOffice: 0,
      },
      {
        name: 'Sivagangai Branch',
        address: 'Collector Office Road, Kanjirangal, Sivaganga – 630561',
        city: 'Sivaganga',
        pincode: '630561',
        phone: '8148448140',
        isHeadOffice: 0,
      },
      {
        name: 'Pudukkottai Branch',
        address: 'No. 5630, South 4th Street, AMR Building, Pudukkottai – 622001',
        city: 'Pudukkottai',
        pincode: '622001',
        phone: '8148108140',
        isHeadOffice: 0,
      },
      {
        name: 'Dubai Branch',
        address: 'BMI Building, Bank Road, Bur Dubai, Dubai',
        city: 'Dubai',
        pincode: '',
        phone: '',
        isHeadOffice: 0,
      },
    ];

    for (const b of officialBranches) {
      await connection.query(
        `INSERT INTO \`branches\` (\`branch_name\`, \`address\`, \`city\`, \`pincode\`, \`phone\`, \`is_head_office\`, \`is_active\`)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE 
           \`address\` = VALUES(\`address\`),
           \`city\` = VALUES(\`city\`),
           \`pincode\` = VALUES(\`pincode\`),
           \`phone\` = VALUES(\`phone\`),
           \`is_head_office\` = VALUES(\`is_head_office\`),
           \`is_active\` = 1`,
        [b.name, b.address, b.city, b.pincode, b.phone, b.isHeadOffice]
      );
    }
    console.log('🏛️ Synced 5 official Lena Promoters branches to DB');

    // Seed Default Customer if table is empty
    const [customerCount] = await connection.query('SELECT COUNT(*) as count FROM `customers`');
    if (customerCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`customers\` (\`full_name\`, \`phone_number\`, \`email\`)
        VALUES ('Karthik Subramanian', '9876543210', 'karthik.subramanian@gmail.com')
      `);
      console.log('🌱 Seeded default customer account (Karthik Subramanian / 9876543210)');
    }

    // Seed Default Staff if table is empty
    const [staffCount] = await connection.query('SELECT COUNT(*) as count FROM `staff_users`');
    if (staffCount[0].count === 0) {
      const defaultHash = await bcrypt.hash('LenaStaff@2026', 10);
      await connection.query(`
        INSERT INTO \`staff_users\` (\`employee_id\`, \`full_name\`, \`email\`, \`phone_number\`, \`password_hash\`, \`branch_location\`, \`role\`)
        VALUES 
        ('LP-EMP-104', 'Rajesh Kumar', 'staff@lenapromoters.com', '9840123456', ?, 'Karaikudi – Head Office', 'STAFF'),
        ('LP-EMP-208', 'Priya Sundaram', 'priya.s@lenapromoters.com', '9444198765', ?, 'Coimbatore Branch', 'STAFF'),
        ('LP-ADMIN-01', 'Lena Admin', 'admin@lenapromoters.com', '9999900000', ?, 'Karaikudi – Head Office', 'ADMIN')
      `, [defaultHash, defaultHash, defaultHash]);
      console.log('🌱 Seeded default staff accounts (Password: LenaStaff@2026)');
    }

    // Seed Properties if table is empty
    const [propertyCount] = await connection.query('SELECT COUNT(*) as count FROM `properties`');
    if (propertyCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`properties\` (\`id\`, \`title\`, \`location\`, \`city\`, \`price_starting\`, \`price_per_sqft\`, \`plot_sizes\`, \`approval\`, \`rera_number\`, \`category\`, \`image_path\`, \`amenities\`, \`is_featured\`)
        VALUES
        (
          'lp-01', 
          'Lena Emerald Enclave', 
          'Tambaram - Mudichur Road', 
          'Chennai & Around', 
          '₹22.5 Lakhs', 
          '₹2,250 / sq.ft', 
          '1,000 - 2,400 sq.ft', 
          'CMDA & RERA Approved', 
          'TN/01/Layout/1420/2024', 
          'Villa Plots', 
          'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80', 
          '["40ft Tar Road", "Grand Entrance Arch", "24/7 Security", "Potable Water", "Children Play Park"]', 
          1
        ),
        (
          'lp-02', 
          'Lena Grand Meadows', 
          'Kelambakkam, OMR Tech Corridor', 
          'Chennai & Around', 
          '₹28.0 Lakhs', 
          '₹2,800 / sq.ft', 
          '1,200 - 3,000 sq.ft', 
          'DTCP & RERA Approved', 
          'TN/02/Layout/0891/2024', 
          'Gated Township', 
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80', 
          '["Avenue Trees", "Solar Street Lights", "Underground Drainage", "Clubhouse Site", "Immediate Registration"]', 
          1
        ),
        (
          'lp-03', 
          'Lena Royal Palms', 
          'Avadi - Thiruninravur Link', 
          'Chennai & Around', 
          '₹16.8 Lakhs', 
          '₹1,680 / sq.ft', 
          '800 - 1,800 sq.ft', 
          'CMDA & RERA Approved', 
          'TN/01/Layout/2201/2024', 
          'Villa Plots', 
          'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80', 
          '["30ft Blacktop Roads", "Clear Title Deeds", "Bank Loan Up to 85%", "Sweet Ground Water"]', 
          0
        ),
        (
          'lp-04', 
          'Lena Smart City Plots', 
          'Kovaipudur High Growth Zone', 
          'Coimbatore & Tirupur', 
          '₹19.5 Lakhs', 
          '₹1,950 / sq.ft', 
          '1,000 - 2,500 sq.ft', 
          'DTCP & RERA Approved', 
          'TN/03/Layout/3310/2024', 
          'Smart Community', 
          'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80', 
          '["Gated Entrance", "CCTV Surveillance", "Lush Mountain View", "Compound Wall"]', 
          1
        )
      `);
      console.log('🌱 Seeded sample properties matching Flutter app');
    }

    // Seed Active Lucky Draw Scheme
    const [schemeCount] = await connection.query('SELECT COUNT(*) as count FROM `lucky_draw_schemes`');
    if (schemeCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`lucky_draw_schemes\` (\`scheme_name\`, \`entry_fee\`, \`bumper_prize\`, \`assured_gift\`, \`terms_summary\`, \`is_active\`)
        VALUES 
        (
          'Lena Promoters ₹500 Mega Land Lucky Draw', 
          500.00, 
          'DTCP Approved Land', 
          'Guaranteed ₹500 Worth Gift', 
          '1. Entry fee is strictly ₹500. 2. Staff verification and official payment receipt are mandatory. 3. Winner will receive free registration of land, otherwise non-winners receive guaranteed ₹500 worth gift.', 
          1
        )
      `);
      console.log('🌱 Seeded active lucky draw scheme');
    }

    // Seed Sample Coupons
    const [couponCount] = await connection.query('SELECT COUNT(*) as count FROM `lucky_draw_coupons`');
    if (couponCount[0].count === 0) {
      await connection.query(`
        INSERT INTO \`lucky_draw_coupons\` 
        (\`id\`, \`coupon_number\`, \`customer_name\`, \`date_of_birth\`, \`phone_number\`, \`address\`, \`entry_fee\`, \`status\`, \`staff_name\`, \`staff_id\`, \`payment_trans_id\`, \`payment_mode\`, \`payment_screenshot_name\`, \`payment_screenshot_url\`, \`verified_at\`)
        VALUES 
        (
          'ld-001', 
          'LENA-LD-8801', 
          'Anand Kumar V', 
          '1992-05-14', 
          '+91 98402 11223', 
          'No. 24, Gandhi Road, Tambaram West, Chennai - 600045', 
          500.00, 
          'VERIFIED_AND_PAID', 
          'Rajesh Kumar', 
          'LP-EMP-104', 
          'UPI-SBI-20261025-992182', 
          'Google Pay (UPI)', 
          'sample_receipt_8801.png', 
          NULL, 
          NOW()
        ),
        (
          'ld-002', 
          'LENA-LD-8802', 
          'Meenakshi Sundaram', 
          '1988-11-20', 
          '+91 97910 88776', 
          'Plot 12, Sri Devi Nagar, Avadi, Chennai - 600054', 
          500.00, 
          'PENDING_STAFF_VERIFICATION', 
          NULL, 
          NULL, 
          NULL, 
          NULL, 
          NULL, 
          NULL, 
          NULL
        )
      `);
      console.log('🌱 Seeded initial sample coupons');
    }

  } catch (err) {
    const errorDetail = err.code || err.message || 'ECONNREFUSED';
    console.error(`⚠️ Database Initialization Notice: ${errorDetail}`);
    if (errorDetail.includes('ECONNREFUSED')) {
      console.log('👉 MySQL is not running on ' + (process.env.DB_HOST || 'localhost') + ':' + (process.env.DB_PORT || '3306') + '.');
      console.log('💡 To connect database: Set your MySQL host/user/pass in .env (e.g. Hostinger or local XAMPP).');
    } else {
      console.log('👉 Please check your database credentials in .env');
    }
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  initializeDatabase,
};
