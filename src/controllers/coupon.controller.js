const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const {
  getActiveEventId,
  generateNextCouponNumber,
  generateNextCouponNumbers,
} = require('../utils/couponGenerator');

/**
 * Helper: Sanitizes any coupon number so it is never displayed with 'REJ-' prefix or timestamp.
 */
function sanitizeCouponNumber(couponNumber) {
  if (!couponNumber) return '';
  const s = String(couponNumber).trim();
  if (s.startsWith('REJ-')) {
    return s.replace(/^REJ-/, '').replace(/-[0-9]+$/, '');
  }
  return s;
}

/**
 * Helper: Automatically captures customer profile into the `customers` table
 * when any coupon is entered (by customer or staff).
 * `phone_number` is strictly unique. If the customer already exists, updates details;
 * otherwise inserts a new customer record.
 */
async function upsertCustomerRecord(connOrPool, { customerName, phoneNumber, address, dateOfBirth, email, referredBy }) {
  if (!phoneNumber) return null;
  const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '').trim();
  if (!cleanPhone) return null;

  const cleanName = (customerName || '').trim() || 'Valued Customer';
  const cleanAddress = address ? address.trim() : null;
  const cleanReferredBy = referredBy ? referredBy.trim() : null;
  const cleanDob = dateOfBirth && dateOfBirth !== 'null' ? dateOfBirth : null;
  const cleanEmail = email && email.trim().length > 0 ? email.trim() : null;

  try {
    const [existing] = await connOrPool.query(
      'SELECT id, full_name, email, address, referred_by, date_of_birth FROM customers WHERE phone_number = ? LIMIT 1',
      [cleanPhone]
    );

    if (existing.length > 0) {
      const current = existing[0];
      console.log(`ℹ️ [Customer Sync] Existing customer found (ID: ${current.id}, Phone: ${cleanPhone}). Preserving original profile; coupon linked.`);
      return current.id;
    } else {
      const [insertRes] = await connOrPool.query(
        `INSERT INTO customers (full_name, phone_number, email, address, referred_by, date_of_birth, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [cleanName, cleanPhone, cleanEmail, cleanAddress, cleanReferredBy, cleanDob]
      );
      console.log(`✅ [Customer Sync] Registered new customer profile from first coupon (ID: ${insertRes.insertId}, Phone: ${cleanPhone}).`);
      return insertRes.insertId;
    }
  } catch (err) {
    console.error('⚠️ [Customer Sync] Error saving customer from coupon:', err.message);
    return null;
  }
}

/**
 * 1. Get Lucky Draw Active Scheme Information
 */
async function getActiveScheme(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM lucky_draw_schemes WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
    );

    const scheme = rows.length > 0 ? rows[0] : {
      scheme_name: 'Lena Promoters ₹500 Mega Land Lucky Draw',
      entry_fee: '500.00',
      bumper_prize: 'DTCP Approved Land',
      assured_gift: 'Guaranteed ₹500 Worth Gift',
      terms_summary: '1. Entry fee is strictly ₹500. 2. Staff verification and official payment receipt are mandatory.',
    };

    return res.status(200).json({
      success: true,
      scheme: {
        id: scheme.id,
        schemeName: scheme.scheme_name,
        entryFee: parseFloat(scheme.entry_fee),
        bumperPrize: scheme.bumper_prize,
        assuredGift: scheme.assured_gift,
        termsSummary: scheme.terms_summary,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Customer Application (Restricted from setting staff & payment fields)
 */
async function customerApply(req, res, next) {
  try {
    const {
      customerName,
      dateOfBirth,
      phoneNumber,
      address,
      referredBy,
      paymentTransId,
      paymentMode,
      paymentScreenshotName,
      paymentScreenshotUrl,
    } = req.body;

    if (!customerName || !dateOfBirth || !phoneNumber || !address) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, date of birth, phone number, and address are required.',
      });
    }

    const finalReferredBy = (referredBy && referredBy.trim().length > 0)
      ? referredBy.trim()
      : 'Lena Promoters (Company Direct)';

    const hasScreenshot = Boolean(paymentScreenshotName || paymentScreenshotUrl);
    if (!hasScreenshot) {
      return res.status(400).json({
        success: false,
        message: 'Payment screenshot receipt is mandatory. Please upload payment receipt screenshot.',
      });
    }

    const isCashPayment = (paymentMode || '').trim().toLowerCase().includes('cash');
    const cleanTransId = (paymentTransId || '').trim();

    if (!isCashPayment && !cleanTransId) {
      return res.status(400).json({
        success: false,
        message: 'Payment Transaction ID / UPI Reference is mandatory for online payments.',
      });
    }

    const finalTransId = cleanTransId || (isCashPayment ? 'CASH_PAYMENT' : 'UPI_RECEIPT_ATTACHED');

    // Verify Payment Transaction ID uniqueness across coupons (Transaction ID cannot repeat)
    if (cleanTransId && cleanTransId !== 'UPI_RECEIPT_ATTACHED' && cleanTransId !== 'CASH_PAYMENT' && cleanTransId !== 'DIRECT_CASH') {
      const [existingTrans] = await pool.query(
        'SELECT coupon_number, customer_name FROM lucky_draw_coupons WHERE payment_trans_id = ? LIMIT 1',
        [cleanTransId]
      );
      if (existingTrans.length > 0) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_TRANSACTION_ID',
          message: `Payment Transaction ID '${cleanTransId}' has already been registered for coupon ${existingTrans[0].coupon_number}. Transaction ID cannot be repeated.`,
        });
      }
    }

    const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    const freeCount = Math.floor(quantity / 10);
    const totalCount = quantity + freeCount;
    const totalAmount = quantity * 500;

    // Check if a season is currently ACTIVE
    await ensureLuckyDrawEventsTable();
    const [activeEventRows] = await pool.query(
      "SELECT id, event_code, event_title FROM lucky_draw_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1"
    );
    if (!activeEventRows || activeEventRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'The Lucky Draw coupon season has ended. Ticket bookings are paused until the next season starts.',
      });
    }

    const activeEventId = activeEventRows[0].id;

    // Auto-generate next sequential coupon numbers with slot recycling & gap-filling
    const couponNumbers = await generateNextCouponNumbers(totalCount, activeEventId);
    const entryFee = 500.00;
    const status = 'PENDING_STAFF_VERIFICATION';
    const applicantPhone = (req.body.applicantPhone || '').trim() || null;
    const recipientEmail = (req.body.email || '').trim() || null;
    const nowTs = Date.now();
    const createdAtIso = new Date().toISOString();

    const createdCoupons = [];

    for (let i = 0; i < couponNumbers.length; i++) {
      const cNum = couponNumbers[i];
      const couponId = `ld-${nowTs}-${i}-${Math.random().toString(36).substring(2, 6)}`;
      const isBonus = i >= quantity;

      try {
        await pool.query(
          `INSERT INTO lucky_draw_coupons 
            (id, event_id, coupon_number, customer_name, date_of_birth, phone_number, email, address, referred_by, applicant_phone, entry_fee, status, payment_trans_id, payment_mode, payment_screenshot_name, payment_screenshot_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            couponId,
            activeEventId,
            cNum,
            customerName.trim(),
            dateOfBirth,
            phoneNumber.trim(),
            recipientEmail,
            address.trim(),
            finalReferredBy,
            applicantPhone,
            entryFee,
            status,
            finalTransId,
            paymentMode || 'UPI QR',
            paymentScreenshotName || null,
            paymentScreenshotUrl || null,
          ]
        );
      } catch (insertErr) {
        // Fallback for legacy DB if event_id column is not yet present
        await pool.query(
          `INSERT INTO lucky_draw_coupons 
            (id, coupon_number, customer_name, date_of_birth, phone_number, email, address, referred_by, applicant_phone, entry_fee, status, payment_trans_id, payment_mode, payment_screenshot_name, payment_screenshot_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            couponId,
            cNum,
            customerName.trim(),
            dateOfBirth,
            phoneNumber.trim(),
            recipientEmail,
            address.trim(),
            finalReferredBy,
            applicantPhone,
            entryFee,
            status,
            finalTransId,
            paymentMode || 'UPI QR',
            paymentScreenshotName || null,
            paymentScreenshotUrl || null,
          ]
        );
      }

      createdCoupons.push({
        id: couponId,
        eventId: activeEventId,
        couponNumber: cNum,
        customerName: customerName.trim(),
        dateOfBirth,
        phoneNumber: phoneNumber.trim(),
        email: recipientEmail,
        address: address.trim(),
        referredBy: finalReferredBy,
        applicantPhone,
        entryFee,
        status,
        paymentTransId: finalTransId,
        paymentMode: paymentMode || 'UPI QR',
        paymentScreenshotName: paymentScreenshotName || null,
        paymentScreenshotUrl: paymentScreenshotUrl || null,
        isBonus,
        createdAt: createdAtIso,
      });
    }

    console.log(`🎟️ [Coupons Issued] ${totalCount} coupon(s) for ${customerName.trim()} (Phone: ${phoneNumber.trim()}). Tokens: ${couponNumbers.join(', ')}`);

    const successMsg = totalCount > 1
      ? `${totalCount} Lucky Draw coupons applied successfully (${quantity} paid + ${freeCount} FREE bonus). Staff verification pending.`
      : 'Lucky draw coupon applied successfully. Staff verification pending.';

    return res.status(201).json({
      success: true,
      message: successMsg,
      coupon: createdCoupons[0],
      coupons: createdCoupons,
      summary: {
        quantity,
        freeCount,
        totalCount,
        totalAmount,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Staff Dashboard Entries (with metrics, status filter, staff-based sort & filter, and pagination)
 */
async function getStaffEntries(req, res, next) {
  try {
    const { status, search, staffId, staffName, eventId, sortBy, sortOrder } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // 1. Calculate overall metrics for Dashboard & Report
    const [metricsRows] = await pool.query(`
      SELECT 
        COUNT(*) as totalEntries,
        SUM(CASE WHEN status = 'PENDING_STAFF_VERIFICATION' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN status = 'VERIFIED_AND_PAID' THEN 1 ELSE 0 END) as verifiedCount,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejectedCount,
        SUM(CASE WHEN status = 'VERIFIED_AND_PAID' THEN entry_fee ELSE 0 END) as totalCollected
      FROM lucky_draw_coupons
    `);

    const metrics = {
      totalEntries: parseInt(metricsRows[0].totalEntries, 10) || 0,
      pendingCount: parseInt(metricsRows[0].pendingCount, 10) || 0,
      verifiedCount: parseInt(metricsRows[0].verifiedCount, 10) || 0,
      rejectedCount: parseInt(metricsRows[0].rejectedCount, 10) || 0,
      totalCollected: parseFloat(metricsRows[0].totalCollected || 0),
    };

    // 2. Build Filter Where Clause
    let whereClause = ' WHERE 1=1';
    const params = [];

    if (status && status !== 'ALL') {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (eventId && eventId !== 'ALL') {
      try {
        if (eventId === 'ACTIVE') {
          whereClause += " AND (event_id = (SELECT id FROM lucky_draw_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1) OR (event_id IS NULL AND (SELECT id FROM lucky_draw_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1) = 1))";
        } else {
          const parsed = parseInt(eventId, 10);
          if (!isNaN(parsed)) {
            whereClause += parsed === 1 ? ' AND (event_id = ? OR event_id IS NULL)' : ' AND event_id = ?';
            params.push(parsed);
          }
        }
      } catch (_) {}
    }

    if (search && search.trim().length > 0) {
      whereClause += ' AND (coupon_number LIKE ? OR customer_name LIKE ? OR phone_number LIKE ? OR staff_name LIKE ? OR staff_id LIKE ? OR referred_by LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term, term);
    }

    const hasStaffId = staffId && staffId.trim().length > 0 && staffId !== 'ALL';
    const hasStaffName = staffName && staffName.trim().length > 0 && staffName !== 'ALL';

    if (hasStaffId || hasStaffName) {
      const cleanId = hasStaffId ? staffId.trim() : '';
      const cleanName = hasStaffName ? staffName.trim() : '';

      whereClause += ` AND (
        staff_id = ?
        OR staff_name LIKE ?
        OR referred_by LIKE ?
        OR referred_by LIKE ?
        OR staff_name IN (SELECT full_name FROM staff_users WHERE employee_id = ?)
        OR referred_by IN (SELECT full_name FROM staff_users WHERE employee_id = ?)
      )`;
      params.push(
        cleanId || cleanName,
        `%${cleanName || cleanId}%`,
        `%${cleanId || cleanName}%`,
        `%${cleanName || cleanId}%`,
        cleanId || 'NO_STAFF_ID',
        cleanId || 'NO_STAFF_ID'
      );
    }

    // 3. Count total matching filtered records
    const [countRows] = await pool.query(`SELECT COUNT(*) as filteredCount FROM lucky_draw_coupons${whereClause}`, params);
    const totalFiltered = countRows[0].filteredCount || 0;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));

    // 4. Build Sort Order Clause
    let orderClause = ' ORDER BY created_at DESC';
    const direction = (sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    if (sortBy === 'staff' || sortBy === 'staffName') {
      orderClause = ` ORDER BY staff_name ${direction}, created_at DESC`;
    } else if (sortBy === 'customer' || sortBy === 'customerName') {
      orderClause = ` ORDER BY customer_name ${direction}`;
    } else if (sortBy === 'coupon' || sortBy === 'couponNumber') {
      orderClause = ` ORDER BY coupon_number ${direction}`;
    } else if (sortBy === 'oldest') {
      orderClause = ' ORDER BY created_at ASC';
    } else {
      orderClause = ` ORDER BY created_at ${direction}`;
    }

    // 5. Query paginated rows
    const [rows] = await pool.query(
      `SELECT * FROM lucky_draw_coupons${whereClause}${orderClause} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // 6. Valid active employees from database for staff-based filter dropdown
    let staffListRows = [];
    try {
      const [dbStaff] = await pool.query(`
        SELECT 
          id,
          employee_id AS staffId,
          full_name AS staffName,
          branch_location AS branch,
          role
        FROM staff_users
        WHERE is_active = 1
        ORDER BY full_name ASC
      `);
      staffListRows = dbStaff;
    } catch (_) {}

    // 7. All Seasons / Events list for season filter dropdown & history
    let events = [];
    try {
      const [eventRows] = await pool.query(`
        SELECT id, event_code AS eventCode, event_title AS eventTitle, status, 
               bumper_prize AS bumperPrize, winner_coupon AS winnerCoupon,
               start_date AS startDate, end_date AS endDate
        FROM lucky_draw_events 
        ORDER BY id DESC
      `);
      events = eventRows;
    } catch (_) {}

    const entries = rows.map(c => ({
      id: c.id,
      eventId: c.event_id || 1,
      couponNumber: sanitizeCouponNumber(c.coupon_number),
      customerName: c.customer_name,
      dateOfBirth: c.date_of_birth,
      phoneNumber: c.phone_number,
      address: c.address,
      referredBy: c.referred_by || null,
      entryFee: parseFloat(c.entry_fee),
      status: c.status,
      rejectionReason: c.rejection_reason || null,
      rejectedByStaff: c.rejected_by_staff || null,
      rejectedAt: c.rejected_at || null,
      staffName: c.staff_name,
      staffId: c.staff_id,
      paymentTransId: c.payment_trans_id,
      paymentMode: c.payment_mode,
      paymentScreenshotName: c.payment_screenshot_name,
      paymentScreenshotUrl: c.payment_screenshot_url,
      verifiedAt: c.verified_at,
      createdAt: c.created_at,
    }));

    return res.status(200).json({
      success: true,
      metrics,
      pagination: {
        total: totalFiltered,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      staffList: staffListRows,
      events,
      entries,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Get Single Coupon by ID or Coupon Number
 */
async function getCouponById(req, res, next) {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM lucky_draw_coupons WHERE id = ? OR coupon_number = ? LIMIT 1',
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found.',
      });
    }

    const c = rows[0];

    // Lookup customer profile for Aadhar and PAN KYC details if available
    let aadharNumber = '';
    let panNumber = '';
    let customerCity = '';
    try {
      const [custRows] = await pool.query(
        'SELECT aadhar_number, pan_number, city FROM customers WHERE phone = ? LIMIT 1',
        [c.phone_number]
      );
      if (custRows && custRows.length > 0) {
        aadharNumber = custRows[0].aadhar_number || '';
        panNumber = custRows[0].pan_number || '';
        customerCity = custRows[0].city || '';
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      coupon: {
        id: c.id,
        eventId: c.event_id || 1,
        couponNumber: sanitizeCouponNumber(c.coupon_number),
        customerName: c.customer_name,
        dateOfBirth: c.date_of_birth,
        phoneNumber: c.phone_number,
        address: c.address,
        aadharNumber,
        panNumber,
        city: customerCity,
        referredBy: c.referred_by || null,
        entryFee: parseFloat(c.entry_fee),
        status: c.status,
        rejectionReason: c.rejection_reason || null,
        rejectedByStaff: c.rejected_by_staff || null,
        rejectedAt: c.rejected_at || null,
        staffName: c.staff_name,
        staffId: c.staff_id,
        paymentTransId: c.payment_trans_id,
        paymentMode: c.payment_mode,
        paymentScreenshotName: c.payment_screenshot_name,
        paymentScreenshotUrl: c.payment_screenshot_url,
        verifiedAt: c.verified_at,
        createdAt: c.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 5. Staff: Edit applied coupon and issue verified stamped ticket
 */
async function staffEditAndVerify(req, res, next) {
  try {
    const { id } = req.params;
    const {
      customerName,
      dateOfBirth,
      phoneNumber,
      address,
      referredBy,
      couponNumber,
      staffName,
      staffId,
      paymentTransId,
      paymentMode,
      paymentScreenshotName,
      paymentScreenshotUrl,
      markAsVerified = true,
    } = req.body;

    const [rows] = await pool.query('SELECT * FROM lucky_draw_coupons WHERE id = ? LIMIT 1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon record not found for verification.',
      });
    }

    const current = rows[0];

    // Enforce unique Transaction ID if updated
    if (paymentTransId) {
      const cleanTransId = paymentTransId.trim();
      const isCash = (paymentMode || current.payment_mode || '').trim().toLowerCase().includes('cash');
      if (!isCash && cleanTransId && cleanTransId !== 'UPI_RECEIPT_ATTACHED' && cleanTransId !== 'CASH_PAYMENT' && cleanTransId !== 'DIRECT_CASH') {
        const [existing] = await pool.query(
          'SELECT coupon_number FROM lucky_draw_coupons WHERE payment_trans_id = ? AND id != ? LIMIT 1',
          [cleanTransId, id]
        );
        if (existing.length > 0) {
          return res.status(409).json({
            success: false,
            code: 'DUPLICATE_TRANSACTION_ID',
            message: `Payment Transaction ID '${cleanTransId}' has already been registered for coupon ${existing[0].coupon_number}. Transaction ID cannot be repeated.`,
          });
        }
      }
    }

    const finalCouponNo = couponNumber ? couponNumber.trim().toUpperCase() : current.coupon_number;
    const newStatus = markAsVerified ? 'VERIFIED_AND_PAID' : current.status;
    const verifiedAt = markAsVerified ? new Date() : current.verified_at;
    const finalReferred = referredBy ? referredBy.trim() : current.referred_by;

    await pool.query(
      `UPDATE lucky_draw_coupons SET
        coupon_number = ?,
        customer_name = ?,
        date_of_birth = ?,
        phone_number = ?,
        address = ?,
        referred_by = ?,
        staff_name = ?,
        staff_id = ?,
        payment_trans_id = ?,
        payment_mode = ?,
        payment_screenshot_name = ?,
        payment_screenshot_url = ?,
        status = ?,
        verified_at = ?
       WHERE id = ?`,
      [
        finalCouponNo,
        customerName ?? current.customer_name,
        dateOfBirth ?? current.date_of_birth,
        phoneNumber ?? current.phone_number,
        address ?? current.address,
        finalReferred,
        staffName ?? current.staff_name,
        staffId ?? current.staff_id,
        paymentTransId ?? current.payment_trans_id,
        paymentMode ?? current.payment_mode,
        paymentScreenshotName ?? current.payment_screenshot_name,
        paymentScreenshotUrl ?? current.payment_screenshot_url,
        newStatus,
        verifiedAt,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Lucky draw coupon updated and officially verified.',
      coupon: {
        id,
        couponNumber: finalCouponNo,
        status: newStatus,
        verifiedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 6. Staff: Reject invalid/scammed coupon and release the slot number back to the pool
 */
async function staffRejectCoupon(req, res, next) {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;
    const staffUser = req.staff;

    const staffName = staffUser ? (staffUser.fullName || staffUser.name || 'Staff') : 'Staff Member';
    const staffId = staffUser ? (staffUser.employeeId || staffUser.id || '') : '';
    const reason = (rejectionReason && rejectionReason.trim().length > 0)
      ? rejectionReason.trim()
      : 'Invalid / Unverified Payment';

    const [rows] = await pool.query(
      'SELECT id, coupon_number, customer_name, phone_number, status FROM lucky_draw_coupons WHERE id = ? OR coupon_number = ? LIMIT 1',
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon entry not found.',
      });
    }

    const current = rows[0];
    if (current.status === 'VERIFIED_AND_PAID') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reject an already verified and paid coupon ticket.',
      });
    }

    const couponNumber = sanitizeCouponNumber(current.coupon_number);
    const now = new Date();

    try {
      await pool.query(
        `UPDATE lucky_draw_coupons 
         SET status = 'REJECTED',
             coupon_number = ?,
             rejection_reason = ?,
             rejected_by_staff = ?,
             rejected_at = ?
         WHERE id = ?`,
        [
          couponNumber,
          reason,
          `${staffName} (${staffId})`,
          now,
          current.id,
        ]
      );
    } catch (_) {
      // Fallback if rejection columns are not yet in DB
      await pool.query(
        `UPDATE lucky_draw_coupons 
         SET status = 'REJECTED',
             coupon_number = ?
         WHERE id = ?`,
        [couponNumber, current.id]
      );
    }

    console.log(`🚫 [Coupon Rejected] ${couponNumber} rejected by ${staffName} (Reason: ${reason}).`);

    return res.status(200).json({
      success: true,
      message: `Coupon ${couponNumber} rejected successfully.`,
      couponNumber: couponNumber,
      status: 'REJECTED',
      rejectionReason: reason,
      rejectedBy: `${staffName} (${staffId})`,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. Staff Direct Entry (For walk-in customers registered directly by staff)
 */
async function staffDirectEntry(req, res, next) {
  try {
    const {
      customerName,
      dateOfBirth,
      phoneNumber,
      address,
      referredBy,
      customCouponNumber,
      staffName,
      staffId,
      paymentTransId,
      paymentMode,
      paymentScreenshotName,
      paymentScreenshotUrl,
      markAsVerified = true,
    } = req.body;

    if (!customerName || !phoneNumber || !dateOfBirth || !address) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, date of birth, phone number, and address are all mandatory.',
      });
    }

    const hasScreenshot = Boolean((paymentScreenshotName || '').trim() || (paymentScreenshotUrl || '').trim());
    if (!hasScreenshot) {
      return res.status(400).json({
        success: false,
        message: 'Payment receipt / transaction screenshot is mandatory. Please attach a screenshot.',
      });
    }

    const isCashPayment = (paymentMode || '').trim().toLowerCase().includes('cash');
    const cleanTransId = (paymentTransId || '').trim();

    if (!isCashPayment && !cleanTransId) {
      return res.status(400).json({
        success: false,
        message: 'Payment Transaction ID / UPI Reference is mandatory for online payments.',
      });
    }

    // Verify Payment Transaction ID uniqueness across coupons (Transaction ID cannot repeat)
    if (cleanTransId && cleanTransId !== 'UPI_RECEIPT_ATTACHED' && cleanTransId !== 'CASH_PAYMENT' && cleanTransId !== 'DIRECT_CASH') {
      const [existingTrans] = await pool.query(
        'SELECT coupon_number, customer_name FROM lucky_draw_coupons WHERE payment_trans_id = ? LIMIT 1',
        [cleanTransId]
      );
      if (existingTrans.length > 0) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_TRANSACTION_ID',
          message: `Payment Transaction ID '${cleanTransId}' has already been registered for coupon ${existingTrans[0].coupon_number}. Transaction ID cannot be repeated.`,
        });
      }
    }

    const activeEventId = await getActiveEventId();
    const qty = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    const freeCount = Math.floor(qty / 10);
    const totalCount = parseInt(req.body.totalTickets, 10) || (qty + freeCount);

    const couponNumbers = totalCount > 1
      ? await generateNextCouponNumbers(totalCount, activeEventId)
      : [await generateNextCouponNumber(customCouponNumber, activeEventId)];

    const entryFee = 500.00;
    const status = markAsVerified ? 'VERIFIED_AND_PAID' : 'PENDING_STAFF_VERIFICATION';
    const verifiedAt = markAsVerified ? new Date() : null;
    const cleanScreenshotName = (paymentScreenshotName || '').trim() || null;
    const cleanScreenshotUrl = (paymentScreenshotUrl || '').trim() || null;

    const createdCoupons = [];
    const nowTs = Date.now();

    for (let i = 0; i < couponNumbers.length; i++) {
      const cNum = couponNumbers[i];
      const couponId = `ld-${nowTs}-${i}-${Math.random().toString(36).substring(2, 6)}`;
      const isBonus = i >= qty;

      try {
        await pool.query(
          `INSERT INTO lucky_draw_coupons 
            (id, event_id, coupon_number, customer_name, date_of_birth, phone_number, address, referred_by, entry_fee, status, staff_name, staff_id, payment_trans_id, payment_mode, payment_screenshot_name, payment_screenshot_url, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            couponId,
            activeEventId,
            cNum,
            customerName.trim(),
            dateOfBirth || '1990-01-01',
            phoneNumber.trim(),
            address.trim(),
            referredBy ? referredBy.trim() : null,
            isBonus ? 0.00 : entryFee,
            status,
            staffName || 'Authorized Staff',
            staffId || 'LP-EMP',
            paymentTransId || 'DIRECT_CASH',
            paymentMode || 'Direct Cash',
            cleanScreenshotName,
            cleanScreenshotUrl,
            verifiedAt,
          ]
        );
      } catch (_) {
        // Fallback for legacy DB without event_id
        await pool.query(
          `INSERT INTO lucky_draw_coupons 
            (id, coupon_number, customer_name, date_of_birth, phone_number, address, referred_by, entry_fee, status, staff_name, staff_id, payment_trans_id, payment_mode, payment_screenshot_name, payment_screenshot_url, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            couponId,
            cNum,
            customerName.trim(),
            dateOfBirth || '1990-01-01',
            phoneNumber.trim(),
            address.trim(),
            referredBy ? referredBy.trim() : null,
            isBonus ? 0.00 : entryFee,
            status,
            staffName || 'Authorized Staff',
            staffId || 'LP-EMP',
            paymentTransId || 'DIRECT_CASH',
            paymentMode || 'Direct Cash',
            cleanScreenshotName,
            cleanScreenshotUrl,
            verifiedAt,
          ]
        );
      }

      createdCoupons.push({
        id: couponId,
        eventId: activeEventId,
        couponNumber: cNum,
        customerName: customerName.trim(),
        phoneNumber: phoneNumber.trim(),
        address: address.trim(),
        status,
        entryFee: isBonus ? 0 : entryFee,
        isBonus,
        paymentScreenshotUrl: cleanScreenshotUrl,
        paymentScreenshotName: cleanScreenshotName,
        verifiedAt,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Walk-in customer entry created successfully (${couponNumbers.length} coupon${couponNumbers.length > 1 ? 's' : ''}).`,
      coupon: createdCoupons[0],
      coupons: createdCoupons,
      totalTickets: createdCoupons.length,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 8. Get Coupons belonging to a specific customer (by phone or customer auth)
 */
async function getCustomerCoupons(req, res, next) {
  try {
    const { phone } = req.query;
    if (!phone) {
      return res.status(200).json({ success: true, coupons: [] });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(200).json({ success: true, coupons: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM lucky_draw_coupons 
       WHERE (REPLACE(REPLACE(phone_number, '+91', ''), ' ', '') LIKE ? 
          OR (applicant_phone IS NOT NULL AND REPLACE(REPLACE(applicant_phone, '+91', ''), ' ', '') LIKE ?))`,
      [`%${cleanPhone}%`, `%${cleanPhone}%`]
    );
    const total = countRows[0].total || 0;

    const [rows] = await pool.query(
      `SELECT * FROM lucky_draw_coupons 
       WHERE (REPLACE(REPLACE(phone_number, '+91', ''), ' ', '') LIKE ? 
          OR (applicant_phone IS NOT NULL AND REPLACE(REPLACE(applicant_phone, '+91', ''), ' ', '') LIKE ?))
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [`%${cleanPhone}%`, `%${cleanPhone}%`, limit, offset]
    );

    const coupons = rows.map(c => ({
      id: c.id,
      eventId: c.event_id || 1,
      couponNumber: sanitizeCouponNumber(c.coupon_number),
      customerName: c.customer_name,
      dateOfBirth: c.date_of_birth,
      phoneNumber: c.phone_number,
      address: c.address,
      referredBy: c.referred_by || null,
      entryFee: parseFloat(c.entry_fee),
      status: c.status,
      rejectionReason: c.rejection_reason || null,
      rejectedByStaff: c.rejected_by_staff || null,
      rejectedAt: c.rejected_at || null,
      staffName: c.staff_name,
      staffId: c.staff_id,
      paymentTransId: c.payment_trans_id,
      paymentMode: c.payment_mode,
      paymentScreenshotName: c.payment_screenshot_name,
      paymentScreenshotUrl: c.payment_screenshot_url,
      verifiedAt: c.verified_at,
      createdAt: c.created_at,
    }));

    return res.status(200).json({
      success: true,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      coupons,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Helper: Ensures lucky_draw_events and all related tables/columns exist dynamically
 */
async function ensureLuckyDrawEventsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lucky_draw_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_code VARCHAR(50) NOT NULL UNIQUE,
        event_title VARCHAR(150) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        bumper_prize VARCHAR(255) NOT NULL DEFAULT 'If you win you get a land, otherwise ₹500 worth gift',
        assured_gift VARCHAR(255) NOT NULL DEFAULT 'Guaranteed ₹500 Worth Gift Kit / Voucher',
        entry_fee DECIMAL(10,2) NOT NULL DEFAULT 500.00,
        status ENUM('ACTIVE', 'CONCLUDED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
        winner_coupon VARCHAR(50) NULL,
        receipts_purged TINYINT(1) NOT NULL DEFAULT 0,
        purged_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [allEvents] = await pool.query('SELECT COUNT(*) as cnt FROM lucky_draw_events');
    if (allEvents[0].cnt === 0) {
      await pool.query(`
        INSERT INTO lucky_draw_events (id, event_code, event_title, start_date, bumper_prize, status)
        VALUES (1, 'SEASON-01', 'Mega Land Lucky Draw - Season 1', '2026-01-01', 'If you win you get a land, otherwise ₹500 worth gift', 'ACTIVE')
        ON DUPLICATE KEY UPDATE status = 'ACTIVE'
      `);
    }

    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_coupon VARCHAR(50) NULL AFTER status");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN event_date_time VARCHAR(100) NULL AFTER end_date");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN event_venue VARCHAR(255) NULL AFTER event_date_time");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_draw_time VARCHAR(50) NULL AFTER event_venue");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_plot_details VARCHAR(255) NULL AFTER winner_draw_time");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_name VARCHAR(150) NULL AFTER winner_coupon");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_phone VARCHAR(50) NULL AFTER winner_name");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_address TEXT NULL AFTER winner_phone");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN winner_aadhar_pan VARCHAR(100) NULL AFTER winner_address");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN receipts_purged TINYINT(1) NOT NULL DEFAULT 0");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_events ADD COLUMN purged_at DATETIME NULL");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_coupons ADD COLUMN event_id INT NOT NULL DEFAULT 1 AFTER id");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_coupons ADD COLUMN rejection_reason VARCHAR(255) NULL AFTER status");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_coupons ADD COLUMN rejected_by_staff VARCHAR(150) NULL AFTER rejection_reason");
    } catch (_) {}
    try {
      await pool.query("ALTER TABLE lucky_draw_coupons ADD COLUMN rejected_at DATETIME NULL AFTER rejected_by_staff");
    } catch (_) {}
  } catch (err) {
    console.warn('⚠️ [ensureLuckyDrawEventsTable] DB init notice:', err.message);
  }
}

/**
 * 9. Get Currently Active Lucky Draw Event / Season
 */
async function getActiveEvent(req, res, next) {
  try {
    await ensureLuckyDrawEventsTable();
    let event = null;
    try {
      const [rows] = await pool.query(
        "SELECT * FROM lucky_draw_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1"
      );
      if (rows && rows.length > 0) {
        event = rows[0];
      }
    } catch (_) {}

    if (!event) {
      let lastEvent = null;
      try {
        const [lastRows] = await pool.query(
          "SELECT * FROM lucky_draw_events ORDER BY id DESC LIMIT 1"
        );
        if (lastRows && lastRows.length > 0) {
          lastEvent = lastRows[0];
        }
      } catch (_) {}

      return res.status(200).json({
        success: true,
        active: false,
        event: null,
        lastEvent: lastEvent ? {
          id: lastEvent.id,
          eventCode: lastEvent.event_code,
          eventTitle: lastEvent.event_title,
          status: lastEvent.status,
          bumperPrize: lastEvent.bumper_prize,
          winnerCoupon: lastEvent.winner_coupon,
        } : null,
        message: 'The Lucky Draw season has concluded. Next season will start soon!',
      });
    }

    let totalEntries = 0;
    let verifiedEntries = 0;
    try {
      const countFilter = Number(event.id) === 1 ? '(event_id = ? OR event_id IS NULL)' : 'event_id = ?';
      const [countRows] = await pool.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status = "VERIFIED_AND_PAID" THEN 1 ELSE 0 END) as verified FROM lucky_draw_coupons WHERE ${countFilter}`,
        [event.id]
      );
      totalEntries = countRows[0].total || 0;
      verifiedEntries = countRows[0].verified || 0;
    } catch (_) {}

    return res.status(200).json({
      success: true,
      active: true,
      event: {
        id: event.id,
        eventCode: event.event_code,
        eventTitle: event.event_title,
        startDate: event.start_date,
        endDate: event.end_date,
        bumperPrize: event.bumper_prize,
        assuredGift: event.assured_gift,
        entryFee: parseFloat(event.entry_fee || 500),
        status: event.status,
        totalEntries,
        verifiedEntries,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 10. Start a New Lucky Draw Season (Admin/Manager: Resets numbering from LENA-LD-0001!)
 */
async function startNewEvent(req, res, next) {
  try {
    const { eventTitle, bumperPrize, assuredGift, entryFee } = req.body || {};
    const staff = req.staff;

    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'COUPON_HEAD', 'HEAD_MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin or Coupon Head can start a new Lucky Draw season.',
      });
    }

    // Ensure lucky_draw_events table exists
    await ensureLuckyDrawEventsTable();

    // 1. Mark existing active events as CONCLUDED
    await pool.query(
      "UPDATE lucky_draw_events SET status = 'CONCLUDED', end_date = CURDATE() WHERE status = 'ACTIVE'"
    );

    // 2. Determine new season count
    const [allEvents] = await pool.query('SELECT COUNT(*) as cnt FROM lucky_draw_events');
    const nextSeasonNum = (allEvents[0].cnt || 0) + 1;
    const eventCode = `SEASON-${String(nextSeasonNum).padStart(2, '0')}`;
    const title = (eventTitle && eventTitle.trim().length > 0)
      ? eventTitle.trim()
      : `Mega Land Lucky Draw - Season ${nextSeasonNum}`;

    const [insertRes] = await pool.query(
      `INSERT INTO lucky_draw_events 
        (event_code, event_title, start_date, bumper_prize, assured_gift, entry_fee, status)
       VALUES (?, ?, CURDATE(), ?, ?, ?, 'ACTIVE')`,
      [
        eventCode,
        title,
        bumperPrize || 'If you win you get a land, otherwise ₹500 worth gift',
        assuredGift || 'Guaranteed ₹500 Worth Gift Kit / Voucher',
        entryFee ? parseFloat(entryFee) : 500.00,
      ]
    );

    console.log(`🎉 [New Season Started] Event ID: ${insertRes.insertId}, Code: ${eventCode}. Numbering sequence will start from LENA-LD-0001!`);

    return res.status(201).json({
      success: true,
      message: `Season ${nextSeasonNum} started successfully! Coupon numbers will now start from LENA-LD-0001.`,
      event: {
        id: insertRes.insertId,
        eventCode,
        eventTitle: title,
        startDate: new Date().toISOString(),
        status: 'ACTIVE',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 11. End Season and Optionally Purge Unwanted Receipts to Free Disk Space
 */
async function endEvent(req, res, next) {
  try {
    const { id } = req.params;
    const {
      purgeReceipts,
      winnerCoupon,
      eventDateTime,
      eventVenue,
      winnerDrawTime,
      winnerPlotDetails,
      winnerName,
      winnerPhone,
      winnerAddress,
      winnerAadharPan,
    } = req.body || {};
    const staff = req.staff;

    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'COUPON_HEAD', 'HEAD_MANAGER'];
    if (staff && !allowedRoles.includes((staff.role || '').toUpperCase())) {
      return res.status(403).json({
        success: false,
        message: 'Only Admin or Coupon Head can end a Lucky Draw season.',
      });
    }

    await ensureLuckyDrawEventsTable();

    // Verify winner coupon is valid and VERIFIED
    if (winnerCoupon && winnerCoupon.trim()) {
      const cleanWinnerCoupon = winnerCoupon.trim().toUpperCase();
      const [cRows] = await pool.query(
        'SELECT id, coupon_number, status, event_id FROM lucky_draw_coupons WHERE coupon_number = ? LIMIT 1',
        [cleanWinnerCoupon]
      );
      if (cRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Winning coupon '${cleanWinnerCoupon}' was not found. Please enter a valid coupon number.`,
        });
      }
      const isVerified = (cRows[0].status === 'VERIFIED_AND_PAID' || cRows[0].status === 'VERIFIED');
      if (!isVerified) {
        return res.status(400).json({
          success: false,
          message: `Winning coupon '${cleanWinnerCoupon}' is currently '${cRows[0].status === 'PENDING_STAFF_VERIFICATION' ? 'UNDER VERIFICATION' : cRows[0].status}'. Only a VERIFIED coupon can be declared as the winner.`,
        });
      }
    }

    const [updateRes] = await pool.query(
      `UPDATE lucky_draw_events 
       SET status = 'CONCLUDED', 
           end_date = CURDATE(), 
           event_date_time = ?,
           event_venue = ?,
           winner_draw_time = ?,
           winner_plot_details = ?,
           winner_coupon = ?,
           winner_name = ?,
           winner_phone = ?,
           winner_address = ?,
           winner_aadhar_pan = ?
       WHERE id = ?`,
      [
        eventDateTime || null,
        eventVenue || null,
        winnerDrawTime || null,
        winnerPlotDetails || null,
        winnerCoupon || null,
        winnerName || null,
        winnerPhone || null,
        winnerAddress || null,
        winnerAadharPan || null,
        id,
      ]
    );

    if (updateRes.affectedRows === 0) {
      await pool.query(
        `UPDATE lucky_draw_events 
         SET status = 'CONCLUDED', 
             end_date = CURDATE(), 
             event_date_time = ?,
             event_venue = ?,
             winner_draw_time = ?,
             winner_plot_details = ?,
             winner_coupon = ?,
             winner_name = ?,
             winner_phone = ?,
             winner_address = ?,
             winner_aadhar_pan = ?
         WHERE status = 'ACTIVE'`,
        [
          eventDateTime || null,
          eventVenue || null,
          winnerDrawTime || null,
          winnerPlotDetails || null,
          winnerCoupon || null,
          winnerName || null,
          winnerPhone || null,
          winnerAddress || null,
          winnerAadharPan || null,
        ]
      );
    }

    // If winner coupon was provided, mark it as WINNER_ANNOUNCED
    if (winnerCoupon) {
      try {
        await pool.query(
          "UPDATE lucky_draw_coupons SET status = 'WINNER_ANNOUNCED' WHERE coupon_number = ?",
          [winnerCoupon.trim()]
        );
      } catch (_) {}
    }

    let purgedCount = 0;
    if (purgeReceipts === true || purgeReceipts === 'true') {
      const [receipts] = await pool.query(
        'SELECT payment_screenshot_name FROM lucky_draw_coupons WHERE event_id = ? AND payment_screenshot_name IS NOT NULL',
        [id]
      );

      const uploadDir = path.join(__dirname, '../../uploads/receipts');
      for (const r of receipts) {
        if (r.payment_screenshot_name) {
          const filePath = path.join(uploadDir, r.payment_screenshot_name);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              purgedCount++;
            }
          } catch (e) {
            console.error(`Could not delete receipt file ${filePath}:`, e.message);
          }
        }
      }

      await pool.query(
        `UPDATE lucky_draw_coupons 
         SET payment_screenshot_url = NULL, 
             payment_screenshot_name = 'ARCHIVED_RECEIPT_PURGED'
         WHERE event_id = ?`,
        [id]
      );

      await pool.query(
        'UPDATE lucky_draw_events SET receipts_purged = 1, purged_at = NOW() WHERE id = ?',
        [id]
      );
    }

    return res.status(200).json({
      success: true,
      message: `Event concluded successfully.${purgeReceipts ? ` Purged ${purgedCount} transaction receipt files from storage.` : ''}`,
      purgedCount,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 12. Purge Receipts on Demand
 */
async function purgeEventReceipts(req, res, next) {
  try {
    const { id } = req.params;
    const staff = req.staff;

    if (staff && staff.role !== 'ADMIN' && staff.role !== 'MANAGER') {
      return res.status(403).json({
        success: false,
        message: 'Only Admin or Manager can purge receipt storage.',
      });
    }

    const [receipts] = await pool.query(
      "SELECT payment_screenshot_name FROM lucky_draw_coupons WHERE event_id = ? AND payment_screenshot_name IS NOT NULL AND payment_screenshot_name != 'ARCHIVED_RECEIPT_PURGED'",
      [id]
    );

    const uploadDir = path.join(__dirname, '../../uploads/receipts');
    let purgedCount = 0;

    for (const r of receipts) {
      if (r.payment_screenshot_name) {
        const filePath = path.join(uploadDir, r.payment_screenshot_name);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            purgedCount++;
          }
        } catch (e) {
          console.error(`Could not delete file ${filePath}:`, e.message);
        }
      }
    }

    await pool.query(
      `UPDATE lucky_draw_coupons 
       SET payment_screenshot_url = NULL, 
           payment_screenshot_name = 'ARCHIVED_RECEIPT_PURGED'
       WHERE event_id = ?`,
      [id]
    );

    await pool.query(
      'UPDATE lucky_draw_events SET receipts_purged = 1, purged_at = NOW() WHERE id = ?',
      [id]
    );

    return res.status(200).json({
      success: true,
      message: `Successfully purged ${purgedCount} receipt images from disk to free storage space.`,
      purgedCount,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 13. List all events / seasons
 */
async function listEvents(req, res, next) {
  try {
    await ensureLuckyDrawEventsTable();
    let rows = [];
    try {
      const [dbRows] = await pool.query('SELECT * FROM lucky_draw_events ORDER BY id DESC');
      rows = dbRows;
    } catch (_) {}

    return res.status(200).json({
      success: true,
      events: rows.map(r => ({
        id: r.id,
        eventCode: r.event_code,
        eventTitle: r.event_title,
        startDate: r.start_date,
        endDate: r.end_date,
        bumperPrize: r.bumper_prize,
        status: r.status,
        winnerCoupon: r.winner_coupon,
        winnerName: r.winner_name,
        winnerPhone: r.winner_phone,
        winnerAddress: r.winner_address,
        winnerAadharPan: r.winner_aadhar_pan,
        winnerPlotDetails: r.winner_plot_details,
        eventDateTime: r.event_date_time,
        eventVenue: r.event_venue,
        winnerDrawTime: r.winner_draw_time,
        receiptsPurged: Boolean(r.receipts_purged),
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 14. Comprehensive Coupon Reports (For Coupon Head & Admin)
 * Returns metrics, staff-wise breakdown, branch breakdown, and season/month performance
 */
async function getCouponReports(req, res, next) {
  try {
    await ensureLuckyDrawEventsTable();
    const { eventId } = req.query;

    let targetEventId = null;
    let filterApplied = false;

    if (eventId && eventId !== 'ALL') {
      filterApplied = true;
      if (eventId === 'ACTIVE') {
        try {
          const [activeRows] = await pool.query(
            "SELECT id FROM lucky_draw_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1"
          );
          if (activeRows && activeRows.length > 0) {
            targetEventId = activeRows[0].id;
          } else {
            // Fallback: If no season is currently ACTIVE, resolve to the most recent season
            const [lastRows] = await pool.query(
              "SELECT id FROM lucky_draw_events ORDER BY id DESC LIMIT 1"
            );
            if (lastRows && lastRows.length > 0) {
              targetEventId = lastRows[0].id;
            }
          }
        } catch (_) {}
      } else {
        const parsed = parseInt(eventId, 10);
        if (!isNaN(parsed)) {
          targetEventId = parsed;
        }
      }
    }

    let eventFilter = '';
    const params = [];
    if (filterApplied && targetEventId !== null) {
      if (Number(targetEventId) === 1) {
        eventFilter = ' WHERE (c.event_id = ? OR c.event_id IS NULL)';
      } else {
        eventFilter = ' WHERE c.event_id = ?';
      }
      params.push(targetEventId);
    } else if (filterApplied && targetEventId === null) {
      eventFilter = ' WHERE 1 = 0';
    }

    // 1. Overall Totals
    const [summaryRows] = await pool.query(`
      SELECT 
        COUNT(*) as totalEntries,
        SUM(CASE WHEN c.status = 'PENDING_STAFF_VERIFICATION' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN c.status = 'VERIFIED_AND_PAID' THEN 1 ELSE 0 END) as verifiedCount,
        SUM(CASE WHEN c.status = 'REJECTED' THEN 1 ELSE 0 END) as rejectedCount,
        SUM(CASE WHEN c.status = 'VERIFIED_AND_PAID' THEN c.entry_fee ELSE 0 END) as totalCollected
      FROM lucky_draw_coupons c
      ${eventFilter}
    `, params);

    const summary = {
      totalEntries: parseInt(summaryRows[0]?.totalEntries || 0, 10),
      pendingCount: parseInt(summaryRows[0]?.pendingCount || 0, 10),
      verifiedCount: parseInt(summaryRows[0]?.verifiedCount || 0, 10),
      rejectedCount: parseInt(summaryRows[0]?.rejectedCount || 0, 10),
      totalCollected: parseFloat(summaryRows[0]?.totalCollected || 0),
    };

    // 2. Staff-wise Breakdown
    const [staffBreakdown] = await pool.query(`
      SELECT 
        COALESCE(c.staff_name, 'Direct / Online') as staffName,
        COALESCE(c.staff_id, 'ONLINE') as staffId,
        COALESCE(s.branch_location, 'Head Office / Direct') as branch,
        COUNT(*) as totalEntered,
        SUM(CASE WHEN c.status = 'VERIFIED_AND_PAID' THEN 1 ELSE 0 END) as verifiedCount,
        SUM(CASE WHEN c.status = 'PENDING_STAFF_VERIFICATION' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN c.status = 'REJECTED' THEN 1 ELSE 0 END) as rejectedCount,
        SUM(CASE WHEN c.status = 'VERIFIED_AND_PAID' THEN c.entry_fee ELSE 0 END) as collectedAmount
      FROM lucky_draw_coupons c
      LEFT JOIN staff_users s ON (c.staff_id = s.employee_id OR c.staff_name = s.full_name)
      ${eventFilter}
      GROUP BY c.staff_name, c.staff_id, s.branch_location
      ORDER BY totalEntered DESC
    `, params);

    // 3. Branch-wise Breakdown
    const [branchBreakdown] = await pool.query(`
      SELECT 
        COALESCE(s.branch_location, 'Head Office / Direct') as branch,
        COUNT(*) as totalCoupons,
        SUM(CASE WHEN c.status = 'VERIFIED_AND_PAID' THEN 1 ELSE 0 END) as verifiedCoupons,
        SUM(CASE WHEN c.status = 'VERIFIED_AND_PAID' THEN c.entry_fee ELSE 0 END) as collectedAmount
      FROM lucky_draw_coupons c
      LEFT JOIN staff_users s ON (c.staff_id = s.employee_id OR c.staff_name = s.full_name)
      ${eventFilter}
      GROUP BY s.branch_location
      ORDER BY totalCoupons DESC
    `, params);

    // 4. Seasons / Months List
    let seasons = [];
    try {
      const [allSeasons] = await pool.query('SELECT * FROM lucky_draw_events ORDER BY id DESC');
      seasons = allSeasons;
    } catch (_) {}

    return res.status(200).json({
      success: true,
      summary,
      staffBreakdown,
      branchBreakdown,
      seasons: seasons.map(s => ({
        id: s.id,
        eventCode: s.event_code,
        eventTitle: s.event_title,
        startDate: s.start_date,
        endDate: s.end_date,
        bumperPrize: s.bumper_prize,
        status: s.status,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 15. Get valid active staff from database for coupon referral and filters
 */
async function getCouponStaffList(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id,
        employee_id AS staffId,
        full_name AS staffName,
        branch_location AS branch,
        role
      FROM staff_users
      WHERE is_active = 1
      ORDER BY full_name ASC
    `);
    return res.status(200).json({
      success: true,
      staff: rows.map(r => ({
        id: r.id,
        staffId: r.staffId,
        staffName: r.staffName,
        fullName: r.staffName,
        name: r.staffName,
        branch: r.branch,
        role: r.role,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getActiveScheme,
  customerApply,
  getStaffEntries,
  getCouponById,
  staffEditAndVerify,
  staffRejectCoupon,
  staffDirectEntry,
  getCustomerCoupons,
  getActiveEvent,
  startNewEvent,
  endEvent,
  purgeEventReceipts,
  listEvents,
  getCouponReports,
  getCouponStaffList,
};
