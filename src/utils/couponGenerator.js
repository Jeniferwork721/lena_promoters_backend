const { pool } = require('../config/db');

/**
 * Helper: Find or get the current ACTIVE lucky draw event ID.
 * If lucky_draw_events table does not exist or has no record, defaults to 1.
 */
async function getActiveEventId() {
  try {
    const [rows] = await pool.query(
      "SELECT id FROM lucky_draw_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1"
    );
    if (rows && rows.length > 0) {
      return rows[0].id;
    }
  } catch (_) {
    // Fallback if table not created yet
  }
  return 1;
}

/**
 * Generates an array of continuous sequential Lucky Draw coupon numbers for the active event.
 * Feature 1: Recycles rejected/freed slots (e.g. LENA-LD-0011) first before allocating higher numbers.
 * Feature 2: Resets from 0001 for every new event/season!
 * e.g. ['LENA-LD-0001', 'LENA-LD-0002', ...]
 */
async function generateNextCouponNumbers(count = 1, explicitEventId = null) {
  const safeCount = Math.max(1, parseInt(count, 10) || 1);
  const eventId = explicitEventId || await getActiveEventId();

  // 1. Fetch all assigned valid/active coupon numbers for this event
  let rows = [];
  try {
    const [dbRows] = await pool.query(
      "SELECT coupon_number FROM lucky_draw_coupons WHERE (event_id = ? OR event_id IS NULL) AND coupon_number LIKE 'LENA-LD-%'",
      [eventId]
    );
    rows = dbRows;
  } catch (err) {
    // If event_id column does not exist yet in legacy DB, scan all
    const [dbRows] = await pool.query(
      "SELECT coupon_number FROM lucky_draw_coupons WHERE coupon_number LIKE 'LENA-LD-%'"
    );
    rows = dbRows;
  }

  // 2. Build set of taken numbers
  const takenNumbers = new Set();
  for (const r of rows) {
    const digits = r.coupon_number.replace(/^LENA-LD-/i, '');
    const num = parseInt(digits, 10);
    if (!isNaN(num)) {
      takenNumbers.add(num);
    }
  }

  // 3. Determine starting base candidate:
  // For new events, starts cleanly at 1 (0001).
  // If this is legacy Season 1 where all existing numbers are >= 8000 (e.g. 8801..8830),
  // continue sequentially from 8800+ so legacy season is not disrupted.
  let candidate = 1;
  const isLegacy8800Event = takenNumbers.size > 0 && Array.from(takenNumbers).every(n => n >= 8000);
  if (isLegacy8800Event) {
    candidate = 8801;
  }

  // 4. Gap-filling slot allocation:
  // Fills any recycled/freed numbers first (e.g. if 0011 was rejected, 11 is not in takenNumbers,
  // so applicant gets LENA-LD-0011 immediately).
  const generated = [];
  while (generated.length < safeCount) {
    if (!takenNumbers.has(candidate)) {
      const candidateStr = isLegacy8800Event
          ? `LENA-LD-${candidate}`
          : `LENA-LD-${String(candidate).padStart(4, '0')}`;
      generated.push(candidateStr);
      takenNumbers.add(candidate);
    }
    candidate++;
  }

  return generated;
}

/**
 * Generates single next sequential Lucky Draw coupon number with slot recycling.
 */
async function generateNextCouponNumber(customNumber = null, explicitEventId = null) {
  // If customNumber is explicitly provided and is free in the active event, use it
  if (customNumber && typeof customNumber === 'string' && customNumber.trim().length > 0) {
    const formatted = customNumber.trim().toUpperCase();
    const [existing] = await pool.query(
      'SELECT id FROM lucky_draw_coupons WHERE coupon_number = ?',
      [formatted]
    );
    if (existing.length === 0) {
      return formatted;
    }
    console.log(`ℹ️ [Coupon Generator] Requested number ${formatted} is already assigned. Finding next free/recycled slot.`);
  }

  const [single] = await generateNextCouponNumbers(1, explicitEventId);
  return single;
}

module.exports = {
  getActiveEventId,
  generateNextCouponNumber,
  generateNextCouponNumbers,
};
