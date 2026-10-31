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

      await connection.query(`
        INSERT INTO \`properties\` (\`id\`, \`title\`, \`location\`, \`city\`, \`price_starting\`, \`price_per_sqft\`, \`plot_sizes\`, \`approval\`, \`rera_number\`, \`category\`, \`image_path\`, \`amenities\`, \`is_featured\`)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          \`title\` = VALUES(\`title\`),
          \`location\` = VALUES(\`location\`),
          \`city\` = VALUES(\`city\`),
          \`price_starting\` = VALUES(\`price_starting\`),
          \`price_per_sqft\` = VALUES(\`price_per_sqft\`),
          \`plot_sizes\` = VALUES(\`plot_sizes\`),
          \`approval\` = VALUES(\`approval\`),
          \`category\` = VALUES(\`category\`),
          \`is_featured\` = VALUES(\`is_featured\`)
      `, [
        p.id,
        p.title,
        p.location,
        p.city,
        p.priceStarting,
        p.pricePerSqFt,
        p.plotSizes,
        p.approval,
        p.reraNumber || '',
        p.category,
        defaultLandImage,
        amenities,
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
