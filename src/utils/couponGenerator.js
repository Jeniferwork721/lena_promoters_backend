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
 * Generates strictly monotonic sequential Lucky Draw coupon numbers for the active event/season.
 * Rule 1: NEVER recycle or gap-fill numbers. Once a coupon number is assigned (pending, verified, or rejected),
 *         it remains permanently bound to that entry and is never re-allocated.
 * Rule 2: Numbers increment strictly past MAX(all issued numbers in this season).
 * Rule 3: Resets from 0001 for every new season (e.g. ['LENA-LD-0001', 'LENA-LD-0002', ...]),
 *         while preserving 8800+ range for legacy Season 1.
 */
async function generateNextCouponNumbers(count = 1, explicitEventId = null) {
  const safeCount = Math.max(1, parseInt(count, 10) || 1);
  const eventId = explicitEventId || await getActiveEventId();

  // 1. Fetch all coupon numbers ever issued for this event (regardless of status or prefix)
  let rows = [];
  try {
    const [dbRows] = await pool.query(
      "SELECT coupon_number FROM lucky_draw_coupons WHERE event_id = ? OR event_id IS NULL",
      [eventId]
    );
    rows = dbRows;
  } catch (err) {
    // Fallback if event_id column does not exist yet in legacy DB
    const [dbRows] = await pool.query(
      "SELECT coupon_number FROM lucky_draw_coupons"
    );
    rows = dbRows;
  }

  // 2. Scan highest assigned coupon number and check for legacy 8800 series
  let maxNumber = 0;
  let hasLegacy8800 = false;

  for (const r of rows) {
    if (!r.coupon_number) continue;
    let raw = String(r.coupon_number).trim();

    // Strip REJ- and timestamp if it was a previously renamed token
    if (raw.startsWith('REJ-')) {
      raw = raw.replace(/^REJ-/, '').replace(/-[0-9]+$/, '');
    }

    // Extract numeric portion
    const digits = raw.replace(/^LENA-LD-/i, '').replace(/[^0-9]/g, '');
    const num = parseInt(digits, 10);
    if (!isNaN(num)) {
      if (num > maxNumber) {
        maxNumber = num;
      }
      if (num >= 8000) {
        hasLegacy8800 = true;
      }
    }
  }

  // 3. Determine starting candidate:
  // For legacy Season 1 (where coupons were 8801+), ensure next starts after max(8800, maxNumber)
  // For Season 2+ or new events, starts strictly at max(0, maxNumber) + 1 (e.g. 1 -> 0001)
  const isLegacy8800Event = hasLegacy8800 && (eventId === 1 || eventId === null);
  const baseCandidate = isLegacy8800Event
    ? Math.max(8800, maxNumber) + 1
    : Math.max(0, maxNumber) + 1;

  const generated = [];
  for (let i = 0; i < safeCount; i++) {
    const currentNum = baseCandidate + i;
    const candidateStr = isLegacy8800Event
      ? `LENA-LD-${currentNum}`
      : `LENA-LD-${String(currentNum).padStart(4, '0')}`;
    generated.push(candidateStr);
  }

  return generated;
}

/**
 * Generates single next sequential Lucky Draw coupon number without slot recycling.
 */
async function generateNextCouponNumber(customNumber = null, explicitEventId = null) {
  // If customNumber is explicitly provided and is completely free across all records, use it
  if (customNumber && typeof customNumber === 'string' && customNumber.trim().length > 0) {
    const formatted = customNumber.trim().toUpperCase();
    const [existing] = await pool.query(
      'SELECT id FROM lucky_draw_coupons WHERE coupon_number = ?',
      [formatted]
    );
    if (existing.length === 0) {
      return formatted;
    }
    console.log(`ℹ️ [Coupon Generator] Requested number ${formatted} is already assigned. Finding next strictly sequential slot.`);
  }

  const [single] = await generateNextCouponNumbers(1, explicitEventId);
  return single;
}

module.exports = {
  getActiveEventId,
  generateNextCouponNumber,
  generateNextCouponNumbers,
};
