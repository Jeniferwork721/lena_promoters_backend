const { pool } = require('../config/db');
const { generateNextCouponNumber, generateNextCouponNumbers } = require('../utils/couponGenerator');

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
    // Check if customer already exists by unique phone number
    const [existing] = await connOrPool.query(
      'SELECT id, full_name, email, address, referred_by, date_of_birth FROM customers WHERE phone_number = ? LIMIT 1',
      [cleanPhone]
    );

    if (existing.length > 0) {
      const current = existing[0];
      // USER RULE: If customer already exists, DO NOT overwrite their profile in user table from coupon application!
      // Customer profile is only modified from the Settings / Profile Edit screen.
      console.log(`👤 [Customer Sync] Existing customer found (ID: ${current.id}, Phone: ${cleanPhone}). Preserving original profile; coupon linked.`);
      return current.id;
    } else {
      const [insertRes] = await connOrPool.query(
        `INSERT INTO customers (full_name, phone_number, email, address, referred_by, date_of_birth, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [cleanName, cleanPhone, cleanEmail, cleanAddress, cleanReferredBy, cleanDob]
      );
      console.log(`👤 [Customer Sync] Registered new customer profile from first coupon (ID: ${insertRes.insertId}, Phone: ${cleanPhone}).`);
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
      customCouponNumber,
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

    // Referral: If not referred by specific staff, register under official Company Profile
    const finalReferredBy = (referredBy && referredBy.trim().length > 0)
      ? referredBy.trim()
      : 'Lena Promoters (Company Direct)';

    // Payment screenshot is strictly mandatory for verification
    const hasScreenshot = Boolean(paymentScreenshotName || paymentScreenshotUrl);
    if (!hasScreenshot) {
      return res.status(400).json({
        success: false,
        message: 'Payment screenshot receipt is mandatory. Please upload payment receipt screenshot.',
      });
    }
    const cleanTransId = (paymentTransId || '').trim();
    const finalTransId = cleanTransId || 'UPI_RECEIPT_ATTACHED';

    // Parse requested coupon quantity (Offer: Buy 10 coupons -> 1 FREE coupon)
    const quantity = Math.max(1, parseInt(req.body.quantity, 10) || 1);
    const freeCount = Math.floor(quantity / 10);
    const totalCount = quantity + freeCount;
    const totalAmount = quantity * 500;

    // Auto-generate next sequential coupon numbers continuously in batch
    const couponNumbers = await generateNextCouponNumbers(totalCount);
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
      const isBonus = i >= quantity; // coupons beyond the paid count are free promotional tickets

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

      createdCoupons.push({
        id: couponId,
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

    console.log(`🎟️ [Batch Coupons Issued] ${totalCount} coupon(s) (${quantity} paid + ${freeCount} free bonus) registered for ${customerName.trim()} (Phone: ${phoneNumber.trim()}). Tokens: ${couponNumbers.join(', ')}`);

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
    const { status, search, staffId, staffName, sortBy, sortOrder } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // 1. Calculate overall metrics for Dashboard & Report
    const [metricsRows] = await pool.query(`
      SELECT 
        COUNT(*) as totalEntries,
        SUM(CASE WHEN status = 'PENDING_STAFF_VERIFICATION' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN status = 'VERIFIED_AND_PAID' THEN 1 ELSE 0 END) as verifiedCount,
        SUM(CASE WHEN status = 'VERIFIED_AND_PAID' THEN entry_fee ELSE 0 END) as totalCollected
      FROM lucky_draw_coupons
    `);

    const metrics = {
      totalEntries: parseInt(metricsRows[0].totalEntries, 10) || 0,
      pendingCount: parseInt(metricsRows[0].pendingCount, 10) || 0,
      verifiedCount: parseInt(metricsRows[0].verifiedCount, 10) || 0,
      totalCollected: parseFloat(metricsRows[0].totalCollected || 0),
    };

    // 2. Build Filter Where Clause
    let whereClause = ' WHERE 1=1';
    const params = [];

    if (status && status !== 'ALL') {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search && search.trim().length > 0) {
      whereClause += ' AND (coupon_number LIKE ? OR customer_name LIKE ? OR phone_number LIKE ? OR staff_name LIKE ? OR referred_by LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    if (staffId && staffId.trim().length > 0 && staffId !== 'ALL') {
      whereClause += ' AND staff_id = ?';
      params.push(staffId.trim());
    }

    if (staffName && staffName.trim().length > 0 && staffName !== 'ALL') {
      whereClause += ' AND staff_name LIKE ?';
      params.push(`%${staffName.trim()}%`);
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

    // 6. Distinct staff list for staff-based filter dropdown in frontend
    const [staffListRows] = await pool.query(`
      SELECT DISTINCT staff_name AS staffName, staff_id AS staffId
      FROM lucky_draw_coupons
      WHERE staff_name IS NOT NULL AND staff_name != ''
      ORDER BY staff_name ASC
    `);

    const entries = rows.map(c => ({
      id: c.id,
      couponNumber: c.coupon_number,
      customerName: c.customer_name,
      dateOfBirth: c.date_of_birth,
      phoneNumber: c.phone_number,
      address: c.address,
      referredBy: c.referred_by || null,
      entryFee: parseFloat(c.entry_fee),
      status: c.status,
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
    return res.status(200).json({
      success: true,
      coupon: {
        id: c.id,
        couponNumber: c.coupon_number,
        customerName: c.customer_name,
        dateOfBirth: c.date_of_birth,
        phoneNumber: c.phone_number,
        address: c.address,
        referredBy: c.referred_by || null,
        entryFee: parseFloat(c.entry_fee),
        status: c.status,
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

    const [existing] = await pool.query('SELECT * FROM lucky_draw_coupons WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    const current = existing[0];

    // If changing coupon number, ensure uniqueness
    let finalCouponNo = current.coupon_number;
    if (couponNumber && couponNumber.trim().toUpperCase() !== current.coupon_number) {
      const formatted = couponNumber.trim().toUpperCase();
      const [duplicate] = await pool.query(
        'SELECT id FROM lucky_draw_coupons WHERE coupon_number = ? AND id != ?',
        [formatted, id]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Coupon number ${formatted} is already assigned to another entry.`,
        });
      }
      finalCouponNo = formatted;
    }

    const newStatus = markAsVerified ? 'VERIFIED_AND_PAID' : current.status;
    const verifiedAt = markAsVerified ? new Date() : current.verified_at;

    const finalReferred = referredBy !== undefined
      ? (referredBy && referredBy.trim().length > 0 ? referredBy.trim() : 'Lena Promoters (Company Direct)')
      : current.referred_by;

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

    // Note: Verification updates only the coupon record; user profiles remain managed by users.

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
 * 6. Staff Direct Entry (For walk-in customers registered directly by staff)
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

    if (!customerName || !phoneNumber || !address) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone number, and address are required.',
      });
    }

    const couponNumber = await generateNextCouponNumber(customCouponNumber);
    const id = `ld-${Date.now()}`;
    const entryFee = 500.00;
    const status = markAsVerified ? 'VERIFIED_AND_PAID' : 'PENDING_STAFF_VERIFICATION';
    const verifiedAt = markAsVerified ? new Date() : null;

    await pool.query(
      `INSERT INTO lucky_draw_coupons 
        (id, coupon_number, customer_name, date_of_birth, phone_number, address, referred_by, entry_fee, status, staff_name, staff_id, payment_trans_id, payment_mode, payment_screenshot_name, payment_screenshot_url, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        couponNumber,
        customerName.trim(),
        dateOfBirth || '1990-01-01',
        phoneNumber.trim(),
        address.trim(),
        referredBy ? referredBy.trim() : null,
        entryFee,
        status,
        staffName || 'Authorized Staff',
        staffId || 'LP-EMP',
        paymentTransId || 'DIRECT_CASH',
        paymentMode || 'Direct Cash',
        paymentScreenshotName || null,
        paymentScreenshotUrl || null,
        verifiedAt,
      ]
    );

    // Note: Walk-in entry creates the lucky draw coupon record only. Customer can create their account separately.

    return res.status(201).json({
      success: true,
      message: 'Walk-in customer entry created successfully.',
      coupon: {
        id,
        couponNumber,
        customerName,
        status,
        entryFee,
        verifiedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 7. Get Coupons belonging to a specific customer (by phone or customer auth)
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
       WHERE REPLACE(REPLACE(phone_number, '+91', ''), ' ', '') LIKE ? 
          OR (applicant_phone IS NOT NULL AND REPLACE(REPLACE(applicant_phone, '+91', ''), ' ', '') LIKE ?)`,
      [`%${cleanPhone}%`, `%${cleanPhone}%`]
    );
    const total = countRows[0].total || 0;

    const [rows] = await pool.query(
      `SELECT * FROM lucky_draw_coupons 
       WHERE REPLACE(REPLACE(phone_number, '+91', ''), ' ', '') LIKE ? 
          OR (applicant_phone IS NOT NULL AND REPLACE(REPLACE(applicant_phone, '+91', ''), ' ', '') LIKE ?)
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [`%${cleanPhone}%`, `%${cleanPhone}%`, limit, offset]
    );

    const coupons = rows.map(c => ({
      id: c.id,
      couponNumber: c.coupon_number,
      customerName: c.customer_name,
      dateOfBirth: c.date_of_birth,
      phoneNumber: c.phone_number,
      address: c.address,
      referredBy: c.referred_by || null,
      entryFee: parseFloat(c.entry_fee),
      status: c.status,
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

module.exports = {
  getActiveScheme,
  customerApply,
  getStaffEntries,
  getCouponById,
  staffEditAndVerify,
  staffDirectEntry,
  getCustomerCoupons,
};
