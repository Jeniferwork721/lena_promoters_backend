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
        \`role\` VARCHAR(50) NOT NULL DEFAULT 'STAFF',
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

    // 3. Properties Table (Master Entity for Properties & Layouts)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`properties\` (
        \`id\` VARCHAR(50) PRIMARY KEY,
        \`title\` VARCHAR(200) NOT NULL,
        \`location\` VARCHAR(150) NOT NULL,
        \`city\` VARCHAR(100) NOT NULL,
        \`price_starting\` VARCHAR(50) NOT NULL,
        \`price_per_cent\` DECIMAL(12,2) NULL,
        \`price_unit\` VARCHAR(20) NOT NULL DEFAULT 'cent',
        \`price_per_sqft\` VARCHAR(50) NOT NULL,
        \`plot_sizes\` VARCHAR(100) NOT NULL,
        \`approval\` VARCHAR(150) NOT NULL,
        \`rera_number\` VARCHAR(150) NOT NULL,
        \`category\` VARCHAR(100) NOT NULL DEFAULT 'Villa Plots',
        \`image_path\` TEXT NOT NULL,
        \`images\` JSON NULL,
        \`amenities\` JSON NULL,
        \`offers\` JSON NULL,
        \`plot_min\` DECIMAL(8,2) NULL,
        \`plot_max\` DECIMAL(8,2) NULL,
        \`budget_min\` DECIMAL(12,2) NULL,
        \`budget_max\` DECIMAL(12,2) NULL,
        \`total_plots\` INT NULL DEFAULT 0,
        \`available_plots\` INT NULL DEFAULT 0,
        \`corner_plots\` TINYINT(1) NOT NULL DEFAULT 0,
        \`pdf_url\` TEXT NULL,
        \`note\` TEXT NULL,
        \`ongoing\` TINYINT(1) NOT NULL DEFAULT 1,
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`is_featured\` TINYINT(1) NOT NULL DEFAULT 0,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_prop_title\` (\`title\`),
        INDEX \`idx_prop_ongoing\` (\`ongoing\`, \`active\`),
        INDEX \`idx_prop_city\` (\`city\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3b. Ensure all layout columns exist on properties table (safe dynamic migration)
    const propertyMigrations = [
      { name: 'images', type: 'JSON NULL AFTER \`image_path\`' },
      { name: 'price_per_cent', type: 'DECIMAL(12,2) NULL' },
      { name: 'price_unit', type: "VARCHAR(20) NOT NULL DEFAULT 'cent'" },
      { name: 'offers', type: 'JSON NULL' },
      { name: 'plot_min', type: 'DECIMAL(8,2) NULL' },
      { name: 'plot_max', type: 'DECIMAL(8,2) NULL' },
      { name: 'budget_min', type: 'DECIMAL(12,2) NULL' },
      { name: 'budget_max', type: 'DECIMAL(12,2) NULL' },
      { name: 'total_plots', type: 'INT NULL DEFAULT 0' },
      { name: 'available_plots', type: 'INT NULL DEFAULT 0' },
      { name: 'corner_plots', type: 'TINYINT(1) NOT NULL DEFAULT 0' },
      { name: 'pdf_url', type: 'TEXT NULL' },
      { name: 'note', type: 'TEXT NULL' },
      { name: 'ongoing', type: 'TINYINT(1) NOT NULL DEFAULT 1' },
      { name: 'active', type: 'TINYINT(1) NOT NULL DEFAULT 1' },
    ];
    for (const col of propertyMigrations) {
      try {
        await connection.query(`ALTER TABLE \`properties\` ADD COLUMN \`${col.name}\` ${col.type};`);
      } catch (err) {
        if (!err.message.includes('Duplicate column name')) {
          console.warn(`[Properties Migration] Notice on ${col.name}:`, err.message);
        }
      }
    }

    // 3c. Unify layouts into properties: migrate existing layouts table if present, then maintain transparent view
    try {
      const [tableCheck] = await connection.query("SHOW FULL TABLES LIKE 'layouts'");
      if (tableCheck && tableCheck.length > 0 && Object.values(tableCheck[0])[1] === 'BASE TABLE') {
        await connection.query(`
          INSERT INTO \`properties\` (
            \`id\`, \`title\`, \`location\`, \`city\`, \`price_starting\`, \`price_per_cent\`, \`price_unit\`,
            \`offers\`, \`category\`, \`plot_sizes\`, \`plot_min\`, \`plot_max\`, \`budget_min\`, \`budget_max\`,
            \`total_plots\`, \`available_plots\`, \`corner_plots\`, \`pdf_url\`, \`note\`, \`ongoing\`, \`active\`,
            \`image_path\`, \`approval\`, \`price_per_sqft\`
          )
          SELECT
            \`id\`, \`name\`, \`location\`, \`location\`,
            CONCAT('₹', FORMAT(\`price_per_cent\`, 0), ' / ', \`price_unit\`),
            \`price_per_cent\`, \`price_unit\`, \`offers\`, \`property_type\`, 'Residential Plots',
            \`plot_min\`, \`plot_max\`, \`budget_min\`, \`budget_max\`,
            \`total_plots\`, \`available_plots\`, \`corner_plots\`, \`pdf_url\`, \`note\`, \`ongoing\`, \`active\`,
            'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
            'DTCP Approved',
            CONCAT('₹', ROUND(\`price_per_cent\` / 435.6), ' / sq.ft')
          FROM \`layouts\`
          ON DUPLICATE KEY UPDATE
            \`price_per_cent\` = VALUES(\`price_per_cent\`),
            \`offers\` = VALUES(\`offers\`),
            \`total_plots\` = VALUES(\`total_plots\`),
            \`available_plots\` = VALUES(\`available_plots\`),
            \`corner_plots\` = VALUES(\`corner_plots\`),
            \`pdf_url\` = VALUES(\`pdf_url\`),
            \`note\` = VALUES(\`note\`),
            \`ongoing\` = VALUES(\`ongoing\`),
            \`active\` = VALUES(\`active\`);
        `);
        await connection.query("DROP TABLE IF EXISTS \`layouts\`");
      }

      await connection.query(`
        CREATE OR REPLACE VIEW \`layouts\` AS
        SELECT
          \`id\`,
          \`title\` AS \`name\`,
          \`location\`,
          \`city\`,
          \`price_per_cent\`,
          \`price_unit\`,
          \`offers\`,
          \`category\` AS \`property_type\`,
          \`plot_min\`,
          \`plot_max\`,
          \`budget_min\`,
          \`budget_max\`,
          \`total_plots\`,
          \`available_plots\`,
          \`corner_plots\`,
          \`pdf_url\`,
          \`note\`,
          \`ongoing\`,
          \`active\`,
          \`image_path\`,
          \`images\`,
          \`amenities\`,
          \`is_featured\`,
          \`created_at\`,
          \`updated_at\`
        FROM \`properties\`;
      `);
      console.log('🏛️ Unified properties and layouts master view verified');
    } catch (e) {
      console.warn('Notice on layouts view unification:', e.message);
    }

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
      // Ensure role column on staff_users is VARCHAR(50) to support all web app roles (STAFF, ADMIN, MANAGER, SUPER_ADMIN, TELECALLER, etc.)
      const [roleCol] = await connection.query("SHOW COLUMNS FROM `staff_users` LIKE 'role'");
      if (roleCol.length === 0) {
        await connection.query("ALTER TABLE `staff_users` ADD COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'STAFF' AFTER `branch_location`");
      } else if (roleCol[0].Type && roleCol[0].Type.toLowerCase().startsWith('enum')) {
        await connection.query("ALTER TABLE `staff_users` MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'STAFF'");
      }

      const [refVisitCol] = await connection.query('SHOW COLUMNS FROM `site_visits` LIKE "referred_by"');
      if (refVisitCol.length === 0) {
        await connection.query('ALTER TABLE `site_visits` ADD COLUMN `referred_by` VARCHAR(150) DEFAULT "Direct Company Referral" AFTER `pickup_address`');
      }
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

      // Extended customer profile KYC & preferences columns
      const extendedCols = [
        { name: 'street', type: 'TEXT NULL' },
        { name: 'landmark', type: 'VARCHAR(255) NULL' },
        { name: 'city', type: 'VARCHAR(100) NULL' },
        { name: 'pincode', type: 'VARCHAR(20) NULL' },
        { name: 'aadhar_number', type: 'VARCHAR(30) NULL' },
        { name: 'pan_number', type: 'VARCHAR(30) NULL' },
        { name: 'nominee_name', type: 'VARCHAR(150) NULL' },
        { name: 'dream_land_size', type: 'VARCHAR(100) NULL' },
        { name: 'occupation', type: 'VARCHAR(100) NULL' },
        { name: 'profile_pic', type: 'TEXT NULL' },
      ];
      for (const col of extendedCols) {
        const [exists] = await connection.query(`SHOW COLUMNS FROM \`customers\` LIKE "${col.name}"`);
        if (exists.length === 0) {
          await connection.query(`ALTER TABLE \`customers\` ADD COLUMN \`${col.name}\` ${col.type}`);
        }
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

    // Ensure official Lena Promoters Company Profile in staff_users for direct referrals
    await connection.query(
      "INSERT INTO `staff_users` (`employee_id`, `full_name`, `email`, `phone_number`, `password_hash`, `branch_location`, `role`, `is_active`) " +
      "VALUES ('LP-COMPANY', 'Lena Promoters (Company Direct)', 'info@lenapromoters.com', '+919999999999', '$2a$10$wK1.V/f8Qe550c.8p6g8mOs.aQYg.l1wFp30yYF3bC6Xq7v4vL0re', 'Karaikudi – Head Office', 'ADMIN', 1) " +
      "ON DUPLICATE KEY UPDATE `full_name` = 'Lena Promoters (Company Direct)', `branch_location` = 'Karaikudi – Head Office', `is_active` = 1"
    );
    console.log('🏢 [DB Seed] Synced official Company Profile (LP-COMPANY) to DB');

    // Note: Default mock customer and staff seeds removed to maintain production cleanliness.
    // Live accounts are managed via registration and direct database administration.

    // Clean up old sample properties if present
    await connection.query("DELETE FROM `properties` WHERE `id` IN ('lp-01', 'lp-02', 'lp-03', 'lp-04')");

    // Sync 31 Official Lena Promoters Ongoing Layout Projects
    const defaultLandImage = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80';

    const ongoingProjects = [
      // 1. Karaikudi Layouts (17)
      { id: 'lp-kkd-01', title: "Lena's Annamalaiyar Nagar", location: 'Kanadukathan', city: 'Karaikudi', priceStarting: '₹5,00,000 / cent', pricePerSqFt: '₹1,148 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 1 },
      { id: 'lp-kkd-02', title: "Lena's Meenatchi Farm", location: 'Devakottai', city: 'Karaikudi', priceStarting: '₹35,000 / cent', pricePerSqFt: '₹80 / sq.ft', plotSizes: 'Farm Land', approval: 'Clear Title Deeds', category: 'Farm Lands', isFeatured: 0 },
      { id: 'lp-kkd-03', title: "Lena's Metro City", location: 'Kallal', city: 'Karaikudi', priceStarting: '₹3,50,000 / cent', pricePerSqFt: '₹804 / sq.ft', plotSizes: 'Township Plots', approval: 'DTCP Approved', category: 'Gated Township', isFeatured: 1 },
      { id: 'lp-kkd-04', title: "Lena's MS Nagar", location: 'Kallal', city: 'Karaikudi', priceStarting: '₹1,50,000 / cent', pricePerSqFt: '₹344 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-05', title: "Lena's Roja Avenue", location: 'Vettaikaranpatti', city: 'Karaikudi', priceStarting: '₹2,00,000 / cent', pricePerSqFt: '₹459 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-06', title: "Lena's SA Nagar", location: 'Kundrakudi', city: 'Karaikudi', priceStarting: '₹4,00,000 / cent', pricePerSqFt: '₹918 / sq.ft', plotSizes: 'Premium Plots', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 1 },
      { id: 'lp-kkd-07', title: "Lena's Sona Nagar", location: 'Kallal', city: 'Karaikudi', priceStarting: '₹1,50,000 / cent', pricePerSqFt: '₹344 / sq.ft', plotSizes: 'Plots Available', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-08', title: "Lena's Sri Sai Nagar", location: 'Aaravayal', city: 'Karaikudi', priceStarting: '₹3,50,000 / cent', pricePerSqFt: '₹804 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-09', title: "Lena's Swathi Nagar", location: 'Aaravayal', city: 'Karaikudi', priceStarting: '₹4,50,000 / cent', pricePerSqFt: '₹1,033 / sq.ft', plotSizes: 'Premium Villa Plots', approval: 'DTCP & RERA Approved', category: 'Villa Plots', isFeatured: 1 },
      { id: 'lp-kkd-10', title: "Lena's Singapore City", location: 'Thirukalapatti', city: 'Karaikudi', priceStarting: '₹3,00,000 / cent', pricePerSqFt: '₹689 / sq.ft', plotSizes: 'Integrated Township', approval: 'DTCP Approved', category: 'Gated Township', isFeatured: 1 },
      { id: 'lp-kkd-11', title: "Lena's Arpudha Nagar", location: 'Kambanur', city: 'Karaikudi', priceStarting: '₹2,00,000 / cent', pricePerSqFt: '₹459 / sq.ft', plotSizes: 'Plots Available', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-12', title: "Lena's Royal Apple Garden", location: 'Nachiyarpuram', city: 'Karaikudi', priceStarting: '₹2,00,000 / cent', pricePerSqFt: '₹459 / sq.ft', plotSizes: 'Garden Layout', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-13', title: "Lena's Annai Nagar", location: 'Koothalur', city: 'Karaikudi', priceStarting: '₹3,00,000 / cent', pricePerSqFt: '₹689 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-14', title: "Lena's Anandham Nagar", location: 'Sangarapathi Kottai', city: 'Karaikudi', priceStarting: '₹4,50,000 / cent', pricePerSqFt: '₹1,033 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 1 },
      { id: 'lp-kkd-15', title: "Lena's Habibi Dubai Empire", location: 'Sevarakottai', city: 'Karaikudi', priceStarting: '₹3,50,000 / cent', pricePerSqFt: '₹804 / sq.ft', plotSizes: 'Grand Township', approval: 'DTCP & RERA Approved', category: 'Gated Township', isFeatured: 1 },
      { id: 'lp-kkd-16', title: "Lena's Sivaram Nagar", location: 'S.V Mangalam', city: 'Karaikudi', priceStarting: '₹2,50,000 / cent', pricePerSqFt: '₹574 / sq.ft', plotSizes: 'Plots Available', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-kkd-17', title: "Lena's RVS Nagar", location: 'Nemam', city: 'Karaikudi', priceStarting: '₹4,00,000 / cent', pricePerSqFt: '₹918 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 0 },

      // 2. Coimbatore Layouts (6)
      { id: 'lp-cbe-01', title: "Lena's Sindhu Nagar", location: 'Veerapandi Pirivu', city: 'Coimbatore', priceStarting: '₹5,50,000 / cent', pricePerSqFt: '₹1,263 / sq.ft', plotSizes: 'Villa Plots', approval: 'DTCP & RERA Approved', category: 'Villa Plots', isFeatured: 1 },
      { id: 'lp-cbe-02', title: "Lena's SVPR Grand", location: 'Karamadai (Vijayanagram)', city: 'Coimbatore', priceStarting: '₹6,00,000 / cent', pricePerSqFt: '₹1,377 / sq.ft', plotSizes: 'Gated Township', approval: 'DTCP & RERA Approved', category: 'Gated Township', isFeatured: 1 },
      { id: 'lp-cbe-03', title: "Lena's Nakshatra Nagar", location: 'Karamadai (Vijayanagram)', city: 'Coimbatore', priceStarting: '₹8,00,000 / cent', pricePerSqFt: '₹1,837 / sq.ft', plotSizes: 'Luxury Villa Plots', approval: 'DTCP & RERA Approved', category: 'Villa Plots', isFeatured: 1 },
      { id: 'lp-cbe-04', title: "Lena's Vetri Nagar", location: 'Sulur (Karanampettai)', city: 'Coimbatore', priceStarting: '₹6,00,000 / cent', pricePerSqFt: '₹1,377 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-cbe-05', title: "Lena's Ashwin Nagar", location: 'Annur', city: 'Coimbatore', priceStarting: '₹8,00,000 / cent', pricePerSqFt: '₹1,837 / sq.ft', plotSizes: 'Premium Layout', approval: 'DTCP & RERA Approved', category: 'Villa Plots', isFeatured: 0 },
      { id: 'lp-cbe-06', title: "Lena's Ancia Farms", location: 'Mettupalayam', city: 'Coimbatore', priceStarting: '₹3,00,000 / cent', pricePerSqFt: '₹689 / sq.ft', plotSizes: 'Farm Lands', approval: 'Clear Title Deeds', category: 'Farm Lands', isFeatured: 0 },

      // 3. Sivagangai Layouts (5)
      { id: 'lp-svg-01', title: "Lena's Ram Nagar", location: 'Sivagangai', city: 'Sivagangai', priceStarting: '₹2,50,000 / cent', pricePerSqFt: '₹574 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-svg-02', title: "Lena's Shanmuga Avenue", location: 'Thirumanjolai', city: 'Sivagangai', priceStarting: '₹4,00,000 / cent', pricePerSqFt: '₹918 / sq.ft', plotSizes: 'Villa Plots', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 1 },
      { id: 'lp-svg-03', title: "Lena's Chithambaram Farms", location: 'Sivagangai', city: 'Sivagangai', priceStarting: '₹35,000 / cent', pricePerSqFt: '₹80 / sq.ft', plotSizes: 'Farm Lands', approval: 'Clear Title Deeds', category: 'Farm Lands', isFeatured: 0 },
      { id: 'lp-svg-04', title: "Lena's Crown Nachiyar Avenue", location: 'Puduppatti', city: 'Sivagangai', priceStarting: '₹2,50,000 / cent', pricePerSqFt: '₹574 / sq.ft', plotSizes: 'Plots Available', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-svg-05', title: "Lena's Senthur Garden", location: 'Solapuram', city: 'Sivagangai', priceStarting: '₹5,00,000 / cent', pricePerSqFt: '₹1,148 / sq.ft', plotSizes: 'Garden Layout', approval: 'DTCP & RERA Approved', category: 'Layout Plots', isFeatured: 1 },

      // 4. Pudukkottai Layouts (2)
      { id: 'lp-pdk-01', title: "Lena's Vetri Nagar", location: 'Lena Vilakku', city: 'Pudukkottai', priceStarting: '₹1,10,000 / cent', pricePerSqFt: '₹253 / sq.ft', plotSizes: 'Residential Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },
      { id: 'lp-pdk-02', title: "Lena's Eswaran Nagar", location: 'Pudukkottai', city: 'Pudukkottai', priceStarting: '₹1,50,000 / cent', pricePerSqFt: '₹344 / sq.ft', plotSizes: 'Plots Available', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 0 },

      // 5. Madurai Layouts (1)
      { id: 'lp-mdu-01', title: "Lena's Velavan Nagar", location: 'Kariyapatti', city: 'Madurai', priceStarting: '₹4,00,000 / plot', pricePerSqFt: '₹4,00,000 / plot', plotSizes: 'Individual Plots', approval: 'DTCP Approved', category: 'Layout Plots', isFeatured: 1 },
    ];

    for (const p of ongoingProjects) {
      const amenities = p.category === 'Farm Lands'
        ? JSON.stringify(["Sweet Ground Water", "Clear Title Deeds", "Fencing", "Road Access"])
        : p.category === 'Gated Township'
          ? JSON.stringify(["Grand Entrance Arch", "24/7 Security", "Solar Street Lights", "Tar Road", "Children Play Area", "Immediate Registration"])
          : JSON.stringify(["40ft Tar Road", "Sweet Ground Water", "Clear Parent Deeds", "Electricity Facility", "Immediate Registration"]);

      const numPrice = parseFloat(String(p.priceStarting).replace(/[^\d.]/g, '')) || 0;
      const unit = String(p.priceStarting).includes('plot') ? 'plot' : 'cent';

      let layoutOffers = ['Document Free', '50% Offer', 'Bank Loan', 'Plot With Rent'];
      let note = '';
      let pdfUrl = null;
      let cornerPlot = 0;
      let totalPlots = 30;
      let availPlots = 10;
      let pMin = 2.0;
      let pMax = 6.0;

      if (p.title.includes('Swathi Nagar')) {
        layoutOffers = ['10 Sq Ft 10 Gold & Silver Coin Free', 'Document Free', 'Bank Loan', 'Plot With Rent', '75% Offer'];
        note = 'DTCP approved. Gated villa community.';
        pdfUrl = '/layouts/swathi-nagar.pdf';
        totalPlots = 24;
        availPlots = 6;
        pMin = 3.05;
        pMax = 12.27;
      } else if (p.title.includes('Vetri Nagar')) {
        layoutOffers = ['Document Free', '50% Offer', '5,000 Scheme', 'Plot With Rent'];
        note = 'DTCP & RERA Approved residential layout.';
        cornerPlot = 1;
        totalPlots = 40;
        availPlots = 12;
      } else if (p.title.includes('Metro City')) {
        layoutOffers = ['Document Free', '50% Offer', '10 Sq Ft 10 Gold & Silver Coin Free', 'Bank Loan', 'Plot With Rent'];
        note = 'Gated township layout with 40ft roads.';
        totalPlots = 50;
        availPlots = 18;
      } else if (p.title.includes('Ram Nagar')) {
        layoutOffers = ['Buy 2 Get 1 Free', '50% Offer', 'Bank Loan', 'Plot With Rent'];
      } else if (p.title.includes('Annamalaiyar')) {
        layoutOffers = ['Bank Loan', 'Plot With Rent'];
        totalPlots = 32;
        availPlots = 8;
      } else if (p.title.includes('Meenatchi Farm')) {
        layoutOffers = ['Document Free'];
        pMin = 10.0;
        pMax = 100.0;
        totalPlots = 20;
        availPlots = 15;
      } else if (p.title.includes('Singapore City')) {
        layoutOffers = ['10 Sq Ft 10 Gold & Silver Coin Free', 'Document Free', 'Bank Loan', 'Plot With Rent', '75% Offer'];
        totalPlots = 60;
        availPlots = 22;
      }

      await connection.query(`
        INSERT INTO \`properties\` (
          \`id\`, \`title\`, \`location\`, \`city\`, \`price_starting\`, \`price_per_cent\`, \`price_unit\`,
          \`price_per_sqft\`, \`plot_sizes\`, \`approval\`, \`rera_number\`, \`category\`, \`image_path\`,
          \`amenities\`, \`offers\`, \`plot_min\`, \`plot_max\`, \`total_plots\`, \`available_plots\`,
          \`corner_plots\`, \`pdf_url\`, \`note\`, \`ongoing\`, \`active\`, \`is_featured\`
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
        ON DUPLICATE KEY UPDATE
          \`title\` = VALUES(\`title\`),
          \`location\` = VALUES(\`location\`),
          \`city\` = VALUES(\`city\`),
          \`price_starting\` = VALUES(\`price_starting\`),
          \`price_per_cent\` = COALESCE(properties.price_per_cent, VALUES(\`price_per_cent\`)),
          \`price_unit\` = COALESCE(properties.price_unit, VALUES(\`price_unit\`)),
          \`price_per_sqft\` = VALUES(\`price_per_sqft\`),
          \`plot_sizes\` = VALUES(\`plot_sizes\`),
          \`approval\` = VALUES(\`approval\`),
          \`category\` = VALUES(\`category\`),
          \`is_featured\` = VALUES(\`is_featured\`),
          \`offers\` = COALESCE(properties.offers, VALUES(\`offers\`)),
          \`plot_min\` = COALESCE(properties.plot_min, VALUES(\`plot_min\`)),
          \`plot_max\` = COALESCE(properties.plot_max, VALUES(\`plot_max\`)),
          \`total_plots\` = COALESCE(properties.total_plots, VALUES(\`total_plots\`)),
          \`available_plots\` = COALESCE(properties.available_plots, VALUES(\`available_plots\`)),
          \`corner_plots\` = COALESCE(properties.corner_plots, VALUES(\`corner_plots\`)),
          \`pdf_url\` = COALESCE(properties.pdf_url, VALUES(\`pdf_url\`)),
          \`note\` = COALESCE(properties.note, VALUES(\`note\`)),
          \`ongoing\` = COALESCE(properties.ongoing, VALUES(\`ongoing\`)),
          \`active\` = COALESCE(properties.active, VALUES(\`active\`))
      `, [
        p.id,
        p.title,
        p.location,
        p.city,
        p.priceStarting,
        numPrice,
        unit,
        p.pricePerSqFt,
        p.plotSizes,
        p.approval,
        p.reraNumber || '',
        p.category,
        defaultLandImage,
        amenities,
        JSON.stringify(layoutOffers),
        pMin,
        pMax,
        totalPlots,
        availPlots,
        cornerPlot,
        pdfUrl,
        note,
        p.isFeatured
      ]);
    }
    console.log('🏛️ Synced 31 official Lena Promoters ongoing layout projects to DB');

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

    // 9b. Lucky Draw Events / Seasons Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`lucky_draw_events\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`event_code\` VARCHAR(50) NOT NULL UNIQUE,
        \`event_title\` VARCHAR(150) NOT NULL,
        \`start_date\` DATE NOT NULL,
        \`end_date\` DATE NULL,
        \`bumper_prize\` VARCHAR(255) NOT NULL DEFAULT 'If you win you get a land, otherwise ₹500 worth gift',
        \`assured_gift\` VARCHAR(255) NOT NULL DEFAULT 'Guaranteed ₹500 Worth Gift Kit / Voucher',
        \`entry_fee\` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
        \`status\` ENUM('ACTIVE', 'CONCLUDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
        \`winner_coupon\` VARCHAR(50) NULL,
        \`receipts_purged\` TINYINT(1) NOT NULL DEFAULT 0,
        \`purged_at\` DATETIME NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure Season 1 exists if empty
    try {
      const [allEvents] = await connection.query('SELECT COUNT(*) as cnt FROM `lucky_draw_events`');
      if (allEvents[0].cnt === 0) {
        await connection.query(`
          INSERT INTO \`lucky_draw_events\` (\`id\`, \`event_code\`, \`event_title\`, \`start_date\`, \`bumper_prize\`, \`status\`)
          VALUES (1, 'SEASON-01', 'Mega Land Lucky Draw - Season 1', '2026-01-01', 'If you win you get a land, otherwise ₹500 worth gift', 'ACTIVE')
          ON DUPLICATE KEY UPDATE \`status\` = 'ACTIVE';
        `);
        console.log('🎉 Seeded default Season 1 for Lucky Draw Events');
      }
    } catch (_) {}

    // Ensure lucky_draw_coupons has event_id & rejection tracking columns
    try {
      const [colEv] = await connection.query("SHOW COLUMNS FROM `lucky_draw_coupons` LIKE 'event_id'");
      if (colEv.length === 0) {
        await connection.query("ALTER TABLE `lucky_draw_coupons` ADD COLUMN `event_id` INT NOT NULL DEFAULT 1 AFTER `id`");
      }
    } catch (_) {}
    try {
      const [colRej] = await connection.query("SHOW COLUMNS FROM `lucky_draw_coupons` LIKE 'rejection_reason'");
      if (colRej.length === 0) {
        await connection.query("ALTER TABLE `lucky_draw_coupons` ADD COLUMN `rejection_reason` VARCHAR(255) NULL AFTER `status`");
      }
    } catch (_) {}
    try {
      const [colStf] = await connection.query("SHOW COLUMNS FROM `lucky_draw_coupons` LIKE 'rejected_by_staff'");
      if (colStf.length === 0) {
        await connection.query("ALTER TABLE `lucky_draw_coupons` ADD COLUMN `rejected_by_staff` VARCHAR(150) NULL AFTER `rejection_reason`");
      }
    } catch (_) {}
    try {
      const [colAt] = await connection.query("SHOW COLUMNS FROM `lucky_draw_coupons` LIKE 'rejected_at'");
      if (colAt.length === 0) {
        await connection.query("ALTER TABLE `lucky_draw_coupons` ADD COLUMN `rejected_at` DATETIME NULL AFTER `rejected_by_staff`");
      }
    } catch (_) {}
    try {
      const [colWin] = await connection.query("SHOW COLUMNS FROM `lucky_draw_events` LIKE 'winner_coupon'");
      if (colWin.length === 0) {
        await connection.query("ALTER TABLE `lucky_draw_events` ADD COLUMN `winner_coupon` VARCHAR(50) NULL AFTER `status`");
      }
    } catch (_) {}

    // ==========================================================
    // CRM DATABASE MODULE INITIALIZATION
    // ==========================================================

    // 10. Teams Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`teams\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`name\` VARCHAR(150) NOT NULL UNIQUE,
        \`lead_id\` INT NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_team_lead\` (\`lead_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 11. Staff Users Table Enhancements for CRM
    try {
      const [tIdCol] = await connection.query("SHOW COLUMNS FROM `staff_users` LIKE 'team_id'");
      if (tIdCol.length === 0) {
        await connection.query("ALTER TABLE `staff_users` ADD COLUMN `team_id` INT NULL AFTER `role`");
      }
      const [mcpCol] = await connection.query("SHOW COLUMNS FROM `staff_users` LIKE 'must_change_password'");
      if (mcpCol.length === 0) {
        await connection.query("ALTER TABLE `staff_users` ADD COLUMN `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 AFTER `team_id`");
      }
      const [plainPassCol] = await connection.query("SHOW COLUMNS FROM `staff_users` LIKE 'plain_password'");
      if (plainPassCol.length === 0) {
        await connection.query("ALTER TABLE `staff_users` ADD COLUMN `plain_password` VARCHAR(255) NULL AFTER `password_hash`");
      }
      const [createdByCol] = await connection.query("SHOW COLUMNS FROM `staff_users` LIKE 'created_by'");
      if (createdByCol.length === 0) {
        await connection.query("ALTER TABLE `staff_users` ADD COLUMN `created_by` INT NULL AFTER `must_change_password`");
      }
      const [desigCol] = await connection.query("SHOW COLUMNS FROM `staff_users` LIKE 'designation'");
      if (desigCol.length === 0) {
        await connection.query("ALTER TABLE `staff_users` ADD COLUMN `designation` VARCHAR(150) NULL AFTER `role`");
      }
    } catch (e) {
      console.warn('Notice updating staff_users columns:', e.message);
    }

    // 12. Customer Leads Table (Sales Leads)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`customer_leads\` (
        \`id\` VARCHAR(60) PRIMARY KEY,
        \`name\` VARCHAR(150) NOT NULL,
        \`phone\` VARCHAR(25) NOT NULL UNIQUE,
        \`source\` VARCHAR(100) NULL,
        \`project\` VARCHAR(150) NULL,
        \`note\` TEXT NULL,
        \`lead_id\` INT NULL,
        \`employee_id\` INT NULL,
        \`assigned_at\` DATETIME NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_lead_team\` (\`lead_id\`),
        INDEX \`idx_lead_employee\` (\`employee_id\`),
        INDEX \`idx_lead_phone\` (\`phone\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 13. Tasks Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`tasks\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`title\` VARCHAR(255) NOT NULL,
        \`description\` TEXT NULL,
        \`employee_id\` INT NULL,
        \`lead_id\` INT NULL,
        \`priority\` ENUM('Low', 'Medium', 'High') NOT NULL DEFAULT 'Medium',
        \`status\` ENUM('Pending', 'Ongoing', 'Completed') NOT NULL DEFAULT 'Pending',
        \`due_date\` DATE NOT NULL,
        \`completed_at\` DATETIME NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_task_employee\` (\`employee_id\`),
        INDEX \`idx_task_lead\` (\`lead_id\`),
        INDEX \`idx_task_status\` (\`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    try {
      await connection.query('ALTER TABLE `tasks` MODIFY COLUMN `employee_id` INT NULL');
      await connection.query('ALTER TABLE `tasks` MODIFY COLUMN `lead_id` INT NULL');
    } catch (_) {}

    // 14. Work Reports Table (Post-call Entries)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`work_reports\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`employee_id\` INT NOT NULL,
        \`customer_lead_id\` VARCHAR(60) NULL,
        \`report_date\` DATE NOT NULL,
        \`task_desc\` VARCHAR(255) NULL,
        \`customer_name\` VARCHAR(150) NOT NULL,
        \`contact_phone\` VARCHAR(25) NOT NULL,
        \`whatsapp_phone\` VARCHAR(25) NOT NULL,
        \`source\` VARCHAR(100) NOT NULL,
        \`call_type\` VARCHAR(100) NOT NULL,
        \`call_status\` VARCHAR(100) NOT NULL,
        \`call_time\` VARCHAR(10) NULL,
        \`call_duration\` INT NULL DEFAULT 0,
        \`call_notes\` TEXT NULL,
        \`project\` VARCHAR(150) NULL,
        \`offer\` VARCHAR(150) NULL,
        \`property_type\` VARCHAR(100) NULL,
        \`purpose\` VARCHAR(100) NULL,
        \`payment\` VARCHAR(100) NULL,
        \`plot\` VARCHAR(100) NULL,
        \`budget\` VARCHAR(100) NULL,
        \`stage\` VARCHAR(100) NULL,
        \`qualification\` VARCHAR(50) NULL,
        \`follow_up_date\` DATE NULL,
        \`site_visit\` VARCHAR(50) NOT NULL DEFAULT 'Not Planned',
        \`work_status\` VARCHAR(50) NOT NULL DEFAULT 'Pending',
        \`requirement\` TEXT NULL,
        \`next_action\` VARCHAR(100) NOT NULL,
        \`remarks\` TEXT NULL,
        \`calls\` INT NOT NULL DEFAULT 1,
        \`discussed_layout\` TEXT NULL,
        \`corner_plot\` VARCHAR(10) NULL,
        \`not_interested_reason\` TEXT NULL,
        \`client_location\` VARCHAR(255) NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX \`idx_rep_emp_date\` (\`employee_id\`, \`report_date\`),
        INDEX \`idx_rep_cust_lead\` (\`customer_lead_id\`),
        INDEX \`idx_rep_call_status\` (\`call_status\`),
        INDEX \`idx_rep_contact\` (\`contact_phone\`),
        INDEX \`idx_rep_followup\` (\`follow_up_date\`, \`work_status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure new columns exist on work_reports if table was created previously
    const reportExtraCols = [
      { name: 'discussed_layout', type: 'TEXT NULL' },
      { name: 'corner_plot', type: 'VARCHAR(10) NULL' },
      { name: 'not_interested_reason', type: 'TEXT NULL' },
      { name: 'client_location', type: 'VARCHAR(255) NULL' },
    ];
    for (const col of reportExtraCols) {
      try {
        const [exists] = await connection.query(`SHOW COLUMNS FROM \`work_reports\` LIKE '${col.name}'`);
        if (exists.length === 0) {
          await connection.query(`ALTER TABLE \`work_reports\` ADD COLUMN \`${col.name}\` ${col.type}`);
        }
      } catch (_) {}
    }

    // 15. Config Options Table (Dropdown lists & reference data)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`config_options\` (
        \`id\` INT AUTO_INCREMENT PRIMARY KEY,
        \`list_name\` VARCHAR(100) NOT NULL UNIQUE,
        \`list_values\` JSON NOT NULL,
        \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed Config Options from DEFAULT_CRM_OPTIONS
    const { DEFAULT_CRM_OPTIONS } = require('./crmOptions');
    for (const [key, values] of Object.entries(DEFAULT_CRM_OPTIONS)) {
      await connection.query(
        `INSERT INTO \`config_options\` (\`list_name\`, \`list_values\`)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE \`list_name\` = VALUES(\`list_name\`)`,
        [key, JSON.stringify(values)]
      );
    }
    console.log('📋 Synced CRM reference data dropdown options to DB');

    // Note: Mock coupon seeding disabled to retain only real applicant and verified coupon entries.

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
