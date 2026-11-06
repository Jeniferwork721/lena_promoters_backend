-- ==========================================================
-- Lena Promoters Database Schema
-- Compatible with MySQL 5.7+ / MySQL 8.x / MariaDB
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `lena_promoters_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `lena_promoters_db`;

-- 1. Staff Users Table
CREATE TABLE IF NOT EXISTS `staff_users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `employee_id` VARCHAR(50) NOT NULL UNIQUE,
  `full_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `phone_number` VARCHAR(25) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `branch_location` VARCHAR(120) NOT NULL DEFAULT 'Chennai - Tambaram Branch',
  `role` VARCHAR(50) NOT NULL DEFAULT 'STAFF',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. OTP Codes Table (For Staff Login & Account Activation)
CREATE TABLE IF NOT EXISTS `otp_codes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `phone_or_email` VARCHAR(150) NOT NULL,
  `otp` VARCHAR(10) NOT NULL,
  `purpose` VARCHAR(50) NOT NULL DEFAULT 'LOGIN',
  `is_used` TINYINT(1) NOT NULL DEFAULT 0,
  `expires_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_otp_lookup` (`phone_or_email`, `otp`, `is_used`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Properties (Plots & Layouts) Table
CREATE TABLE IF NOT EXISTS `properties` (
  `id` VARCHAR(50) PRIMARY KEY,
  `title` VARCHAR(200) NOT NULL,
  `location` VARCHAR(150) NOT NULL,
  `city` VARCHAR(100) NOT NULL,
  `price_starting` VARCHAR(50) NOT NULL,
  `price_per_sqft` VARCHAR(50) NOT NULL,
  `plot_sizes` VARCHAR(100) NOT NULL,
  `approval` VARCHAR(150) NOT NULL,
  `rera_number` VARCHAR(150) NOT NULL,
  `category` VARCHAR(100) NOT NULL DEFAULT 'Villa Plots',
  `image_path` TEXT NOT NULL,
  `images` JSON NULL,
  `amenities` JSON NULL,
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Lucky Draw Schemes Configuration
CREATE TABLE IF NOT EXISTS `lucky_draw_schemes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `scheme_name` VARCHAR(150) NOT NULL,
  `entry_fee` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
  `bumper_prize` VARCHAR(255) NOT NULL DEFAULT '1,200 Sq.Ft DTCP Approved Villa Plot',
  `assured_gift` VARCHAR(255) NOT NULL DEFAULT 'Guaranteed ₹500 Worth Gift Kit / Voucher',
  `terms_summary` TEXT,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Lucky Draw Events / Seasons Table (Every 2-3 Months recurring rounds)
CREATE TABLE IF NOT EXISTS `lucky_draw_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_code` VARCHAR(50) NOT NULL UNIQUE,
  `event_title` VARCHAR(150) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NULL,
  `bumper_prize` VARCHAR(255) NOT NULL DEFAULT '1,200 Sq.Ft DTCP Approved Villa Plot',
  `assured_gift` VARCHAR(255) NOT NULL DEFAULT 'Guaranteed ₹500 Worth Gift Kit / Voucher',
  `entry_fee` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
  `status` ENUM('ACTIVE', 'CONCLUDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  `winner_coupon` VARCHAR(50) NULL,
  `receipts_purged` TINYINT(1) NOT NULL DEFAULT 0,
  `purged_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default Season 1
INSERT INTO `lucky_draw_events` (`id`, `event_code`, `event_title`, `start_date`, `bumper_prize`, `status`)
VALUES (1, 'SEASON-01', 'Mega Land Lucky Draw - Season 1', '2026-01-01', '1,200 Sq.Ft DTCP Approved Villa Plot', 'ACTIVE')
ON DUPLICATE KEY UPDATE `status` = 'ACTIVE';

-- 6. Lucky Draw Coupons Table (Customer & Staff Verification & Slot Recycling)
CREATE TABLE IF NOT EXISTS `lucky_draw_coupons` (
  `id` VARCHAR(60) PRIMARY KEY,
  `event_id` INT NOT NULL DEFAULT 1,
  `coupon_number` VARCHAR(50) NOT NULL UNIQUE,
  `customer_name` VARCHAR(150) NOT NULL,
  `date_of_birth` DATE NOT NULL,
  `phone_number` VARCHAR(25) NOT NULL,
  `email` VARCHAR(150) NULL,
  `address` TEXT NOT NULL,
  `referred_by` VARCHAR(150) NULL,
  `applicant_phone` VARCHAR(25) NULL,
  `entry_fee` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
  `status` ENUM('PENDING_STAFF_VERIFICATION', 'VERIFIED_AND_PAID', 'REJECTED', 'WINNER_ANNOUNCED') NOT NULL DEFAULT 'PENDING_STAFF_VERIFICATION',
  `rejection_reason` VARCHAR(255) NULL,
  `rejected_by_staff` VARCHAR(150) NULL,
  `rejected_at` DATETIME NULL,
  `staff_name` VARCHAR(150) NULL,
  `staff_id` VARCHAR(50) NULL,
  `payment_trans_id` VARCHAR(120) NULL,
  `payment_mode` VARCHAR(80) NULL,
  `payment_screenshot_name` VARCHAR(255) NULL,
  `payment_screenshot_url` VARCHAR(500) NULL,
  `verified_at` DATETIME NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_coupon_number` (`coupon_number`),
  INDEX `idx_coupon_event` (`event_id`),
  INDEX `idx_coupon_phone` (`phone_number`),
  INDEX `idx_coupon_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Site Visits Table
CREATE TABLE IF NOT EXISTS `site_visits` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `property_id` VARCHAR(50) NULL,
  `property_title` VARCHAR(200) NOT NULL,
  `customer_name` VARCHAR(150) NOT NULL,
  `phone_number` VARCHAR(25) NOT NULL,
  `visit_date` DATE NOT NULL,
  `time_slot` VARCHAR(50) NOT NULL,
  `pickup_required` TINYINT(1) NOT NULL DEFAULT 0,
  `pickup_address` TEXT NULL,
  `driver_name` VARCHAR(100) NULL,
  `vehicle_no` VARCHAR(50) NULL,
  `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
