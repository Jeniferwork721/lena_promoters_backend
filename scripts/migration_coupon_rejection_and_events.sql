-- ==========================================================
-- Migration: Recurring Events & Coupon Rejection Slot Recycling
-- Run on VPS: mysql -u lena_user -pLenaPromoters2026Secure lena_promoters_db < scripts/migration_coupon_rejection_and_events.sql
-- ==========================================================

USE `lena_promoters_db`;

-- 1. Create lucky_draw_events table
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

-- Seed Season 1 as default active event if table is empty
INSERT INTO `lucky_draw_events` (`id`, `event_code`, `event_title`, `start_date`, `bumper_prize`, `status`)
VALUES (1, 'SEASON-01', 'Mega Land Lucky Draw - Season 1', '2026-01-01', '1,200 Sq.Ft DTCP Approved Villa Plot', 'ACTIVE')
ON DUPLICATE KEY UPDATE `status` = 'ACTIVE';

-- 2. Add event_id and rejection tracking columns to lucky_draw_coupons
SET @dbname = DATABASE();
SET @tablename = 'lucky_draw_coupons';

-- event_id column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'event_id') > 0,
  'SELECT 1',
  'ALTER TABLE `lucky_draw_coupons` ADD COLUMN `event_id` INT NOT NULL DEFAULT 1 AFTER `id`'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- rejection_reason column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'rejection_reason') > 0,
  'SELECT 1',
  'ALTER TABLE `lucky_draw_coupons` ADD COLUMN `rejection_reason` VARCHAR(255) NULL AFTER `status`'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- rejected_by_staff column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'rejected_by_staff') > 0,
  'SELECT 1',
  'ALTER TABLE `lucky_draw_coupons` ADD COLUMN `rejected_by_staff` VARCHAR(150) NULL AFTER `rejection_reason`'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- rejected_at column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = 'rejected_at') > 0,
  'SELECT 1',
  'ALTER TABLE `lucky_draw_coupons` ADD COLUMN `rejected_at` DATETIME NULL AFTER `rejected_by_staff`'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Update status ENUM to support 'REJECTED'
ALTER TABLE `lucky_draw_coupons` MODIFY COLUMN `status` ENUM('PENDING_STAFF_VERIFICATION', 'VERIFIED_AND_PAID', 'REJECTED', 'WINNER_ANNOUNCED') NOT NULL DEFAULT 'PENDING_STAFF_VERIFICATION';

-- Add index on event_id
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = 'idx_coupon_event') > 0,
  'SELECT 1',
  'ALTER TABLE `lucky_draw_coupons` ADD INDEX `idx_coupon_event` (`event_id`)'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
