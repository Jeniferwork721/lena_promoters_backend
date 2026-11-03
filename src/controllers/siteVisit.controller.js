const { pool } = require('../config/db');

/**
 * 1. Book Free Site Visit (Customer)
 * Requires customerName, phoneNumber, address, visitDate.
 * Supports optional staff referral name (defaults to 'Direct Company Referral').
 * No fake driver names or dumped placeholder vehicles.
 */
async function bookSiteVisit(req, res, next) {
  try {
    const propertyId = req.body.propertyId || req.body.property_id || null;
    const propertyTitle = req.body.propertyTitle || req.body.property_title || 'Plotted Development';
    const customerName = req.body.customerName || req.body.customer_name || req.body.name;
    const phoneNumber = req.body.phoneNumber || req.body.phone_number || req.body.phone || req.body.contact;
    const address = req.body.address || req.body.pickupAddress || req.body.pickup_address;
    const visitDateRaw = req.body.visitDate || req.body.visit_date || req.body.date;
    const timeSlot = req.body.timeSlot || req.body.time_slot || req.body.slot || 'Morning (10:00 AM - 1:00 PM)';
    const pickupRequired = req.body.pickupRequired !== undefined
      ? (req.body.pickupRequired === true || req.body.pickupRequired === 'true' || req.body.pickupRequired === 1 || req.body.pickupRequired === '1')
      : true;

    // Optional staff referral name, defaults to 'Direct Company Referral'
    const referredByRaw = req.body.referredBy || req.body.referred_by || req.body.staffName || req.body.staff_name;
    const referredBy = (referredByRaw && referredByRaw.trim().length > 0)
      ? referredByRaw.trim()
      : 'Direct Company Referral';

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customer name.',
      });
    }

    if (!phoneNumber || !phoneNumber.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide contact phone number.',
      });
    }

    if (!address || !address.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide customer address for site visit registration.',
      });
    }

    if (!visitDateRaw) {
      return res.status(400).json({
        success: false,
        message: 'Please select a visit date.',
      });
    }

    // Format visitDate to YYYY-MM-DD for MySQL DATE column
    let visitDate = null;
    if (typeof visitDateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(visitDateRaw.trim())) {
      visitDate = visitDateRaw.trim();
    } else {
      const d = new Date(visitDateRaw);
      if (!isNaN(d.getTime())) {
        visitDate = d.toISOString().split('T')[0];
      }
    }

    if (!visitDate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid visit date format. Please provide a valid date (YYYY-MM-DD).',
      });
    }

    const [result] = await pool.query(
      `INSERT INTO site_visits 
        (property_id, property_title, customer_name, phone_number, visit_date, time_slot, pickup_required, pickup_address, referred_by, driver_name, vehicle_no, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'SCHEDULED')`,
      [
        propertyId,
        propertyTitle,
        customerName.trim(),
        phoneNumber.trim(),
        visitDate,
        timeSlot,
        pickupRequired ? 1 : 0,
        address.trim(),
        referredBy,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Site visit booked! Our staff will contact you shortly.',
      siteVisit: {
        id: result.insertId,
        propertyId,
        propertyTitle,
        customerName: customerName.trim(),
        phoneNumber: phoneNumber.trim(),
        address: address.trim(),
        pickupAddress: address.trim(),
        visitDate,
        timeSlot,
        pickupRequired: Boolean(pickupRequired),
        referredBy,
        driverName: null,
        vehicleNo: null,
        status: 'SCHEDULED',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 2. Get All Site Visits (Staff)
 */
async function getAllSiteVisits(req, res, next) {
  try {
    const { status, date } = req.query;

    let query = 'SELECT * FROM site_visits WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (date) {
      query += ' AND visit_date = ?';
      params.push(date);
    }

    query += ' ORDER BY visit_date ASC, created_at DESC';

    const [rows] = await pool.query(query, params);

    const visits = rows.map(v => ({
      id: v.id,
      propertyId: v.property_id,
      propertyTitle: v.property_title,
      customerName: v.customer_name,
      phoneNumber: v.phone_number,
      visitDate: v.visit_date,
      timeSlot: v.time_slot,
      pickupRequired: Boolean(v.pickup_required),
      pickupAddress: v.pickup_address,
      referredBy: v.referred_by || 'Direct Company Referral',
      driverName: v.driver_name,
      vehicleNo: v.vehicle_no,
      status: v.status,
      createdAt: v.created_at,
    }));

    return res.status(200).json({
      success: true,
      count: visits.length,
      data: visits,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 3. Get Site Visits for a Customer Phone Number
 */
async function getVisitsByPhone(req, res, next) {
  try {
    const { phone } = req.params;
    const cleanPhone = phone.trim();

    const [rows] = await pool.query(
      'SELECT * FROM site_visits WHERE phone_number LIKE ? ORDER BY visit_date DESC',
      [`%${cleanPhone}%`]
    );

    const visits = rows.map(v => ({
      id: v.id,
      propertyId: v.property_id,
      propertyTitle: v.property_title,
      customerName: v.customer_name,
      phoneNumber: v.phone_number,
      visitDate: v.visit_date,
      timeSlot: v.time_slot,
      pickupRequired: Boolean(v.pickup_required),
      pickupAddress: v.pickup_address,
      referredBy: v.referred_by || 'Direct Company Referral',
      driverName: v.driver_name,
      vehicleNo: v.vehicle_no,
      status: v.status,
      createdAt: v.created_at,
    }));

    return res.status(200).json({
      success: true,
      count: visits.length,
      data: visits,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * 4. Update Site Visit Allocation / Status (Staff)
 */
async function updateSiteVisit(req, res, next) {
  try {
    const { id } = req.params;
    const { driverName, vehicleNo, status } = req.body;

    const [existing] = await pool.query('SELECT * FROM site_visits WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Site visit record not found' });
    }

    const current = existing[0];

    await pool.query(
      `UPDATE site_visits SET 
        driver_name = ?, 
        vehicle_no = ?, 
        status = ? 
       WHERE id = ?`,
      [
        driverName ?? current.driver_name,
        vehicleNo ?? current.vehicle_no,
        status ?? current.status,
        id,
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Site visit record updated successfully',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  bookSiteVisit,
  getAllSiteVisits,
  getVisitsByPhone,
  updateSiteVisit,
};
