const { pool } = require('../config/db');

/**
 * 1. Book Free Site Visit (Customer)
 */
async function bookSiteVisit(req, res, next) {
  try {
    const {
      propertyId,
      propertyTitle,
      customerName,
      phoneNumber,
      visitDate,
      timeSlot,
      pickupRequired = false,
      pickupAddress,
    } = req.body;

    if (!propertyTitle || !customerName || !phoneNumber || !visitDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Please provide property title, customer name, phone number, visit date, and time slot.',
      });
    }

    // Default assigned driver pool for demo/production experience
    const defaultDrivers = [
      { driver: 'Murugan S (Cab allocated)', vehicle: 'TN 09 BX 4412' },
      { driver: 'Ramesh K (Dedicated AC Car)', vehicle: 'TN 22 CZ 7890' },
      { driver: 'Senthil Nathan (Site Coordinator)', vehicle: 'TN 11 DA 5612' },
    ];
    const assigned = defaultDrivers[Math.floor(Math.random() * defaultDrivers.length)];

    const [result] = await pool.query(
      `INSERT INTO site_visits 
        (property_id, property_title, customer_name, phone_number, visit_date, time_slot, pickup_required, pickup_address, driver_name, vehicle_no, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED')`,
      [
        propertyId || null,
        propertyTitle,
        customerName.trim(),
        phoneNumber.trim(),
        visitDate,
        timeSlot,
        pickupRequired ? 1 : 0,
        pickupAddress || null,
        assigned.driver,
        assigned.vehicle,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Site visit scheduled successfully. Our coordinator will contact you.',
      siteVisit: {
        id: result.insertId,
        propertyTitle,
        customerName,
        phoneNumber,
        visitDate,
        timeSlot,
        pickupRequired: Boolean(pickupRequired),
        pickupAddress,
        driverName: assigned.driver,
        vehicleNo: assigned.vehicle,
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
