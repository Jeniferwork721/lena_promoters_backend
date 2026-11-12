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
 * Generates continuous sequential Lucky Draw coupon numbers for the active event/season,
 * with slot recycling enabled:
 * - Rejected coupons are renamed to REJ-<couponNumber> (freeing up the original coupon slot).
 * - The generator fills available recycled slots first before allocating higher numbers.
 * - Resets from 0001 for every new season (e.g. ['LENA-LD-0001', 'LENA-LD-0002', ...]),
 *   while continuing from 8800+ for legacy Season 1.
 */
async function generateNextCouponNumbers(count = 1, explicitEventId = null) {
  const safeCount = Math.max(1, parseInt(count, 10) || 1);
  const eventId = explicitEventId || await getActiveEventId();

  // 1. Fetch all assigned active/valid coupon numbers for this event (excluding REJECTED / REJ- coupons)
  let rows = [];
  try {
    const [dbRows] = await pool.query(
      "SELECT coupon_number FROM lucky_draw_coupons WHERE (event_id = ? OR event_id IS NULL) AND status != 'REJECTED' AND coupon_number NOT LIKE 'REJ-%'",
      [eventId]
    );
    rows = dbRows;
  } catch (err) {
    // Fallback if event_id column does not exist yet in legacy DB
    const [dbRows] = await pool.query(
      "SELECT coupon_number FROM lucky_draw_coupons WHERE status != 'REJECTED' AND coupon_number NOT LIKE 'REJ-%'"
    );
    rows = dbRows;
  }

  // 2. Build set of currently taken active numbers
  const takenNumbers = new Set();
  let hasLegacy8800 = false;

  for (const r of rows) {
    if (!r.coupon_number) continue;
    const raw = String(r.coupon_number).trim();
    if (raw.startsWith('REJ-')) continue;

    const digits = raw.replace(/^LENA-LD-/i, '').replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    if (!isNaN(num)) {
      takenNumbers.add(num);
      if (num >= 8000) {
        hasLegacy8800 = true;
      }
    }
  }

  // 3. Determine starting candidate:
  // For legacy Season 1: candidate starts from 8801.
  // For Season 2+ or new events: candidate starts cleanly from 1 (0001).
  const isLegacy8800Event = hasLegacy8800 && (eventId === 1 || eventId === null);
  let candidate = isLegacy8800Event ? 8801 : 1;

  // 4. Slot recycling & gap-filling:
  // Fills any recycled/freed numbers first (e.g. if 8917 was rejected, 8917 is not in takenNumbers,
  // so applicant gets LENA-LD-8917 immediately).
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
  // If customNumber is explicitly provided and is free (not assigned to an active coupon), use it
  if (customNumber && typeof customNumber === 'string' && customNumber.trim().length > 0) {
    const formatted = customNumber.trim().toUpperCase();
    const [existing] = await pool.query(
      "SELECT id FROM lucky_draw_coupons WHERE coupon_number = ? AND status != 'REJECTED'",
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
